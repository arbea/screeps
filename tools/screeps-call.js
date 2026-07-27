// Calls the Screeps API and records the call in the dashboard's traffic ledger.
//
// It exists because the ledger can only count what goes through it, and the calls that once spent
// the account down to a 13.8-hour lockout were made from a terminal, not from the dashboard. A
// meter that cannot see the biggest consumer reports everything fine right up to the refusal.
//
//   node tools/screeps-call.js GET /api/user/memory?shard=shard3
//   node tools/screeps-call.js POST /api/user/console '{"shard":"shard3","expression":"1+1"}'

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DASHBOARD = { host: 'localhost', port: 3131 };

function readToken() {
	const content = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
	return content.match(/SCREEPS_TOKEN=(.+)/)[1].trim();
}

// Best-effort and never fatal: failing to record a call must not also fail the call, but it is
// reported rather than swallowed, because a silently unrecorded call is the exact blind spot this
// script was written to close.
function recordCall(endpoint, status) {
	return new Promise(resolve => {
		const body = JSON.stringify({ endpoint, status });
		const req = http.request(
			{ ...DASHBOARD, path: '/api/traffic', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
			res => {
				res.resume();
				res.on('end', resolve);
			}
		);
		req.on('error', err => {
			console.error(`[未記錄流量] ${err.message} —— dashboard 沒開?這次呼叫不會被計入。`);
			resolve();
		});
		req.end(body);
	});
}

// Asks the dashboard whether the endpoint still has room under the self-imposed caps before
// spending a real call. The caps exist because the official limits already lied once - two 429s
// in a day at rates far below the published figures - and the ledger both consumers share lives
// in the dashboard. If the dashboard is down there is nothing to ask; proceed, but say so.
function checkAllowance(endpoint) {
	return new Promise(resolve => {
		const req = http.request(
			{ ...DASHBOARD, path: '/api/traffic/allowance?endpoint=' + encodeURIComponent(endpoint), method: 'GET' },
			res => {
				let raw = '';
				res.on('data', chunk => (raw += chunk));
				res.on('end', () => {
					try { resolve(JSON.parse(raw)); } catch (err) { resolve(null); }
				});
			}
		);
		req.on('error', () => {
			console.error('[無帳本] dashboard 沒開,無法查自我上限 —— 這次呼叫未經配額檢查。');
			resolve(null);
		});
		req.end();
	});
}

async function main() {
	const [method, apiPath, payload] = process.argv.slice(2);
	if (!method || !apiPath) {
		console.error('用法: node tools/screeps-call.js <METHOD> <path> [json body]');
		process.exit(2);
	}

	const allowance = await checkAllowance(apiPath.split('?')[0]);
	if (allowance && !allowance.allowed) {
		console.error(`自我上限已到,${Math.ceil(allowance.retryAfterMs / 1000)} 秒後再試 —— 沒有打到 Screeps。`);
		process.exit(3);
	}

	const token = readToken();
	const result = await new Promise((resolve, reject) => {
		const req = https.request(
			{ hostname: 'screeps.com', path: apiPath, method, headers: { 'X-Token': token, 'X-Username': token, 'Content-Type': 'application/json' } },
			res => {
				let raw = '';
				res.on('data', chunk => (raw += chunk));
				res.on('end', () => resolve({ status: res.statusCode, raw }));
			}
		);
		req.on('error', reject);
		if (payload) req.write(payload);
		req.end();
	});

	await recordCall(apiPath, result.status);

	console.log(result.raw);
	// A refusal has to be visible in the exit code too, or a caller that only checks that will
	// treat being rate-limited as success and try again.
	if (result.status < 200 || result.status >= 300) {
		console.error(`Screeps API ${result.status}`);
		process.exit(1);
	}
}

main().catch(err => {
	console.error(err.message);
	process.exit(1);
});

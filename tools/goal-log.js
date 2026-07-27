// Appends one 執行/修正 line to a goal or mission card's log on the dashboard.
//
// The cards are where the record lives - a fix reported only in a chat scrollback is invisible
// the next time anyone (human or AI) asks "what has been done about this goal". The autonomous
// session writes here after every action on a goal, and reads the tails back to decide what to
// work next in priority order: a latest line that says it is waiting on observation frees the
// session to move down the list, anything else keeps that goal current.
//
//   node tools/goal-log.js <goal-id> <note>
//   node tools/goal-log.js idle-creeps "UPGRADE 改多 slot,已部署,等下個 300-tick 窗口驗證"
//
// Known ids: ai-usage, api-traffic, idle-creeps, regen-loss-<room>, controller-<room>,
// conquest-<room>. The dashboard caps each id's log at 1000 characters, oldest lines out first.

const http = require('http');

const DASHBOARD = { host: 'localhost', port: 3131 };

async function main() {
	const [id, note] = process.argv.slice(2);
	if (!id || !note) {
		console.error('用法: node tools/goal-log.js <goal-id> <note>');
		process.exit(2);
	}

	const body = JSON.stringify({ id, note });
	await new Promise((resolve, reject) => {
		const req = http.request(
			{ ...DASHBOARD, path: '/api/goals/log', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
			res => {
				let raw = '';
				res.on('data', chunk => (raw += chunk));
				res.on('end', () => {
					console.log(raw);
					if (res.statusCode !== 200) process.exit(1);
					resolve();
				});
			}
		);
		req.on('error', err => reject(new Error(`dashboard 沒開?${err.message}`)));
		req.end(body);
	});
}

main().catch(err => {
	console.error(err.message);
	process.exit(1);
});

// The session's ears while it is idle or standing down. A terminal session has no timer of its
// own: once it stops, nothing inside it can notice a dashboard message, a tier change, or an ally
// speaking. This process watches from outside and wakes the session the only way a background
// process can - by exiting, which the harness reports as the task finishing.
//
// Three watches, three very different prices:
//   - chat-log.json     every 5s   - a file read, free
//   - /api/autonomy     every 15s  - local arithmetic on the server, free (no Screeps call)
//   - /api/goals        every 10m  - may trigger one Screeps poll; this is the only paid watch,
//                                    and 144 polls/day is a tenth of the /api/user/memory budget.
//                                    Watching the ally any faster would rebuild the polling loop
//                                    that once locked the account for 13.8 hours.
//
// Last-seen ally state persists in watch-state.json so a restart does not re-fire on a change the
// session already handled; the tier baseline is whatever is true at startup, because a change is
// only worth a wake-up if this process was running to see both sides of it.

const fs = require('fs');
const path = require('path');
const http = require('http');

const DASH = path.join(__dirname, '..', 'screeps-dashboard');
const CHAT_PATH = path.join(DASH, 'chat-log.json');
const STATE_PATH = path.join(DASH, 'watch-state.json');
const BASE = 'http://localhost:3131';

const CHAT_INTERVAL_MS = 5 * 1000;
const TIER_INTERVAL_MS = 15 * 1000;
const ALLY_INTERVAL_MS = 10 * 60 * 1000;

function getJson(url) {
	return new Promise((resolve, reject) => {
		http.get(url, res => {
			let body = '';
			res.on('data', chunk => (body += chunk));
			res.on('end', () => {
				try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
			});
		}).on('error', reject);
	});
}

function loadState() {
	try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch (err) { return {}; }
}

function saveState(state) {
	fs.writeFileSync(STATE_PATH, JSON.stringify(state));
}

// Only the fields where a change means somebody should read the message again. tick advances every
// broadcast and intel timestamps churn constantly; waking on those would fire every 20 game ticks.
// ack is out too - it is a read receipt that appears for one cycle and clears on the next, and
// including it had the watcher waking twice per acknowledged message with nothing to act on.
function allyDigest(message) {
	if (!message) return null;
	return JSON.stringify({
		allies: message.allies,
		rooms: message.rooms,
		war: message.war,
		requests: message.requests,
	});
}

function wake(reason, detail) {
	console.log(JSON.stringify({ wake: reason, detail, at: new Date().toISOString() }));
	process.exit(0);
}

function checkChat() {
	let log;
	try { log = JSON.parse(fs.readFileSync(CHAT_PATH, 'utf8')); } catch (err) { return; }

	const entries = Array.isArray(log) ? log : log.messages || [];
	const pending = entries.filter(entry => entry.status === 'pending');
	if (pending.length > 0) wake('chat', `${pending.length} 則待回覆訊息:${pending[pending.length - 1].message}`);
}

let baselineTier = null;

async function checkTier() {
	let autonomy;
	try { autonomy = await getJson(BASE + '/api/autonomy'); } catch (err) { return; }

	if (baselineTier === null) { baselineTier = autonomy.tier; return; }
	if (autonomy.tier !== baselineTier) wake('tier', `${baselineTier} → ${autonomy.tier}`);
}

async function checkAlly() {
	let goals;
	try { goals = await getJson(BASE + '/api/goals'); } catch (err) { return; }

	const digest = allyDigest(goals.ally && goals.ally.message);
	if (digest === null) return;

	const state = loadState();
	if (state.allyDigest === undefined) {
		// First observation ever: record it silently, the session has already seen the present.
		saveState({ ...state, allyDigest: digest });
		return;
	}
	if (digest !== state.allyDigest) {
		// Saved before waking so the next run of this watcher treats the change as handled.
		saveState({ ...state, allyDigest: digest });
		wake('ally', '盟軍訊息有實質變化(requests/war/rooms/ack)');
	}
}

console.log('watch-dash: chat 5s / tier 15s / ally 10m');
setInterval(checkChat, CHAT_INTERVAL_MS);
setInterval(checkTier, TIER_INTERVAL_MS);
setInterval(checkAlly, ALLY_INTERVAL_MS);
checkChat();
checkTier();
checkAlly();

// Non-combat creeps are hired to keep energy moving, so a tick one of them stands without a task
// is production bought and thrown away. Combat roles are excluded because waiting is their job -
// a defender with nothing to shoot is exactly where it should be.
//
// Two readings come out of this: each creep's current idle streak (stamped into its memory, the
// map snapshot carries it out), and a rolling window ratio so the dashboard can say how much of
// the fleet's recent time was idle rather than only what this instant looks like.

const COMBAT_ROLES = new Set(['defender', 'remoteDefender']);
const WINDOW_TICKS = 300;

function trackIdle() {
	if (!Memory.idleStats) Memory.idleStats = { windowStart: Game.time, idle: 0, total: 0, prev: null };
	const stats = Memory.idleStats;

	if (Game.time - stats.windowStart >= WINDOW_TICKS) {
		stats.prev = { idle: stats.idle, total: stats.total, ticks: Game.time - stats.windowStart };
		stats.windowStart = Game.time;
		stats.idle = 0;
		stats.total = 0;
	}

	for (const name in Game.creeps) {
		const creep = Game.creeps[name];
		if (creep.spawning || COMBAT_ROLES.has(creep.memory.role)) continue;

		stats.total++;
		// A relief miner standing by its post is on assignment, not idle - the waiting is the job.
		const hasWork = Boolean(creep.memory.task || creep.memory.standbyFor);
		if (hasWork) {
			delete creep.memory.idleSince;
			continue;
		}

		stats.idle++;
		if (creep.memory.idleSince === undefined) creep.memory.idleSince = Game.time;
		// The lifetime account, alongside the current streak: the goal judges idle time as a share
		// of each creep's whole life, and a share needs a numerator that survives busy spells.
		creep.memory.idleTotal = (creep.memory.idleTotal || 0) + 1;
	}
}

module.exports = { trackIdle, WINDOW_TICKS };

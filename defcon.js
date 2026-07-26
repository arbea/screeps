const hostiles = require('./hostiles');

// Part weights from the spec. They rank what a body can actually do to us rather than counting
// bodies: a healer keeps a squad alive far longer than one more attacker shortens our life, which
// is why HEAL outweighs ATTACK, and WORK counts at all because it dismantles structures.
const THREAT_WEIGHTS = {
	[ATTACK]: 4,
	[RANGED_ATTACK]: 3,
	[HEAL]: 6,
	[WORK]: 1,
	[TOUGH]: 1,
};

// Allied creeps never reach here - findHostileCreeps filters the trust circle out first - so an
// ally moving a war squad through our room can't raise the alarm.
function threatScore(room) {
	let score = 0;
	for (const creep of hostiles.findHostileCreeps(room)) {
		for (const part of creep.body) score += THREAT_WEIGHTS[part.type] || 0;
	}
	return score;
}

const LEVELS = { NORMAL: 0, PRESENT: 1, THREATENED: 2, CRITICAL: 3 };

// A spawn at half health with enemies still in the room means we are losing the fight for the one
// structure the room cannot recover without, which is what safemode exists for.
function spawnCritical(room) {
	return room.find(FIND_MY_SPAWNS).some(spawn => spawn.hits <= spawn.hitsMax * 0.5);
}

function level(room) {
	const enemies = hostiles.findHostileCreeps(room);
	if (enemies.length === 0) return LEVELS.NORMAL;

	if (spawnCritical(room)) return LEVELS.CRITICAL;
	if (threatScore(room) >= 10) return LEVELS.THREATENED;
	return LEVELS.PRESENT;
}

module.exports = { level, threatScore, LEVELS };

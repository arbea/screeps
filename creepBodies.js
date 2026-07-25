// Shared body-sizing helpers used by both spawnQueue.js and expansion.js. Kept separate from
// both (rather than one requiring the other) to avoid a circular require between them.

// Fixed 1:1 ATTACK:MOVE shape; size scales with available energy instead of being a flat
// body that's oversized in a starter room and undersized once the room has grown.
function buildDefenderBody(energyAvailable) {
	const unitCost = BODYPART_COST[ATTACK] + BODYPART_COST[MOVE];
	const unitsByEnergy = Math.floor(energyAvailable / unitCost);
	const unitsByPartLimit = Math.floor(MAX_CREEP_SIZE / 2);
	const units = Math.max(1, Math.min(unitsByEnergy, unitsByPartLimit));

	const body = [];
	for (let i = 0; i < units; i++) body.push(ATTACK);
	for (let i = 0; i < units; i++) body.push(MOVE);
	return body;
}

// Fixed 2 WORK : 1 CARRY : 2 MOVE shape (travels further than a home-room creep, so gets
// more MOVE per WORK); size scales with energy capacity the same way.
function buildRemoteHarvesterBody(energyCapacity) {
	const unitCost = 2 * BODYPART_COST[WORK] + BODYPART_COST[CARRY] + 2 * BODYPART_COST[MOVE];
	const unitsByEnergy = Math.floor(energyCapacity / unitCost);
	const unitsByPartLimit = Math.floor(MAX_CREEP_SIZE / 5);
	const units = Math.max(1, Math.min(unitsByEnergy, unitsByPartLimit));

	const body = [];
	for (let i = 0; i < units * 2; i++) body.push(WORK);
	for (let i = 0; i < units; i++) body.push(CARRY);
	for (let i = 0; i < units * 2; i++) body.push(MOVE);
	return body;
}

module.exports = { buildDefenderBody, buildRemoteHarvesterBody };

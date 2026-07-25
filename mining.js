const config = require('./config');

const SATURATION_WORK = 5; // WORK parts needed to harvest a source at its max regen rate

function clampMinerWorkCount(value) {
	const invalid = typeof value !== 'number' || !Number.isFinite(value) || value < 1;
	return invalid ? SATURATION_WORK : Math.min(value, SATURATION_WORK);
}

function minerWorkCount(energyCapacity) {
	const workCost = BODYPART_COST[WORK];
	const moveCost = BODYPART_COST[MOVE];
	const maxWork = clampMinerWorkCount(config.MINER_MAX_WORK);

	const affordableWork = Math.floor((energyCapacity - moveCost) / workCost);
	return Math.max(1, Math.min(affordableWork, maxWork));
}

function getAccessibleTiles(room, pos) {
	const terrain = room.getTerrain();
	const tiles = [];

	for (let dx = -1; dx <= 1; dx++) {
		for (let dy = -1; dy <= 1; dy++) {
			const isCenter = dx === 0 && dy === 0;
			if (isCenter) continue;

			const x = pos.x + dx;
			const y = pos.y + dy;
			const inBounds = x >= 1 && x <= 48 && y >= 1 && y <= 48;
			if (!inBounds) continue;
			if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

			tiles.push({ x, y });
		}
	}

	return tiles;
}

// A source's harvest rate caps out once total WORK parts working it reach SATURATION_WORK -
// beyond that, extra miners don't add throughput. So the real limit on how many miners a
// source supports is whichever is smaller: how many fit around it, or how many are needed
// to reach saturation given the current (energy-capacity-limited) miner body size.
function maxMinersForSource(room, source) {
	const workPerMiner = minerWorkCount(room.energyCapacityAvailable);
	const minersForSaturation = Math.ceil(SATURATION_WORK / workPerMiner);
	const accessibleTileCount = getAccessibleTiles(room, source.pos).length;

	return Math.max(1, Math.min(minersForSaturation, accessibleTileCount));
}

module.exports = { minerWorkCount, getAccessibleTiles, maxMinersForSource, SATURATION_WORK };

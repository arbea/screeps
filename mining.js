// WORK parts needed to harvest a source at its max regen rate - a fixed rule of the game
// (10 energy/tick regen ÷ 2 energy per WORK per tick), not a strategy choice, so it's a
// constant here rather than a config knob.
const SATURATION_WORK = 5;

function minerWorkCount(energyCapacity) {
	const workCost = BODYPART_COST[WORK];
	const moveCost = BODYPART_COST[MOVE];

	const affordableWork = Math.floor((energyCapacity - moveCost) / workCost);
	return Math.max(1, Math.min(affordableWork, SATURATION_WORK));
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

// Tile space around a source that dedicated miners aren't already standing on - the ceiling on
// how many idle, empty-handed generalists can usefully self-harvest there at once. Shared by
// taskQueue (to open HARVEST_FALLBACK task slots) and spawnQueue (to know when that route for
// a broke creep to earn energy is also saturated, not just the HAUL route).
function fallbackHarvestSlotsForSource(room, source) {
	const maxMiners = maxMinersForSource(room, source);
	const accessibleTileCount = getAccessibleTiles(room, source.pos).length;
	return Math.max(0, accessibleTileCount - maxMiners);
}

const HAULER_CAPACITY_ESTIMATE = 50; // conservative baseline; matches the default generalist body

// Only owned structures are scanned, so this stays cheap even in a room ringed by neutral walls.
function energySinkFreeCapacity(room) {
	return room
		.find(FIND_MY_STRUCTURES, {
			filter: structure =>
				structure.structureType === STRUCTURE_SPAWN ||
				structure.structureType === STRUCTURE_EXTENSION ||
				structure.structureType === STRUCTURE_TOWER ||
				structure.structureType === STRUCTURE_STORAGE,
		})
		.reduce((sum, structure) => sum + structure.store.getFreeCapacity(RESOURCE_ENERGY), 0);
}

// How many haulers a source can usefully occupy: enough to clear whatever's currently piled
// up in its container/on the ground within one round trip each, capped by physical tile
// space - same "derive it from the map, don't guess a number" logic as maxMinersForSource.
//
// Also capped by how much the room's stores can still accept, which is the half that was
// missing: hauling energy nobody can receive parks a creep on a full load, and because HAUL
// outranks BUILD it immediately claims another haul slot instead of spending what it carries.
// With the stores full the useful number of slots is zero - that releases those creeps to
// BUILD/UPGRADE, which is exactly where the energy they are holding needs to go. So there is no
// floor of 1 here: "no room to put it" is a real answer, not a value to round up.
function haulSlotsForSource(room, source) {
	const container = source.pos.findInRange(FIND_STRUCTURES, 1, {
		filter: structure => structure.structureType === STRUCTURE_CONTAINER,
	})[0];
	const stored = container ? container.store[RESOURCE_ENERGY] : 0;
	const dropped = source.pos
		.findInRange(FIND_DROPPED_RESOURCES, 2)
		.reduce((sum, resource) => sum + resource.amount, 0);

	const neededByVolume = Math.ceil((stored + dropped) / HAULER_CAPACITY_ESTIMATE);
	const acceptedByStores = Math.ceil(energySinkFreeCapacity(room) / HAULER_CAPACITY_ESTIMATE);
	const accessibleTileCount = getAccessibleTiles(room, source.pos).length;

	return Math.max(0, Math.min(neededByVolume, acceptedByStores, accessibleTileCount));
}

module.exports = {
	minerWorkCount,
	getAccessibleTiles,
	maxMinersForSource,
	haulSlotsForSource,
	fallbackHarvestSlotsForSource,
	SATURATION_WORK,
};

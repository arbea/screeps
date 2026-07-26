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

// The squares a miner can work this source from, container first: a miner drops its energy on
// the square it stands on, so putting it on the container is the difference between the energy
// being stored and it decaying on the ground. Order is otherwise the fixed scan order of
// getAccessibleTiles, so a given square keeps its place in the list from tick to tick.
function getMiningTiles(room, source) {
	const containerKeys = new Set(
		source.pos
			.findInRange(FIND_STRUCTURES, 1, {
				filter: structure => structure.structureType === STRUCTURE_CONTAINER,
			})
			.map(container => `${container.pos.x},${container.pos.y}`)
	);

	return getAccessibleTiles(room, source.pos).sort(
		(a, b) => (containerKeys.has(`${a.x},${a.y}`) ? 0 : 1) - (containerKeys.has(`${b.x},${b.y}`) ? 0 : 1)
	);
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
	const sourceSlots = Math.max(0, accessibleTileCount - maxMiners);

	// Energy already lying on the ground is a far wider doorway into the economy than the few
	// tiles left free around the source: a creep empties a pile in a single tick from any walkable
	// tile beside it, rather than mining at 2 energy/tick, and every load carried off is a load
	// that stops decaying. Sized the same way haul slots are - by what is actually piled up -
	// and capped by the tiles that can physically reach it. Taken as a max rather than a sum
	// because the piles sit next to the source, so the two tile sets largely overlap.
	const piles = source.pos.findInRange(FIND_DROPPED_RESOURCES, 2);
	const pileAmount = piles.reduce((sum, pile) => sum + pile.amount, 0);

	const pileTiles = new Set();
	for (const pile of piles) {
		for (const tile of getAccessibleTiles(room, pile.pos)) pileTiles.add(`${tile.x},${tile.y}`);
	}
	const pileSlots = Math.min(pileTiles.size, Math.ceil(pileAmount / HAULER_CAPACITY_ESTIMATE));

	return Math.max(sourceSlots, pileSlots);
}

const HAULER_CAPACITY_ESTIMATE = 50; // conservative baseline; matches the default generalist body

module.exports = {
	minerWorkCount,
	getAccessibleTiles,
	getMiningTiles,
	maxMinersForSource,
	fallbackHarvestSlotsForSource,
	SATURATION_WORK,
};

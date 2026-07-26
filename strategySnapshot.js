const config = require('./config');
const mining = require('./mining');
const creepBodies = require('./creepBodies');
const buildOrder = require('./buildOrder');
const logistics = require('./logistics');
const population = require('./population');

function countCreepsAssignedTo(targetId, taskType) {
	return _.filter(
		Game.creeps,
		creep => creep.memory.task && creep.memory.task.targetId === targetId && creep.memory.task.type === taskType
	).length;
}

function countActiveHaulers(room) {
	return _.filter(
		Game.creeps,
		creep => creep.room.name === room.name && creep.memory.task && creep.memory.task.type === 'HAUL'
	).length;
}

function countIdleBrokeGeneralists(room) {
	return _.filter(
		Game.creeps,
		creep =>
			creep.room.name === room.name &&
			creep.memory.role !== 'miner' &&
			!creep.memory.task &&
			creep.store[RESOURCE_ENERGY] === 0
	).length;
}

// Publishes what the "no manual population/body-size knobs" algorithms actually computed
// this tick, so the reasoning behind the current operating strategy is visible rather than
// just trusted - a live readout of the same numbers the spawn/task logic uses to decide.
function publishStrategySnapshot(room) {
	const isSnapshotTick = Game.time % config.SNAPSHOT_INTERVAL === 0;
	if (!isSnapshotTick) return;

	// Haulers are no longer counted per source - they belong to none - so this reports only what
	// is still a per-source quantity: who is mining it and who is self-serving from it.
	const sources = room.find(FIND_SOURCES_ACTIVE);
	const perSource = sources.map(source => ({
		sourceId: source.id,
		pos: { x: source.pos.x, y: source.pos.y },
		accessibleTiles: mining.getAccessibleTiles(room, source.pos).length,
		minerCapacity: mining.maxMinersForSource(room, source),
		currentMiners: countCreepsAssignedTo(source.id, 'MINE'),
		fallbackCapacity: mining.fallbackHarvestSlotsForSource(room, source),
		currentFallbackHarvesters: countCreepsAssignedTo(source.id, 'HARVEST'),
	}));

	const requests = logistics.collectRequests(room);
	const supplies = logistics.collectSupplies(room);

	if (!Memory.strategySnapshot) Memory.strategySnapshot = {};
	Memory.strategySnapshot[room.name] = {
		tick: Game.time,
		perSource,
		// The ledger's own state, which is what now decides how many hands the room wants.
		logistics: {
			openRequests: requests.length,
			energyDemanded: requests.reduce((sum, request) => sum + request.need, 0),
			supplyPoints: supplies.length,
			energyAvailableToCollect: supplies.reduce((sum, supply) => sum + supply.amount, 0),
			unclaimedRequests: logistics.unclaimedRequestCount(room),
		},
		crew: {
			miner: population.countRole(room, 'miner'),
			hauler: population.countRole(room, 'hauler'),
			builder: population.countRole(room, 'builder'),
			upgrader: population.countRole(room, 'upgrader'),
			activeHaulers: countActiveHaulers(room),
			idleBroke: countIdleBrokeGeneralists(room),
			fallbackCapacity: perSource.reduce((sum, s) => sum + s.fallbackCapacity, 0),
		},
		// Published so the population maths is inspectable rather than trusted.
		population: {
			miner: population.minerTarget(room),
			hauler: population.haulerTarget(room, creepBodies.bodyFor('hauler', room.energyCapacityAvailable) || []),
			builder: population.builderTarget(room),
			upgrader: population.upgraderTarget(room),
			emergency: population.isEmergency(room),
		},
		bodySizes: {
			hauler: (creepBodies.bodyFor('hauler', room.energyCapacityAvailable) || []).length,
			builder: (creepBodies.bodyFor('builder', room.energyCapacityAvailable) || []).length,
			miner: (creepBodies.bodyFor('miner', room.energyCapacityAvailable) || []).length,
			remoteHarvester: (creepBodies.bodyFor('remoteHarvester', room.energyCapacityAvailable) || []).length,
		},
		buildOrder: buildOrder.describeBuildOrder(room),
	};
}

module.exports = { publishStrategySnapshot };

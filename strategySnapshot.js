const config = require('./config');
const mining = require('./mining');
const creepBodies = require('./creepBodies');

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

const NON_GENERALIST_ROLES = new Set(['miner', 'scout', 'reserver', 'remoteHarvester', 'remoteDefender', 'defender']);

function countGeneralists(room) {
	return _.filter(
		Game.creeps,
		creep => creep.room.name === room.name && !NON_GENERALIST_ROLES.has(creep.memory.role)
	).length;
}

// Publishes what the "no manual population/body-size knobs" algorithms actually computed
// this tick, so the reasoning behind the current operating strategy is visible rather than
// just trusted - a live readout of the same numbers the spawn/task logic uses to decide.
function publishStrategySnapshot(room) {
	const isSnapshotTick = Game.time % config.SNAPSHOT_INTERVAL === 0;
	if (!isSnapshotTick) return;

	const sources = room.find(FIND_SOURCES_ACTIVE);
	const perSource = sources.map(source => {
		const accessibleTiles = mining.getAccessibleTiles(room, source.pos).length;
		const minerCapacity = mining.maxMinersForSource(room, source);
		const haulCapacity = mining.haulSlotsForSource(room, source);

		return {
			sourceId: source.id,
			pos: { x: source.pos.x, y: source.pos.y },
			accessibleTiles,
			minerCapacity,
			currentMiners: countCreepsAssignedTo(source.id, 'MINE'),
			haulCapacity,
			currentHaulers: countCreepsAssignedTo(source.id, 'HAUL'),
			fallbackCapacity: mining.fallbackHarvestSlotsForSource(room, source),
			currentFallbackHarvesters: countCreepsAssignedTo(source.id, 'HARVEST'),
		};
	});

	if (!Memory.strategySnapshot) Memory.strategySnapshot = {};
	Memory.strategySnapshot[room.name] = {
		tick: Game.time,
		perSource,
		generalist: {
			currentCount: countGeneralists(room),
			haulCapacity: perSource.reduce((sum, s) => sum + s.haulCapacity, 0),
			fallbackCapacity: perSource.reduce((sum, s) => sum + s.fallbackCapacity, 0),
			activeHaulers: countActiveHaulers(room),
			idleBroke: countIdleBrokeGeneralists(room),
		},
		defenderBodySize: creepBodies.buildDefenderBody(room.energyAvailable).length,
		remoteHarvesterBodySize: creepBodies.buildRemoteHarvesterBody(room.energyCapacityAvailable).length,
	};
}

module.exports = { publishStrategySnapshot };

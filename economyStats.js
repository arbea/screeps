const config = require('./config');

const HISTORY_SIZE = 100;

function publishEconomyStats(room) {
	const isSnapshotTick = Game.time % config.SNAPSHOT_INTERVAL === 0;
	if (!isSnapshotTick) return;

	if (!Memory.economyStats) Memory.economyStats = {};
	if (!Memory.economyStats[room.name]) Memory.economyStats[room.name] = [];

	const population = _.filter(Game.creeps, creep => creep.room.name === room.name).length;
	const controller = room.controller;

	const history = Memory.economyStats[room.name];
	history.push({
		tick: Game.time,
		population,
		energyAvailable: room.energyAvailable,
		energyCapacityAvailable: room.energyCapacityAvailable,
		rcl: controller ? controller.level : 0,
		controllerProgress: controller ? controller.progress : 0,
		controllerProgressTotal: controller ? controller.progressTotal : 0,
	});

	const overCap = history.length > HISTORY_SIZE;
	if (overCap) history.shift();
}

module.exports = { publishEconomyStats };

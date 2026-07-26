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
		// The base card's safety block: the downgrade clock is the one number whose neglect
		// deletes a controller level, and safemode is the button that buys time under attack -
		// both belong on the dashboard, not only in the game client.
		ticksToDowngrade: controller ? controller.ticksToDowngrade : null,
		safeMode: controller ? controller.safeMode || 0 : 0,
		safeModeAvailable: controller ? controller.safeModeAvailable || 0 : 0,
		safeModeCooldown: controller ? controller.safeModeCooldown || 0 : 0,
		isPowerEnabled: controller ? controller.isPowerEnabled === true : false,
	});

	const overCap = history.length > HISTORY_SIZE;
	if (overCap) history.shift();
}

module.exports = { publishEconomyStats };

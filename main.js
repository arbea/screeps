const config = require('./config');
const taskQueue = require('./taskQueue');
const creepActions = require('./creepActions');
const spawnQueue = require('./spawnQueue');

function cleanDeadCreepMemory() {
	for (const name in Memory.creeps) {
		const creepIsDead = !(name in Game.creeps);
		if (creepIsDead) delete Memory.creeps[name];
	}
}

// Pre-creates the containers a nested Memory.config write (e.g. config.PRIORITY.HARVEST)
// needs to already exist, since the Screeps memory-path API can't create intermediate objects.
function ensureConfigMemoryShape() {
	if (!Memory.config) Memory.config = {};
	if (!Memory.config.PRIORITY) Memory.config.PRIORITY = {};
	if (!Memory.config.SPAWN_PRIORITY) Memory.config.SPAWN_PRIORITY = {};
	if (!Memory.config.GENERALIST_RATIO) Memory.config.GENERALIST_RATIO = {};
}

module.exports.loop = function () {
	if (!Memory.taskBacklog) Memory.taskBacklog = {};
	if (!Memory.eventLog) Memory.eventLog = [];
	ensureConfigMemoryShape();
	config.applyOverrides();
	cleanDeadCreepMemory();

	for (const roomName in Game.rooms) {
		const room = Game.rooms[roomName];
		const owned = room.controller && room.controller.my;
		if (!owned) continue;

		taskQueue.runTaskQueue(room);
		spawnQueue.runSpawnQueue(room, Memory.taskBacklog);
	}

	for (const name in Game.creeps) {
		creepActions.runCreep(Game.creeps[name]);
	}
};

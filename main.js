const taskQueue = require('./taskQueue');
const creepActions = require('./creepActions');
const spawnQueue = require('./spawnQueue');

function cleanDeadCreepMemory() {
	for (const name in Memory.creeps) {
		const creepIsDead = !(name in Game.creeps);
		if (creepIsDead) delete Memory.creeps[name];
	}
}

module.exports.loop = function () {
	if (!Memory.taskBacklog) Memory.taskBacklog = {};
	if (!Memory.eventLog) Memory.eventLog = [];
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

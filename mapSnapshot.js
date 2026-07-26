const config = require('./config');
const hostiles = require('./hostiles');

function toPoint(target) {
	return { x: target.pos.x, y: target.pos.y };
}

function publishMapSnapshot(room) {
	const isSnapshotTick = Game.time % config.SNAPSHOT_INTERVAL === 0;
	if (!isSnapshotTick) return;

	if (!Memory.mapSnapshot) Memory.mapSnapshot = {};

	Memory.mapSnapshot[room.name] = {
		tick: Game.time,
		sources: room.find(FIND_SOURCES).map(toPoint),
		spawns: room.find(FIND_MY_SPAWNS).map(toPoint),
		controller: room.controller ? toPoint(room.controller) : null,
		constructionSites: room.find(FIND_MY_CONSTRUCTION_SITES).map(toPoint),
		hostiles: hostiles.findThreateningCreeps(room).map(toPoint),
		creeps: room.find(FIND_MY_CREEPS).map(creep => {
			const task = creep.memory.task;
			const target = task ? Game.getObjectById(task.targetId) : null;
			return {
				x: creep.pos.x,
				y: creep.pos.y,
				name: creep.name,
				role: creep.memory.role || 'generalist',
				taskType: task ? task.type : null,
				targetPos: target ? toPoint(target) : null,
				taskStartTick: creep.memory.taskStartTick || null,
				energy: creep.store[RESOURCE_ENERGY],
				energyCapacity: creep.store.getCapacity(RESOURCE_ENERGY),
				hits: creep.hits,
				hitsMax: creep.hitsMax,
			};
		}),
	};
}

module.exports = { publishMapSnapshot };

function toPoint(target) {
	return { x: target.pos.x, y: target.pos.y };
}

function publishMapSnapshot(room) {
	if (!Memory.mapSnapshot) Memory.mapSnapshot = {};

	Memory.mapSnapshot[room.name] = {
		sources: room.find(FIND_SOURCES).map(toPoint),
		spawns: room.find(FIND_MY_SPAWNS).map(toPoint),
		controller: room.controller ? toPoint(room.controller) : null,
		constructionSites: room.find(FIND_MY_CONSTRUCTION_SITES).map(toPoint),
		hostiles: room.find(FIND_HOSTILE_CREEPS).map(toPoint),
		creeps: room.find(FIND_MY_CREEPS).map(creep => {
			const task = creep.memory.task;
			const target = task ? Game.getObjectById(task.targetId) : null;
			return {
				x: creep.pos.x,
				y: creep.pos.y,
				name: creep.name,
				taskType: task ? task.type : null,
				targetPos: target ? toPoint(target) : null,
			};
		}),
	};
}

module.exports = { publishMapSnapshot };

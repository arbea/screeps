const TASK_TYPES = require('./taskTypes');
const config = require('./config');
const { log } = require('./log');

function buildTaskQueue(room) {
	const tasks = [];

	addDefenseTasks(room, tasks);
	addRefillTasks(room, tasks);
	addHarvestTasks(room, tasks);
	addBuildTasks(room, tasks);
	addRepairTasks(room, tasks);
	addUpgradeTask(room, tasks);

	tasks.sort((a, b) => b.priority - a.priority);
	return tasks;
}

function addDefenseTasks(room, tasks) {
	const target = room.find(FIND_HOSTILE_CREEPS)[0];
	if (!target) return;

	log(`defense: hostile in ${room.name}`);
	tasks.push({
		id: `${TASK_TYPES.DEFENSE}:${room.name}`,
		type: TASK_TYPES.DEFENSE,
		priority: config.PRIORITY.DEFENSE,
		targetId: target.id,
	});
}

function addRefillTasks(room, tasks) {
	const spawnsAndExtensions = room.find(FIND_MY_STRUCTURES, {
		filter: structure =>
			(structure.structureType === STRUCTURE_SPAWN || structure.structureType === STRUCTURE_EXTENSION) &&
			structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
	});
	for (const structure of spawnsAndExtensions) {
		tasks.push({
			id: `${TASK_TYPES.REFILL_SPAWN}:${structure.id}`,
			type: TASK_TYPES.REFILL_SPAWN,
			priority: config.PRIORITY.REFILL_SPAWN,
			targetId: structure.id,
		});
	}

	const towers = room.find(FIND_MY_STRUCTURES, {
		filter: structure =>
			structure.structureType === STRUCTURE_TOWER && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
	});
	for (const tower of towers) {
		tasks.push({
			id: `${TASK_TYPES.REFILL_TOWER}:${tower.id}`,
			type: TASK_TYPES.REFILL_TOWER,
			priority: config.PRIORITY.REFILL_TOWER,
			targetId: tower.id,
		});
	}
}

function addHarvestTasks(room, tasks) {
	const sources = room.find(FIND_SOURCES_ACTIVE);
	for (const source of sources) {
		const openSlots = config.MAX_HARVESTERS_PER_SOURCE - countCreepsAssignedTo(source.id);
		for (let slot = 0; slot < openSlots; slot++) {
			tasks.push({
				id: `${TASK_TYPES.HARVEST}:${source.id}:${slot}`,
				type: TASK_TYPES.HARVEST,
				priority: config.PRIORITY.HARVEST,
				targetId: source.id,
			});
		}
	}
}

function countCreepsAssignedTo(targetId) {
	return _.filter(Game.creeps, creep => creep.memory.task && creep.memory.task.targetId === targetId).length;
}

function addBuildTasks(room, tasks) {
	for (const site of room.find(FIND_MY_CONSTRUCTION_SITES)) {
		tasks.push({
			id: `${TASK_TYPES.BUILD}:${site.id}`,
			type: TASK_TYPES.BUILD,
			priority: config.PRIORITY.BUILD,
			targetId: site.id,
		});
	}
}

function addRepairTasks(room, tasks) {
	const structures = room.find(FIND_STRUCTURES, {
		filter: structure => structure.hits < structure.hitsMax * config.REPAIR_HP_THRESHOLD,
	});
	for (const structure of structures) {
		tasks.push({
			id: `${TASK_TYPES.REPAIR}:${structure.id}`,
			type: TASK_TYPES.REPAIR,
			priority: config.PRIORITY.REPAIR,
			targetId: structure.id,
		});
	}
}

function addUpgradeTask(room, tasks) {
	const controller = room.controller;
	const controllerMissingOrNotMine = !controller || !controller.my;
	if (controllerMissingOrNotMine) return;

	tasks.push({
		id: `${TASK_TYPES.UPGRADE}:${controller.id}`,
		type: TASK_TYPES.UPGRADE,
		priority: config.PRIORITY.UPGRADE,
		targetId: controller.id,
	});
}

function hasCapabilityForTask(creep, taskType) {
	const partTypes = _.map(creep.body, part => part.type);

	if (taskType === TASK_TYPES.DEFENSE) {
		return partTypes.includes(ATTACK) || partTypes.includes(RANGED_ATTACK);
	}
	if (taskType === TASK_TYPES.HARVEST) {
		return partTypes.includes(WORK);
	}
	if (taskType === TASK_TYPES.REFILL_SPAWN || taskType === TASK_TYPES.REFILL_TOWER) {
		return partTypes.includes(CARRY);
	}
	return partTypes.includes(WORK) && partTypes.includes(CARRY);
}

function isCreepReadyForTask(creep, taskType) {
	const gatheringTask = taskType === TASK_TYPES.HARVEST || taskType === TASK_TYPES.DEFENSE;
	if (gatheringTask) return true;

	return creep.store[RESOURCE_ENERGY] > 0;
}

function canCreepDoTask(creep, task) {
	if (!hasCapabilityForTask(creep, task.type)) return false;
	return isCreepReadyForTask(creep, task.type);
}

function isCreepIdle(creep) {
	return !creep.memory.task;
}

function assignTasks(room, taskQueue) {
	const idleCreeps = _.filter(Game.creeps, creep => creep.room.name === room.name && isCreepIdle(creep));

	for (const task of taskQueue) {
		if (idleCreeps.length === 0) break;

		const creepIndex = _.findIndex(idleCreeps, creep => canCreepDoTask(creep, task));
		const noCreepAvailable = creepIndex === -1;
		if (noCreepAvailable) continue;

		const creep = idleCreeps[creepIndex];
		creep.memory.task = task;
		idleCreeps.splice(creepIndex, 1);
		log(`assign ${task.type} -> ${creep.name} (${task.id})`);
	}
}

function updateBacklog(taskQueue) {
	const assignedTaskIds = getAssignedTaskIds();

	for (const task of taskQueue) {
		const backlogExempt = task.type === TASK_TYPES.UPGRADE;
		const isAssigned = assignedTaskIds.has(task.id);

		if (backlogExempt || isAssigned) {
			delete Memory.taskBacklog[task.id];
			continue;
		}

		const alreadyTracked = task.id in Memory.taskBacklog;
		if (!alreadyTracked) {
			Memory.taskBacklog[task.id] = Game.time;
		}
	}
}

function getAssignedTaskIds() {
	const ids = new Set();
	for (const name in Game.creeps) {
		const task = Game.creeps[name].memory.task;
		if (task) ids.add(task.id);
	}
	return ids;
}

function runTaskQueue(room) {
	const taskQueue = buildTaskQueue(room);
	updateBacklog(taskQueue);
	assignTasks(room, taskQueue);
}

module.exports = { runTaskQueue };

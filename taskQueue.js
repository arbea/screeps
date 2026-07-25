const TASK_TYPES = require('./taskTypes');
const config = require('./config');
const { logAssign, logDefense, describeTask } = require('./log');

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

	logDefense(room, target);
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

// A source has at most 8 walkable adjacent tiles, so that's the real-world ceiling on
// concurrent harvesters regardless of what config.MAX_HARVESTERS_PER_SOURCE says. config
// values can come from Memory (dashboard-editable, external input), so a malformed or
// mistyped override can't be trusted to stay within a sane range.
const MAX_HARVESTERS_HARD_CAP = 8;

function clampMaxHarvesters(value) {
	const invalid = typeof value !== 'number' || !Number.isFinite(value) || value < 0;
	if (invalid) return 3;
	return Math.min(value, MAX_HARVESTERS_HARD_CAP);
}

function addHarvestTasks(room, tasks) {
	const sources = room.find(FIND_SOURCES_ACTIVE);
	const maxHarvesters = clampMaxHarvesters(config.MAX_HARVESTERS_PER_SOURCE);

	for (const source of sources) {
		const openSlots = Math.max(0, maxHarvesters - countCreepsAssignedTo(source.id));
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
	for (const structureId of getRepairTargetIds(room)) {
		tasks.push({
			id: `${TASK_TYPES.REPAIR}:${structureId}`,
			type: TASK_TYPES.REPAIR,
			priority: config.PRIORITY.REPAIR,
			targetId: structureId,
		});
	}
}

// FIND_STRUCTURES scans every structure in the room (roads included), which is one of the
// costliest room.find calls available; structure HP changes slowly, so the result is cached
// and only rescanned every REPAIR_SCAN_INTERVAL ticks instead of every tick.
function getRepairTargetIds(room) {
	if (!Memory.repairCache) Memory.repairCache = {};

	const cache = Memory.repairCache[room.name];
	const stale = !cache || Game.time - cache.lastScan >= config.REPAIR_SCAN_INTERVAL;
	if (!stale) return cache.ids;

	const structures = room.find(FIND_STRUCTURES, {
		filter: structure => structure.hits < structure.hitsMax * config.REPAIR_HP_THRESHOLD,
	});
	Memory.repairCache[room.name] = { lastScan: Game.time, ids: structures.map(structure => structure.id) };
	return Memory.repairCache[room.name].ids;
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
		logAssign(creep, task, Game.getObjectById(task.targetId));
	}
}

function updateBacklog(taskQueue) {
	const assignments = getTaskAssignments();

	for (const task of taskQueue) {
		const backlogExempt = task.type === TASK_TYPES.UPGRADE;
		const isAssigned = assignments.has(task.id);

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

function getTaskAssignments() {
	const assignments = new Map();
	for (const name in Game.creeps) {
		const task = Game.creeps[name].memory.task;
		if (task) assignments.set(task.id, name);
	}
	return assignments;
}

function publishSnapshot(room, taskQueue) {
	const assignments = getTaskAssignments();
	if (!Memory.taskSnapshot) Memory.taskSnapshot = {};

	Memory.taskSnapshot[room.name] = taskQueue.map(task => {
		const firstSeenTick = Memory.taskBacklog[task.id];
		return {
			id: task.id,
			type: task.type,
			priority: task.priority,
			description: describeTask(task, Game.getObjectById(task.targetId)),
			assignedTo: assignments.get(task.id) || null,
			backlogTicks: firstSeenTick ? Game.time - firstSeenTick : 0,
		};
	});
}

function runTaskQueue(room) {
	const taskQueue = buildTaskQueue(room);
	updateBacklog(taskQueue);
	assignTasks(room, taskQueue);

	const isSnapshotTick = Game.time % config.SNAPSHOT_INTERVAL === 0;
	if (isSnapshotTick) publishSnapshot(room, taskQueue);
}

module.exports = { runTaskQueue };

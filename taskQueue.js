const TASK_TYPES = require('./taskTypes');
const config = require('./config');
const { logAssign, logDefense, describeTask } = require('./log');
const expansion = require('./expansion');
const mining = require('./mining');

function buildTaskQueue(room) {
	const tasks = [];

	addDefenseTasks(room, tasks);
	addRefillTasks(room, tasks);
	addMiningTasks(room, tasks);
	addBuildTasks(room, tasks);
	addRepairTasks(room, tasks);
	addUpgradeTask(room, tasks);
	tasks.push(...expansion.runExpansion(room));

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

// Stationary mining: one dedicated miner sits on a source and harvests forever (a MINE
// task never completes), dropping energy at its own position - onto a container there if
// one has been built. A separate hauler task ferries whatever accumulates back to base.
// This replaces the old "several generalists each self-haul" harvest pattern, which wastes
// travel time and under-utilizes a source's regen rate compared to one saturated miner.
function addMiningTasks(room, tasks) {
	const sources = room.find(FIND_SOURCES_ACTIVE);

	for (const source of sources) {
		ensureContainerSite(room, source);

		// How many miners a source supports is capped by whichever is smaller: how many
		// walkable tiles surround it, or how many are needed to saturate its regen rate given
		// the current (energy-capacity-limited) miner body size - extra miners beyond either
		// limit don't add throughput, they just crowd the tile.
		const maxMiners = mining.maxMinersForSource(room, source);
		const currentMiners = countCreepsAssignedTo(source.id, TASK_TYPES.MINE);
		const openMinerSlots = Math.max(0, maxMiners - currentMiners);
		for (let slot = 0; slot < openMinerSlots; slot++) {
			tasks.push({
				id: `${TASK_TYPES.MINE}:${source.id}:${currentMiners + slot}`,
				type: TASK_TYPES.MINE,
				priority: config.PRIORITY.HARVEST,
				targetId: source.id,
			});
		}

		// A single hauler slot starves the moment a source has more than one miner (or a fast
		// miner) feeding it faster than one hauler can clear - open more slots when there's
		// more energy sitting at the source than one hauler trip can carry, capped by the same
		// tile-count ceiling as mining.
		const haulSlots = countHaulSlotsNeeded(room, source);
		const currentHaulers = countCreepsAssignedTo(source.id, TASK_TYPES.HAUL);
		const openHaulSlots = Math.max(0, haulSlots - currentHaulers);
		for (let slot = 0; slot < openHaulSlots; slot++) {
			tasks.push({
				id: `${TASK_TYPES.HAUL}:${source.id}:${currentHaulers + slot}`,
				type: TASK_TYPES.HAUL,
				priority: config.PRIORITY.HAUL,
				targetId: source.id,
			});
		}
	}
}

const HAULER_CAPACITY_ESTIMATE = 50; // conservative baseline; matches the default generalist body

function countHaulSlotsNeeded(room, source) {
	const container = source.pos.findInRange(FIND_STRUCTURES, 1, {
		filter: structure => structure.structureType === STRUCTURE_CONTAINER,
	})[0];
	const stored = container ? container.store[RESOURCE_ENERGY] : 0;
	const dropped = source.pos
		.findInRange(FIND_DROPPED_RESOURCES, 2)
		.reduce((sum, resource) => sum + resource.amount, 0);

	const neededByVolume = Math.ceil((stored + dropped) / HAULER_CAPACITY_ESTIMATE);
	const accessibleTileCount = mining.getAccessibleTiles(room, source.pos).length;

	return Math.max(1, Math.min(neededByVolume, accessibleTileCount));
}

// Only scans for an existing container/site when neither is cached yet, and only actually
// tries placement on the same cadence as the (already throttled) repair scan - this never
// runs room.find every tick.
function ensureContainerSite(room, source) {
	if (!config.AUTO_BUILD_CONTAINERS) return;
	if (!Memory.containerSites) Memory.containerSites = {};
	if (Memory.containerSites[source.id]) return;

	const isScanTick = Game.time % config.REPAIR_SCAN_INTERVAL === 0;
	if (!isScanTick) return;

	const hasContainer = source.pos.findInRange(FIND_STRUCTURES, 1, {
		filter: structure => structure.structureType === STRUCTURE_CONTAINER,
	}).length > 0;
	const hasSite = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
		filter: site => site.structureType === STRUCTURE_CONTAINER,
	}).length > 0;
	if (hasContainer || hasSite) {
		Memory.containerSites[source.id] = true;
		return;
	}

	placeContainerNear(room, source);
}

function placeContainerNear(room, source) {
	const tile = mining.getAccessibleTiles(room, source.pos)[0];
	if (!tile) return;

	room.createConstructionSite(tile.x, tile.y, STRUCTURE_CONTAINER);
}

function countCreepsAssignedTo(targetId, taskType) {
	return _.filter(
		Game.creeps,
		creep => creep.memory.task && creep.memory.task.targetId === targetId && (!taskType || creep.memory.task.type === taskType)
	).length;
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

	if (taskType === TASK_TYPES.DEFENSE || taskType === TASK_TYPES.REMOTE_DEFENSE) {
		return partTypes.includes(ATTACK) || partTypes.includes(RANGED_ATTACK);
	}
	if (taskType === TASK_TYPES.HARVEST || taskType === TASK_TYPES.REMOTE_HARVEST) {
		return partTypes.includes(WORK);
	}
	if (taskType === TASK_TYPES.REFILL_SPAWN || taskType === TASK_TYPES.REFILL_TOWER || taskType === TASK_TYPES.HAUL) {
		return partTypes.includes(CARRY);
	}
	if (taskType === TASK_TYPES.SCOUT) {
		return creep.memory.role === 'scout';
	}
	if (taskType === TASK_TYPES.MINE) {
		return creep.memory.role === 'miner' && partTypes.includes(WORK);
	}
	if (taskType === TASK_TYPES.RESERVE_CONTROLLER) {
		return partTypes.includes(CLAIM);
	}
	return partTypes.includes(WORK) && partTypes.includes(CARRY);
}

function isCreepReadyForTask(creep, taskType) {
	const gatheringTask =
		taskType === TASK_TYPES.HARVEST ||
		taskType === TASK_TYPES.DEFENSE ||
		taskType === TASK_TYPES.REMOTE_HARVEST ||
		taskType === TASK_TYPES.REMOTE_DEFENSE ||
		taskType === TASK_TYPES.SCOUT ||
		taskType === TASK_TYPES.RESERVE_CONTROLLER ||
		taskType === TASK_TYPES.MINE;
	if (gatheringTask) return true;

	const alwaysPicksUpFirst = taskType === TASK_TYPES.HAUL;
	if (alwaysPicksUpFirst) return true;

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

	// Task lists are rebuilt fresh every tick (same id, new object), so a task already held by
	// a non-idle creep from a previous tick would otherwise look "unclaimed" here and get
	// handed to a second creep too - this shows up worst on multi-tick tasks (HAUL, MINE,
	// RESERVE_CONTROLLER) that don't finish in the same tick they're assigned.
	const activeTaskIds = getTaskAssignments();

	for (const task of taskQueue) {
		if (idleCreeps.length === 0) break;
		if (activeTaskIds.has(task.id)) continue;

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

const TASK_TYPES = require('./taskTypes');
const config = require('./config');
const { logAssign, logDefense, describeTask } = require('./log');
const expansion = require('./expansion');
const mining = require('./mining');
const buildOrder = require('./buildOrder');

function buildTaskQueue(room) {
	const tasks = [];

	ensureExtensionSites(room);
	addDefenseTasks(room, tasks);
	addRefillTasks(room, tasks);
	addMiningTasks(room, tasks);
	addBuildTasks(room, tasks);
	addRepairTasks(room, tasks);
	addUpgradeTask(room, tasks);
	addRecycleTasks(room, tasks);
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

// Energy sitting in spawn and extensions is the room's whole spawning budget: the body it can
// build is decided by energyAvailable at that instant, not by the capacity it theoretically has.
// Empty extensions are therefore the same kind of hard block as an expiring downgrade timer -
// they cap every creep the room can produce - so the configured priority acts as the baseline for
// full stores and rises as they drain, reaching defense-level urgency when they are empty. How
// the room values refilling against building stays a strategy choice; how badly it currently
// needs it is read from the stores. Both numbers are plain Room properties, so this costs nothing.
function refillPriority(room) {
	const capacity = room.energyCapacityAvailable;
	if (!capacity) return config.PRIORITY.REFILL_SPAWN;

	const filled = Math.max(0, Math.min(1, room.energyAvailable / capacity));
	const spread = config.PRIORITY.DEFENSE - config.PRIORITY.REFILL_SPAWN;
	return Math.round(config.PRIORITY.REFILL_SPAWN + spread * (1 - filled));
}

function addRefillTasks(room, tasks) {
	const spawnsAndExtensions = room.find(FIND_MY_STRUCTURES, {
		filter: structure =>
			(structure.structureType === STRUCTURE_SPAWN || structure.structureType === STRUCTURE_EXTENSION) &&
			structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
	});
	const priority = refillPriority(room);
	for (const structure of spawnsAndExtensions) {
		tasks.push({
			id: `${TASK_TYPES.REFILL_SPAWN}:${structure.id}`,
			type: TASK_TYPES.REFILL_SPAWN,
			priority,
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
		// Each miner is given one specific square rather than "somewhere next to the source":
		// two miners told only to approach the source path to the same nearest square and shove
		// each other off it forever. Keying the task by its square (instead of a slot number)
		// also keeps ids stable when a miner dies - the survivors keep their squares, and only
		// the vacated one is reissued.
		const maxMiners = mining.maxMinersForSource(room, source);
		const currentMiners = countCreepsAssignedTo(source.id, TASK_TYPES.MINE);
		const claimedTiles = getClaimedMineTiles(source.id);
		const freeTiles = mining.getMiningTiles(room, source).filter(tile => !claimedTiles.has(`${tile.x},${tile.y}`));

		const openMinerSlots = Math.max(0, Math.min(maxMiners - currentMiners, freeTiles.length));
		for (let slot = 0; slot < openMinerSlots; slot++) {
			const tile = freeTiles[slot];
			tasks.push({
				id: `${TASK_TYPES.MINE}:${source.id}:${tile.x},${tile.y}`,
				type: TASK_TYPES.MINE,
				priority: config.PRIORITY.HARVEST,
				targetId: source.id,
				workPos: { x: tile.x, y: tile.y },
			});
		}

		// A single hauler slot starves the moment a source has more than one miner (or a fast
		// miner) feeding it faster than one hauler can clear - open more slots when there's
		// more energy sitting at the source than one hauler trip can carry, capped by the same
		// tile-count ceiling as mining.
		const haulSlots = mining.haulSlotsForSource(room, source);
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

		// An idle, empty-handed generalist that can't get a HAUL slot (e.g. the other source
		// is temporarily depleted, or every slot is already taken) has no way to earn energy
		// for BUILD/REPAIR/UPGRADE and just sits there. A last-resort, lowest-priority self-
		// serve harvest fills whatever tile space the dedicated miners aren't already using,
		// so idle labor can still make itself useful instead of waiting on nothing.
		const fallbackSlots = mining.fallbackHarvestSlotsForSource(room, source);
		const currentFallbackHarvesters = countCreepsAssignedTo(source.id, TASK_TYPES.HARVEST);
		const openFallbackSlots = Math.max(0, fallbackSlots - currentFallbackHarvesters);
		for (let slot = 0; slot < openFallbackSlots; slot++) {
			tasks.push({
				id: `${TASK_TYPES.HARVEST}:${source.id}:${currentFallbackHarvesters + slot}`,
				type: TASK_TYPES.HARVEST,
				priority: config.PRIORITY.HARVEST_FALLBACK,
				targetId: source.id,
			});
		}
	}
}

// A miner is WORK and MOVE only - with no carry capacity it cannot build, haul or upgrade, so a
// miner without a square to work is worth nothing alive. Surplus appears on its own as the room
// grows: bigger bodies saturate a source with fewer miners, so maxMinersForSource shrinks and the
// older, smaller miners become redundant. Recycling returns half their build cost and frees the
// square they were standing on, which beats waiting out their remaining lifetime.
//
// Squares, not miner headcount, decide who is surplus - only miners that failed to claim one are
// recycled, so this can never take a miner away from a source that still has room for it.
function addRecycleTasks(room, tasks) {
	const spawn = room.find(FIND_MY_SPAWNS)[0];
	if (!spawn) return;

	for (const name in Game.creeps) {
		const creep = Game.creeps[name];
		const idleMinerHere = creep.room.name === room.name && creep.memory.role === 'miner' && !creep.memory.task;
		if (!idleMinerHere) continue;

		tasks.push({
			id: `${TASK_TYPES.RECYCLE}:${creep.name}`,
			type: TASK_TYPES.RECYCLE,
			priority: config.PRIORITY.HARVEST_FALLBACK,
			targetId: spawn.id,
			recycleCreepName: creep.name,
		});
	}
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

// Extensions are what raises energyCapacityAvailable, and until they exist the room can't
// afford the bigger bodies (remote harvester, reserver) that everything past the home room
// depends on. How many are allowed is fixed by the game per controller level and where they
// can go is dictated by the terrain around the spawn - neither is a strategy choice, so both
// are derived here rather than exposed as a count or a hand-authored layout to configure.
function ensureExtensionSites(room) {
	const isScanTick = Game.time % config.REPAIR_SCAN_INTERVAL === 0;
	if (!isScanTick) return;

	const spawn = room.find(FIND_MY_SPAWNS)[0];
	if (!spawn) return;

	const allowed = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][room.controller.level];
	const built = room.find(FIND_MY_STRUCTURES, {
		filter: structure => structure.structureType === STRUCTURE_EXTENSION,
	}).length;
	const queued = room.find(FIND_MY_CONSTRUCTION_SITES, {
		filter: site => site.structureType === STRUCTURE_EXTENSION,
	}).length;

	const missing = allowed - built - queued;
	if (missing <= 0) return;

	placeExtensionSites(room, spawn, missing);
}

// A radius-6 box around the spawn already holds more same-parity tiles than the 60 extensions
// the game allows even at RCL 8, so the search never needs to sweep the whole room.
const EXTENSION_SEARCH_RADIUS = 6;

function isTileEmpty(room, x, y) {
	const occupied =
		room.lookForAt(LOOK_STRUCTURES, x, y).length > 0 || room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y).length > 0;
	return !occupied;
}

// Places extensions only on tiles sharing the spawn's parity, which leaves every
// opposite-parity tile free: each extension keeps all four of its orthogonal neighbours
// walkable, so a growing cluster can never seal the spawn in or block its own refill route.
function placeExtensionSites(room, spawn, count) {
	const terrain = room.getTerrain();
	const parity = (spawn.pos.x + spawn.pos.y) % 2;
	let placed = 0;

	for (let radius = 1; radius <= EXTENSION_SEARCH_RADIUS; radius++) {
		for (let dx = -radius; dx <= radius; dx++) {
			for (let dy = -radius; dy <= radius; dy++) {
				const enoughPlaced = placed >= count;
				if (enoughPlaced) return;

				// Only the outermost band of each box is new; inner tiles were covered by a
				// smaller radius already.
				const onRingEdge = Math.abs(dx) === radius || Math.abs(dy) === radius;
				if (!onRingEdge) continue;

				const x = spawn.pos.x + dx;
				const y = spawn.pos.y + dy;
				const inBounds = x >= 1 && x <= 48 && y >= 1 && y <= 48;
				if (!inBounds) continue;
				if ((x + y) % 2 !== parity) continue;
				if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
				if (!isTileEmpty(room, x, y)) continue;

				const created = room.createConstructionSite(x, y, STRUCTURE_EXTENSION) === OK;
				if (created) placed++;
			}
		}
	}
}

function getClaimedMineTiles(sourceId) {
	const claimed = new Set();
	for (const name in Game.creeps) {
		const task = Game.creeps[name].memory.task;
		const holdsTileHere = task && task.type === TASK_TYPES.MINE && task.targetId === sourceId && task.workPos;
		if (holdsTileHere) claimed.add(`${task.workPos.x},${task.workPos.y}`);
	}
	return claimed;
}

function countCreepsAssignedTo(targetId, taskType) {
	return _.filter(
		Game.creeps,
		creep => creep.memory.task && creep.memory.task.targetId === targetId && (!taskType || creep.memory.task.type === taskType)
	).length;
}

function addBuildTasks(room, tasks) {
	const underAttack = room.find(FIND_HOSTILE_CREEPS).length > 0;

	for (const site of room.find(FIND_MY_CONSTRUCTION_SITES)) {
		tasks.push({
			id: `${TASK_TYPES.BUILD}:${site.id}`,
			type: TASK_TYPES.BUILD,
			priority: buildOrder.buildPriority(room, site.structureType, underAttack),
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

// The downgrade clock is a hard game deadline, not a strategy call: let it run out and the room
// drops a controller level, taking every extension that level allowed with it. So the configured
// UPGRADE priority is only the baseline for a full clock - as it runs down the task escalates
// continuously toward defense-level urgency. Continuous rather than a threshold means there's no
// "how close is too close" number to guess, and a single upgrade refills the clock and drops the
// priority straight back to baseline, so the room spends only as much on it as the clock demands.
function upgradePriority(controller) {
	const fullClock = CONTROLLER_DOWNGRADE[controller.level];
	if (!fullClock) return config.PRIORITY.UPGRADE;

	const clockRemaining = Math.max(0, Math.min(1, controller.ticksToDowngrade / fullClock));
	const spread = config.PRIORITY.DEFENSE - config.PRIORITY.UPGRADE;
	return Math.round(config.PRIORITY.UPGRADE + spread * (1 - clockRemaining));
}

function addUpgradeTask(room, tasks) {
	const controller = room.controller;
	const controllerMissingOrNotMine = !controller || !controller.my;
	if (controllerMissingOrNotMine) return;

	tasks.push({
		id: `${TASK_TYPES.UPGRADE}:${controller.id}`,
		type: TASK_TYPES.UPGRADE,
		priority: upgradePriority(controller),
		targetId: controller.id,
	});
}

function hasCapabilityForTask(creep, taskType) {
	const partTypes = _.map(creep.body, part => part.type);

	if (taskType === TASK_TYPES.DEFENSE || taskType === TASK_TYPES.REMOTE_DEFENSE) {
		return partTypes.includes(ATTACK) || partTypes.includes(RANGED_ATTACK);
	}
	// CARRY as well as WORK: the point of the fallback harvest is to come away holding energy to
	// spend on BUILD/REPAIR/UPGRADE. A miner has WORK but no carry capacity at all, so runHarvest
	// reads it as instantly full and reports the task done every tick - it churns tasks forever
	// without ever gathering anything.
	if (taskType === TASK_TYPES.HARVEST) {
		return partTypes.includes(WORK) && partTypes.includes(CARRY);
	}
	// Unlike HARVEST, this must stay restricted to the 'remoteHarvester' role: that's the only
	// body built with CARRY parts (creepBodies.buildRemoteHarvesterBody) and homeRoom memory
	// (expansion.js). A 'miner' also has WORK parts but zero CARRY capacity and no homeRoom, so
	// if it slipped in here runRemoteHarvest's "am I full" check reads 0/0 as permanently full
	// and the creep just loops toward `RoomPosition(25,25,undefined)` instead of ever mining.
	if (taskType === TASK_TYPES.REMOTE_HARVEST) {
		return creep.memory.role === 'remoteHarvester' && partTypes.includes(WORK);
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
	// Matched by name rather than by body: a recycle task names the single creep it disposes of,
	// and any other creep taking it would walk to the spawn and destroy itself.
	if (task.type === TASK_TYPES.RECYCLE) return creep.name === task.recycleCreepName;

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

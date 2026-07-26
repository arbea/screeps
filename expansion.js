const config = require('./config');
const TASK_TYPES = require('./taskTypes');
const { log } = require('./log');
const creepBodies = require('./creepBodies');
const hostiles = require('./hostiles');
const spawnOrder = require('./spawnOrder');
const taskOrder = require('./taskOrder');

function getAdjacentRoomNames(roomName) {
	return Object.values(Game.map.describeExits(roomName) || {});
}

// Scans every currently-visible non-owned room (a room only shows up in Game.rooms when a
// creep is physically there, so this never spends CPU "looking" for rooms - it just records
// what we already have visibility into for free) and remembers it for future scoring.
function updateRoomIntel() {
	if (!Memory.rooms) Memory.rooms = {};

	for (const roomName in Game.rooms) {
		const room = Game.rooms[roomName];
		const owned = room.controller && room.controller.my;
		if (owned) continue;

		const sources = room.find(FIND_SOURCES);

		// Towers and spawns are what decide whether a room can be taken, and tower energy decides
		// it more precisely than tower count - an empty tower shoots at nothing. The alliance
		// protocol feeds these straight into an ally's engagement maths, so they are recorded for
		// every visible room rather than only our own expansion candidates.
		const towers = room.find(FIND_HOSTILE_STRUCTURES, {
			filter: structure => structure.structureType === STRUCTURE_TOWER,
		});

		const previous = Memory.rooms[roomName] || {};
		Memory.rooms[roomName] = {
			lastSeen: Game.time,
			sourceIds: sources.map(source => source.id),
			controllerId: room.controller ? room.controller.id : null,
			owner: room.controller && room.controller.owner ? room.controller.owner.username : null,
			reservedBy: room.controller && room.controller.reservation ? room.controller.reservation.username : null,
			hostileCount: hostiles.findThreateningCreeps(room).length,
			towers: towers.length,
			towerEnergy: towers.reduce((sum, tower) => sum + (tower.store ? tower.store[RESOURCE_ENERGY] : 0), 0),
			spawns: room.find(FIND_HOSTILE_SPAWNS).length,
			// Carried over rather than recomputed: this record is rebuilt every intel tick, but
			// reachability rests on PathFinder work redone only every REACHABILITY_RECHECK_TICKS.
			unreachableSources: previous.unreachableSources,
			reachabilityAt: previous.reachabilityAt,
		};

		const isRemoteRoom = (Memory.remoteRooms || []).includes(roomName);
		if (isRemoteRoom) updateSourceReachability(room);
	}
}

// A remote source only counts as operating if a creep that has entered from our side can walk to
// it without leaving the room again. E47S28's relic walls sealed the pocket behind our entry:
// PathFinder still "reached" (27,20) by exiting through a second door and re-entering elsewhere,
// a 190-step detour that turned each 50-energy trip into a 600-tick loss. Confining the test to
// the room (maxRooms: 1) is exactly what makes that detour count as no route at all.
const REACHABILITY_RECHECK_TICKS = 500;

const EXIT_FIND_BY_DIRECTION = {
	1: FIND_EXIT_TOP,
	3: FIND_EXIT_RIGHT,
	5: FIND_EXIT_BOTTOM,
	7: FIND_EXIT_LEFT,
};

// The tiles our creeps can arrive on: this room's exits toward any owned neighbour. Every tile,
// not a sample - the first version took every third one and branded a reachable source as walled
// off, because the one corridor through the relic walls was narrower than the sampling stride.
function entryTilesFromHome(room) {
	const tiles = [];
	const exits = Game.map.describeExits(room.name) || {};
	for (const direction in exits) {
		const neighbour = Game.rooms[exits[direction]];
		const neighbourIsOurs = neighbour && neighbour.controller && neighbour.controller.my;
		if (!neighbourIsOurs) continue;

		for (const tile of room.find(EXIT_FIND_BY_DIRECTION[direction]) || []) tiles.push(tile);
	}
	return tiles;
}

function structuresBlockedCosts(room) {
	const costs = new PathFinder.CostMatrix();
	for (const structure of room.find(FIND_STRUCTURES)) {
		if (structure.structureType === STRUCTURE_ROAD) costs.set(structure.pos.x, structure.pos.y, 1);
		else if (structure.structureType !== STRUCTURE_CONTAINER && structure.structureType !== STRUCTURE_RAMPART) {
			costs.set(structure.pos.x, structure.pos.y, 0xff);
		}
	}
	return costs;
}

function updateSourceReachability(room) {
	const intel = Memory.rooms[room.name];
	if (!intel || !intel.sourceIds) return;

	const fresh = intel.reachabilityAt !== undefined && Game.time - intel.reachabilityAt < REACHABILITY_RECHECK_TICKS;
	if (fresh) return;

	const entries = entryTilesFromHome(room);
	if (entries.length === 0) return;

	const costs = structuresBlockedCosts(room);
	const unreachable = [];
	for (const source of room.find(FIND_SOURCES)) {
		const reachable = entries.some(entry => {
			const result = PathFinder.search(entry, { pos: source.pos, range: 1 }, {
				maxRooms: 1,
				maxOps: 4000,
				roomCallback: () => costs,
			});
			return !result.incomplete;
		});
		if (!reachable) unreachable.push(source.id);
	}

	if (unreachable.length > 0) log(`[外礦] ${room.name} 有 ${unreachable.length} 個礦源從我方入口無路可達,不列為運轉礦`);
	intel.unreachableSources = unreachable;
	intel.reachabilityAt = Game.time;
}

function scoreRoom(roomName) {
	const intel = Memory.rooms[roomName];
	if (!intel) return -Infinity;

	// Intel merged from an ally reports what they saw, which need not include a source survey. A
	// room nobody has stood in on our behalf cannot be scored as a mining candidate at all.
	if (!intel.sourceIds) return -Infinity;

	// A room an ally has claimed or reserved is theirs. Without the reservation check we would
	// keep sending reservers to overwrite their claim on a room they are already mining, which
	// is the same trespass as attacking them - just slower.
	const takenByAlly = hostiles.isAlly(intel.owner) || hostiles.isAlly(intel.reservedBy);

	// Only sources a creep can actually walk to count toward the room's worth - E47S28 has two,
	// both sealed behind relic walls, and scoring them kept a mining operation alive that no
	// creep could perform.
	const unreachable = new Set(intel.unreachableSources || []);
	const reachableSources = intel.sourceIds.filter(id => !unreachable.has(id));

	const disqualified = takenByAlly || !!intel.owner || reachableSources.length < config.MIN_SOURCES_FOR_REMOTE;
	if (disqualified) return -Infinity;

	return reachableSources.length * 10 - intel.hostileCount * 100;
}

// Adjacent room names are inherently capped at 4 (one per compass direction), so this can
// never grow the candidate pool beyond a handful of comparisons regardless of config values.
function pickBestUnclaimedCandidate(homeRoomName) {
	const active = new Set(Memory.remoteRooms);
	let best = null;
	let bestScore = -Infinity;

	for (const roomName of getAdjacentRoomNames(homeRoomName)) {
		if (active.has(roomName)) continue;
		const score = scoreRoom(roomName);
		if (score > bestScore) {
			bestScore = score;
			best = roomName;
		}
	}
	return bestScore > -Infinity ? best : null;
}

function getUnscoutedAdjacent(homeRoomName) {
	return getAdjacentRoomNames(homeRoomName).filter(roomName => !Memory.rooms[roomName]);
}

// How many remote rooms we can work isn't a preference either - it's however many we can actually
// staff. A remote room needs a harvester per source and a reserver, so the ceiling is what the
// room can afford to keep alive out there, and a room that cannot yet build a remote harvester at
// all supports none. Adjacent rooms cap it at four regardless, one per compass direction.
function maxRemoteRooms(homeRoom) {
	const harvesterBody = creepBodies.bodyFor('remoteHarvester', homeRoom.energyCapacityAvailable);
	if (!harvesterBody) return 0;

	// One room's worth of staff is a harvester for each of its sources plus a reserver; comparing
	// that against the energy the room can field at once gives how many we can sustain.
	const roomStaffCost = creepBodies.bodyCost(harvesterBody) * 2 + creepBodies.bodyCost(creepBodies.bodyFor('reserver', homeRoom.energyCapacityAvailable) || []);
	const affordable = Math.floor(homeRoom.energyCapacityAvailable * 2 / Math.max(1, roomStaffCost));

	return Math.max(0, Math.min(affordable, 4));
}

function maintainRemoteRoomList(homeRoomName) {
	if (!Memory.remoteRooms) Memory.remoteRooms = [];

	Memory.remoteRooms = Memory.remoteRooms.filter(roomName => {
		const stillGood = scoreRoom(roomName) > -Infinity;
		if (!stillGood) log(`[撤退] 放棄遠程房間 ${roomName}(不再適合開採)`);
		return stillGood;
	});

	const hasSlot = Memory.remoteRooms.length < maxRemoteRooms(Game.rooms[homeRoomName]);
	if (!hasSlot) return;

	const candidate = pickBestUnclaimedCandidate(homeRoomName);
	if (candidate) {
		Memory.remoteRooms.push(candidate);
		log(`[擴張] 選定遠程開採目標:${candidate}`);
	}
}

// Scouting is pure information-gathering with no ongoing cost once done, so unlike remote
// mining it isn't gated by how many remote rooms we're committed to working - one scout per
// still-unknown adjacent room, in parallel, uses idle labor without any downside.
function addScoutTasks(homeRoom, tasks) {
	for (const targetRoomName of getUnscoutedAdjacent(homeRoom.name)) {
		tasks.push({
			id: `${TASK_TYPES.SCOUT}:${targetRoomName}`,
			type: TASK_TYPES.SCOUT,
			priority: taskOrder.basePriority(TASK_TYPES.SCOUT),
			targetRoomName,
		});
	}
}

function addRemoteTasks(homeRoom, myUsername, tasks) {
	for (const roomName of Memory.remoteRooms || []) {
		const intel = Memory.rooms[roomName];
		if (!intel) continue;

		if (intel.hostileCount > 0 && config.DEFEND_REMOTE_ROOMS) {
			tasks.push({
				id: `${TASK_TYPES.REMOTE_DEFENSE}:${roomName}`,
				type: TASK_TYPES.REMOTE_DEFENSE,
				priority: taskOrder.basePriority(TASK_TYPES.REMOTE_DEFENSE),
				targetRoomName: roomName,
			});
		}

		// A reserver is CLAIM+MOVE and nothing smaller exists, so below its cost the room cannot
		// field one at any size. Emitting the task anyway put an impossible job at priority 80 that
		// sat unassigned for sixteen thousand ticks, outranking work that could actually be done.
		const canFieldAReserver = creepBodies.bodyFor('reserver', homeRoom.energyCapacityAvailable) !== null;
		const needsReservation = intel.controllerId && intel.reservedBy !== myUsername && canFieldAReserver;
		if (needsReservation) {
			tasks.push({
				id: `${TASK_TYPES.RESERVE_CONTROLLER}:${roomName}`,
				type: TASK_TYPES.RESERVE_CONTROLLER,
				priority: taskOrder.basePriority(TASK_TYPES.RESERVE_CONTROLLER),
				targetId: intel.controllerId,
				targetRoomName: roomName,
			});
		}

		const unreachable = new Set(intel.unreachableSources || []);
		for (const sourceId of intel.sourceIds) {
			// No route from our entry means not an operating source - harvesting it would spend
			// creep lifetimes on a detour that costs more than the energy it brings back.
			if (unreachable.has(sourceId)) continue;

			tasks.push({
				id: `${TASK_TYPES.REMOTE_HARVEST}:${sourceId}`,
				type: TASK_TYPES.REMOTE_HARVEST,
				priority: taskOrder.basePriority(TASK_TYPES.REMOTE_HARVEST),
				targetId: sourceId,
				targetRoomName: roomName,
			});
		}
	}
}

function runExpansion(homeRoom) {
	if (!config.EXPANSION_ENABLED) return [];

	// Intel gathering has moved to the kernel's own system, which owns when it runs; this only
	// consumes what that produced.
	const isExpansionTick = Game.time % config.EXPANSION_INTERVAL === 0;
	if (isExpansionTick) maintainRemoteRoomList(homeRoom.name);

	const myUsername = homeRoom.controller.owner.username;
	const tasks = [];
	addScoutTasks(homeRoom, tasks);
	addRemoteTasks(homeRoom, myUsername, tasks);
	return tasks;
}

function countCreepsWithRole(role) {
	return _.filter(Game.creeps, creep => creep.memory.role === role).length;
}

function countCreepsAssignedTo(targetId) {
	return _.filter(Game.creeps, creep => creep.memory.task && creep.memory.task.targetId === targetId).length;
}

function getExpansionSpawnRequests(homeRoom, myUsername) {
	const requests = [];
	if (!config.EXPANSION_ENABLED) return requests;

	// One scout per unscouted room is the natural ceiling here - spawning more than that would
	// just leave extras with nowhere new to explore, so the count comes from the map, not a knob.
	const unscoutedCount = getUnscoutedAdjacent(homeRoom.name).length;
	const needsScout = countCreepsWithRole('scout') < unscoutedCount;
	if (needsScout) {
		requests.push({ role: 'scout', priority: spawnOrder.spawnPriority('scout'), body: creepBodies.bodyFor('scout', homeRoom.energyCapacityAvailable), memory: { role: 'scout' } });
	}

	for (const roomName of Memory.remoteRooms || []) {
		const intel = Memory.rooms[roomName];
		if (!intel) continue;

		const underAttack = intel.hostileCount > 0 && config.DEFEND_REMOTE_ROOMS;
		if (underAttack && countCreepsWithRole('remoteDefender') === 0) {
			requests.push({
				role: 'remoteDefender',
				priority: spawnOrder.spawnPriority('remoteDefender'),
				body: creepBodies.bodyFor('remoteDefender', homeRoom.energyAvailable),
				memory: { role: 'remoteDefender', homeRoom: homeRoom.name },
			});
		}

		const needsReservation = intel.controllerId && intel.reservedBy !== myUsername;
		const hasReserver = _.filter(Game.creeps, creep => creep.memory.role === 'reserver' && creep.memory.targetRoom === roomName).length > 0;
		if (needsReservation && !hasReserver) {
			requests.push({
				role: 'reserver',
				priority: spawnOrder.spawnPriority('reserver'),
				body: creepBodies.bodyFor('reserver', homeRoom.energyCapacityAvailable),
				memory: { role: 'reserver', targetRoom: roomName },
			});
		}

		const unreachable = new Set(intel.unreachableSources || []);
		for (const sourceId of intel.sourceIds) {
			// Same rule as the task side: a source with no route from our entry gets no body
			// spawned for it either, or the spawn keeps replacing a creep the queue will never feed.
			if (unreachable.has(sourceId)) continue;

			const hasHarvester = countCreepsAssignedTo(sourceId) > 0;
			if (!hasHarvester) {
				requests.push({
					role: 'remoteHarvester',
					priority: spawnOrder.spawnPriority('remoteHarvester'),
					body: creepBodies.bodyFor('remoteHarvester', homeRoom.energyCapacityAvailable),
					memory: { role: 'remoteHarvester', homeRoom: homeRoom.name },
				});
			}
		}
	}

	return requests;
}

module.exports = { runExpansion, getExpansionSpawnRequests, updateRoomIntel };

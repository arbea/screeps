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
			// The breach plan survives the rebuild or there is no plan: dropping it here deleted
			// and re-derived it on every intel pass - the same 拆牆 line stamped into the event
			// log every ten ticks was this field being forgotten and planned again.
			breach: previous.breach,
		};

		// Any visible room bordering ours, not just active remotes: the expansion flow requires a
		// proven route before anything else, and a room dropped for having none must be re-tested
		// the next time somebody stands in it - that is how a wall breach turns back into mining.
		const exits = Object.values(Game.map.describeExits(roomName) || {});
		const bordersOurs = exits.some(name => {
			const neighbour = Game.rooms[name];
			return neighbour && neighbour.controller && neighbour.controller.my;
		});
		if (bordersOurs) {
			maintainBreach(room);
			updateSourceReachability(room);
			planBreach(room);
		}
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

// When every route to a source dies at a wall, the cheapest way through is itself a pathfinding
// question: let PathFinder walk THROUGH relic walls at a price scaled to their hit points, and
// the walls on the route it picks are the breach set. On E47S28 one 881k-hit wall on the south
// rim beat every alternative by millions of hits. Needs vision, which a scout provides.
function planBreach(room) {
	const intel = Memory.rooms[room.name];
	if (!intel || (intel.unreachableSources || []).length === 0) return;
	if (intel.breach && intel.breach.targets.length > 0) return;

	const entries = entryTilesFromHome(room);
	if (entries.length === 0) return;

	const walls = room.find(FIND_STRUCTURES, { filter: structure => structure.structureType === STRUCTURE_WALL });
	const costs = structuresBlockedCosts(room);
	// Re-priced from impassable to expensive: the cost tracks dismantle work, clamped into the
	// matrix's range, so the search minimises hits first and walking distance a far second.
	for (const wall of walls) {
		costs.set(wall.pos.x, wall.pos.y, Math.min(254, 50 + Math.floor(wall.hits / 100000)));
	}

	const targets = [];
	for (const sourceId of intel.unreachableSources) {
		const source = Game.getObjectById(sourceId);
		if (!source) continue;

		const result = PathFinder.search(source.pos, entries.map(pos => ({ pos, range: 0 })), {
			maxRooms: 1,
			maxOps: 20000,
			plainCost: 2,
			swampCost: 10,
			roomCallback: () => costs,
		});
		if (result.incomplete) continue;

		const wallsOnRoute = [];
		for (const step of result.path) {
			const wall = walls.find(candidate => candidate.pos.x === step.x && candidate.pos.y === step.y);
			const alreadyListed = wall && wallsOnRoute.some(listed => listed.id === wall.id);
			if (wall && !alreadyListed) wallsOnRoute.push(wall);
		}
		// The path runs source→entry but the breacher works entry→source, so the only wall it
		// can stand at is the last one the path met. Reversed, each wall in the plan becomes
		// reachable exactly when its predecessor falls.
		wallsOnRoute.reverse();
		for (const wall of wallsOnRoute) {
			const alreadyListed = targets.some(target => target.id === wall.id);
			if (!alreadyListed) targets.push({ id: wall.id, x: wall.pos.x, y: wall.pos.y, hits: wall.hits });
		}
	}
	if (targets.length === 0) {
		// Every route incomplete, or complete without a wall on it while reachability still says
		// no route - either way the pocket stays sealed with no plan, and that contradiction must
		// be visible rather than silent. One line per 500 ticks: this runs on every intel pass
		// for as long as the plan is missing, and the event log holds 150 entries.
		if (Game.time % 500 === 0) {
			log(`[拆牆] ${room.name} 規劃失敗:${intel.unreachableSources.length} 個不可達礦源,但找不到需要拆的牆`);
		}
		return;
	}

	intel.breach = { targets, plannedAt: Game.time };
	// Not a nested template literal - tools/check-references.js strips strings with a regex that
	// can't see past the inner backtick pair, and a checker nobody can run protects nobody.
	const described = targets.map(target => '(' + target.x + ',' + target.y + ') ' + target.hits).join('、');
	log(`[拆牆] ${room.name} 突破口:${described}`);
}

// A fallen breach wall means the map changed, so every route verdict is stale - clearing the
// timestamp is what lets mining resume by itself once the way is open.
function maintainBreach(room) {
	const intel = Memory.rooms[room.name];
	if (!intel || !intel.breach) return;

	const remaining = intel.breach.targets.filter(target => Game.getObjectById(target.id));
	if (remaining.length === intel.breach.targets.length) return;

	delete intel.reachabilityAt;
	if (remaining.length === 0) delete intel.breach;
	else intel.breach.targets = remaining;
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
	addBreachTasks(homeRoom, tasks);
	return tasks;
}

// The breach pipeline: a bordering room whose sources are all walled off needs eyes first (the
// plan needs vision), then its walls taken down one at a time. Not while somebody owns or
// garrisons the room - that would be siege work, and a different decision entirely.
function addBreachTasks(homeRoom, tasks) {
	for (const roomName of getAdjacentRoomNames(homeRoom.name)) {
		const intel = Memory.rooms[roomName];
		if (!intel) continue;
		if ((intel.unreachableSources || []).length === 0) continue;
		if (intel.owner || intel.hostileCount > 0) continue;

		if (!intel.breach) {
			// No plan yet - vision is the missing ingredient, and an idle MOVE creep standing in
			// the room is what turns its walls into a plan.
			const haveVision = Boolean(Game.rooms[roomName]);
			if (!haveVision) {
				tasks.push({
					id: `${TASK_TYPES.SCOUT}:${roomName}`,
					type: TASK_TYPES.SCOUT,
					priority: taskOrder.basePriority(TASK_TYPES.SCOUT),
					targetRoomName: roomName,
				});
			}
			continue;
		}

		// One wall at a time, in the plan's own order - the first is the one the route needs.
		const target = intel.breach.targets[0];
		tasks.push({
			id: `${TASK_TYPES.DISMANTLE}:${target.id}`,
			type: TASK_TYPES.DISMANTLE,
			priority: taskOrder.basePriority(TASK_TYPES.DISMANTLE),
			targetId: target.id,
			targetRoomName: roomName,
		});
	}
}

function countCreepsWithRole(role) {
	return _.filter(Game.creeps, creep => creep.memory.role === role).length;
}

function countCreepsAssignedTo(targetId) {
	return _.filter(Game.creeps, creep => creep.memory.task && creep.memory.task.targetId === targetId).length;
}

// One scout per unscouted room is the natural ceiling - spawning more than that would just
// leave extras with nowhere new to explore, so the count comes from the map, not a knob. Rooms
// waiting on a breach plan count too: the plan needs vision, vision needs a body in the room,
// and a room already surveyed once would otherwise never earn a second look. Shared with the
// recycler, which reads "the map demands zero scouts" off the same figure.
function scoutDemand(homeRoom) {
	const breachVisionRooms = getAdjacentRoomNames(homeRoom.name).filter(roomName => {
		const intel = Memory.rooms[roomName];
		return intel && (intel.unreachableSources || []).length > 0 && !intel.breach &&
			!intel.owner && !(intel.hostileCount > 0) && !Game.rooms[roomName];
	}).length;
	return getUnscoutedAdjacent(homeRoom.name).length + breachVisionRooms;
}

// Whether any bordering room still has breach work: a plan with walls standing, or a sealed
// pocket awaiting one. Wider than the spawn condition on purpose - the recycler uses this, and
// a breacher recycled in the gap between one plan falling and the next being derived would be
// re-spawned at full cost a few ticks later.
function breachWorkExists(homeRoom) {
	return getAdjacentRoomNames(homeRoom.name).some(roomName => {
		const intel = Memory.rooms[roomName];
		if (!intel || intel.owner || intel.hostileCount > 0) return false;
		const planned = intel.breach && intel.breach.targets.length > 0;
		const awaitingPlan = (intel.unreachableSources || []).length > 0;
		return planned || awaitingPlan;
	});
}

function getExpansionSpawnRequests(homeRoom, myUsername) {
	const requests = [];
	if (!config.EXPANSION_ENABLED) return requests;

	const needsScout = countCreepsWithRole('scout') < scoutDemand(homeRoom);
	if (needsScout) {
		// homeRoom stamped so an idle scout parked in a foreign room still belongs to the queue
		// that sent it - without it the creep matches no room's queue and can never be re-tasked.
		requests.push({ role: 'scout', priority: spawnOrder.spawnPriority('scout'), body: creepBodies.bodyFor('scout', homeRoom.energyCapacityAvailable), memory: { role: 'scout', homeRoom: homeRoom.name } });
	}

	// One breacher while any bordering room has a breach planned. Builders stay on their sites;
	// the wall wants a body that is all WORK and legs.
	const breachPlanned = getAdjacentRoomNames(homeRoom.name).some(roomName => {
		const intel = Memory.rooms[roomName];
		return intel && intel.breach && intel.breach.targets.length > 0 && !intel.owner && !(intel.hostileCount > 0);
	});
	if (breachPlanned && countCreepsWithRole('breacher') === 0) {
		requests.push({
			role: 'breacher',
			priority: spawnOrder.spawnPriority('breacher'),
			body: creepBodies.bodyFor('breacher', homeRoom.energyCapacityAvailable),
			memory: { role: 'breacher', homeRoom: homeRoom.name },
		});
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

module.exports = { runExpansion, getExpansionSpawnRequests, updateRoomIntel, scoutDemand, breachWorkExists };

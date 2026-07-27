const kernel = require('./kernel');

// PathFinder's budget, by CPU tier. Pathing is the single most expensive thing a creep does, and
// its cost scales with how hard the route is to find - so when the bucket is low we accept a worse
// route rather than spend the reserve computing a perfect one.
const MAX_OPS = { burst: 8000, normal: 4000, lean: 1500, crisis: 1500 };

// A creep that has not moved for this many ticks is not merely slow - something is standing where
// it wants to go. Two is the smallest number that distinguishes it from ordinary fatigue, which
// costs exactly one tick of standing still.
const STUCK_TICKS = 2;

function maxOps() {
	return MAX_OPS[kernel.currentMode()] || MAX_OPS.normal;
}

// Stored as a string of direction digits rather than a list of positions: a route of thirty steps
// is thirty characters instead of thirty objects, and Memory is serialised as JSON every tick, so
// its size is a running cost rather than a one-off.
function serializePath(startPos, path) {
	let directions = '';
	let current = startPos;

	for (const step of path) {
		directions += current.getDirectionTo(step);
		current = step;
	}
	return directions;
}

function samePosition(a, b) {
	return a && b && a.x === b.x && a.y === b.y && a.roomName === b.roomName;
}

function destinationOf(target) {
	return target.pos || target;
}

// Structures change on the order of hundreds of ticks - one extension finished, one road laid -
// but the matrix describing them was rebuilt from a full FIND_STRUCTURES scan on every single
// search. With twenty creeps re-pathing, that is the same room walked dozens of times a tick to
// learn something that did not change. Cached for as long as a structure scan stays true
// elsewhere in the bot (mapSnapshot uses the same interval for the same reason).
const MATRIX_CACHE_TICKS = 50;

// Heap, not Memory: a CostMatrix is a 2500-byte typed array, and Memory is serialised to JSON
// every tick. Losing the cache to a global reset costs one rebuild, which is what it cost before.
const matrixCache = {};

// PathFinder knows nothing about structures on its own - whatever the cost matrix doesn't mention
// is walkable to it. So every search has to start from this matrix, whatever else it adds on top.
function buildStructureCosts(room) {
	const costs = new PathFinder.CostMatrix();
	for (const structure of room.find(FIND_STRUCTURES)) {
		// Roads are what the traffic survey builds; pathing has to prefer them or laying
		// them changes nothing.
		if (structure.structureType === STRUCTURE_ROAD) costs.set(structure.pos.x, structure.pos.y, 1);
		else if (structure.structureType !== STRUCTURE_CONTAINER && structure.structureType !== STRUCTURE_RAMPART) {
			costs.set(structure.pos.x, structure.pos.y, 0xff);
		}
	}
	return costs;
}

// Construction finishing is the one structure change the bot causes itself and cares about
// immediately - a new extension the router still thinks is open ground is exactly the wall a
// creep gets told to walk through. Counting sites is far cheaper than rebuilding the matrix, so
// the count is the cache's freshness check between scheduled rebuilds.
function structureCosts(room) {
	const cached = matrixCache[room.name];
	const siteCount = room.find(FIND_MY_CONSTRUCTION_SITES).length;
	const fresh = cached && Game.time - cached.builtAt < MATRIX_CACHE_TICKS && cached.siteCount === siteCount;
	if (fresh) return cached.costs;

	matrixCache[room.name] = { costs: buildStructureCosts(room), builtAt: Game.time, siteCount };
	return matrixCache[room.name].costs;
}

// What a step actually costs is time, not distance, and time depends on the body. Each non-MOVE
// part generates 1 fatigue on road, 2 on plain, 10 on swamp; each MOVE part clears 2 per tick. So
// a 5-WORK/1-MOVE miner pays 3 ticks a step on road and 5 on plain, while a 1:1 hauler pays one
// tick on either - meaning the hauler gains nothing from a detour onto a road, and taking one
// costs it real time. Fixed weights of 2 and 10 described neither creep.
//
// Costs are expressed relative to a road step (the matrix marks roads 1), which is what lets the
// cached room matrix stay shared while each creep routes on its own clock. Cached on the creep
// because a body never changes.
function terrainCostsFor(creep) {
	const cached = creep.memory._terrain;
	if (cached) return cached;

	let moveParts = 0;
	let heavyParts = 0;
	for (const part of creep.body) {
		if (part.type === MOVE) moveParts++;
		else heavyParts++;
	}

	// No legs at all: nothing to weigh, and the engine's defaults are as good a guess as any.
	if (moveParts === 0) return { plainCost: 2, swampCost: 10 };

	const ticks = generated => Math.max(1, Math.ceil((heavyParts * generated) / (2 * moveParts)));
	const road = ticks(1);
	const costs = {
		plainCost: Math.max(1, Math.min(254, Math.round(ticks(2) / road))),
		swampCost: Math.max(1, Math.min(254, Math.round(ticks(10) / road))),
	};

	creep.memory._terrain = costs;
	return costs;
}

// The whole point of the override: a route is computed once and then followed from memory. Calling
// moveTo every tick recomputes the same path from a position one step further along, which is the
// same answer at full price - and at 20 CPU a tick with twenty creeps, it is most of the budget.
function findPath(creep, destination, range) {
	const terrain = terrainCostsFor(creep);
	const result = PathFinder.search(
		creep.pos,
		{ pos: destination, range },
		{
			maxOps: maxOps(),
			plainCost: terrain.plainCost,
			swampCost: terrain.swampCost,
			roomCallback(roomName) {
				const room = Game.rooms[roomName];
				if (!room) return;

				return structureCosts(room);
			},
		}
	);

	return result.incomplete && result.path.length === 0 ? null : result.path;
}

// Recomputed only when stuck, and only then are creeps treated as obstacles: they move, so routing
// around them normally would mean re-pathing constantly for blockages that clear themselves.
//
// Creeps are added ON TOP of the structure costs, not instead of them. This matrix used to start
// empty, so the detour route knew about creeps but had forgotten every wall the normal route
// avoided - one blocked step was enough to hand a creep a path straight through an extension,
// where it stood reissuing an accepted-but-impossible move, re-pathed on the same forgetful
// matrix two ticks later, and got the same path back. The miner that spent 349 ticks two tiles
// from its spawn point died of exactly this.
function findPathAroundCreeps(creep, destination, range) {
	const terrain = terrainCostsFor(creep);
	const result = PathFinder.search(
		creep.pos,
		{ pos: destination, range },
		{
			maxOps: maxOps(),
			plainCost: terrain.plainCost,
			swampCost: terrain.swampCost,
			roomCallback(roomName) {
				if (roomName !== creep.room.name) return;

				// Cloned, never written through: the cached matrix is shared by every creep in the
				// room, and stamping this tick's bodies into it would leave them there as permanent
				// walls long after they walked away.
				const costs = structureCosts(creep.room).clone();
				for (const other of creep.room.find(FIND_CREEPS)) {
					costs.set(other.pos.x, other.pos.y, 0xff);
				}
				return costs;
			},
		}
	);
	return result.path.length > 0 ? result.path : null;
}

const originalMoveTo = Creep.prototype.moveTo;

Creep.prototype.moveTo = function (first, second, third) {
	// Supports both call shapes the codebase uses: moveTo(target) and moveTo(x, y).
	const isCoordinatePair = typeof first === 'number';
	const destination = isCoordinatePair ? new RoomPosition(first, second, this.room.name) : destinationOf(first);
	const opts = (isCoordinatePair ? third : second) || {};
	const range = opts.range === undefined ? 1 : opts.range;

	if (!destination) return ERR_INVALID_TARGET;

	// Fatigued creeps cannot move at all, so spending anything on them is waste; importantly this
	// also keeps fatigue from being mistaken for being stuck.
	if (this.fatigue > 0) return ERR_TIRED;

	const arrived = this.pos.getRangeTo(destination) <= range;
	if (arrived) {
		delete this.memory._path;
		return OK;
	}

	const cached = this.memory._path;
	const sameDestination =
		cached && cached.dest.x === destination.x && cached.dest.y === destination.y && cached.dest.room === destination.roomName;

	// The step counter advances on having actually moved, never on move() returning OK. OK means
	// only that the intent was accepted - a creep told to walk into a wall gets OK and stays put.
	// Counting that as progress walks the cursor down a route the creep never travelled, so every
	// direction after it belongs to a square it isn't standing on, and it wanders until the path
	// runs out. Position is the only honest evidence a step happened.
	const currentPos = { x: this.pos.x, y: this.pos.y, roomName: this.pos.roomName };
	if (cached && cached.last) {
		const moved = !samePosition(cached.last, currentPos);
		if (moved) {
			cached.index++;
			cached.stuck = 0;
		} else {
			cached.stuck = (cached.stuck || 0) + 1;
		}
	}

	const stuckFor = cached ? cached.stuck || 0 : 0;
	const needsPath = !cached || !sameDestination || cached.index >= cached.path.length || stuckFor >= STUCK_TICKS;
	if (needsPath) {
		const path = stuckFor >= STUCK_TICKS
			? findPathAroundCreeps(this, destination, range) || findPath(this, destination, range)
			: findPath(this, destination, range);

		// No route at all - fall back to the engine's own mover rather than standing still, since
		// it may know something about the target this search did not.
		if (!path || path.length === 0) return originalMoveTo.call(this, first, second, third);

		this.memory._path = {
			dest: { x: destination.x, y: destination.y, room: destination.roomName },
			path: serializePath(this.pos, path),
			index: 0,
			stuck: 0,
		};
	}

	const move = this.memory._path;
	const result = this.move(Number(move.path[move.index]));

	// Recorded after the move is ordered but before it resolves, so next tick compares where the
	// creep meant to leave from against where it actually is.
	move.last = currentPos;

	return result;
};

module.exports = {};

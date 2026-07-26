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

// The whole point of the override: a route is computed once and then followed from memory. Calling
// moveTo every tick recomputes the same path from a position one step further along, which is the
// same answer at full price - and at 20 CPU a tick with twenty creeps, it is most of the budget.
function findPath(creep, destination, range) {
	const result = PathFinder.search(
		creep.pos,
		{ pos: destination, range },
		{
			maxOps: maxOps(),
			plainCost: 2,
			swampCost: 10,
			roomCallback(roomName) {
				const room = Game.rooms[roomName];
				if (!room) return;

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
			},
		}
	);

	return result.incomplete && result.path.length === 0 ? null : result.path;
}

// Recomputed only when stuck, and only then are creeps treated as obstacles: they move, so routing
// around them normally would mean re-pathing constantly for blockages that clear themselves.
function findPathAroundCreeps(creep, destination, range) {
	const blocked = new Set(creep.room.find(FIND_CREEPS).map(other => `${other.pos.x},${other.pos.y}`));

	const result = PathFinder.search(
		creep.pos,
		{ pos: destination, range },
		{
			maxOps: maxOps(),
			plainCost: 2,
			swampCost: 10,
			roomCallback(roomName) {
				if (roomName !== creep.room.name) return;

				const costs = new PathFinder.CostMatrix();
				for (const key of blocked) {
					const [x, y] = key.split(',').map(Number);
					costs.set(x, y, 0xff);
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

	// Standing on the same square as last tick, having intended to move, means something is in the
	// way rather than that the route was wrong.
	const stuck = cached && samePosition(cached.last, { x: this.pos.x, y: this.pos.y, roomName: this.pos.roomName });
	const stuckFor = stuck ? (cached.stuck || 0) + 1 : 0;

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
	} else {
		cached.stuck = stuckFor;
	}

	const move = this.memory._path;
	const direction = Number(move.path[move.index]);
	const result = this.move(direction);

	if (result === OK) move.index++;
	move.last = { x: this.pos.x, y: this.pos.y, roomName: this.pos.roomName };

	return result;
};

module.exports = {};

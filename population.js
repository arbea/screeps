const mining = require('./mining');

// A source regenerates its full 3000 over 300 ticks, so it yields 10 energy per tick no matter how
// it is worked. That rate, not the size of the pile, is what the haul fleet has to keep up with.
const SOURCE_OUTPUT_PER_TICK = SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME;

// Path length is a property of the terrain between two fixed points, so it is measured once with
// PathFinder and kept. Re-running a search every tick to learn a distance that cannot change is
// exactly the kind of cost that empties a CPU bucket.
function roundTripTicks(room, source) {
	if (!Memory.pathCache) Memory.pathCache = {};

	const spawn = room.find(FIND_MY_SPAWNS)[0];
	if (!spawn) return 0;

	const key = `${source.id}:${spawn.id}`;
	const cached = Memory.pathCache[key];
	if (cached !== undefined) return cached;

	const result = PathFinder.search(source.pos, { pos: spawn.pos, range: 1 });
	// An incomplete search means no route exists; storing it stops us searching again every tick.
	const trip = result.incomplete ? 0 : result.path.length * 2;

	Memory.pathCache[key] = trip;
	return trip;
}

function carryCapacityOf(body) {
	return body.filter(part => part === CARRY).length * CARRY_CAPACITY;
}

// Energy in flight is output × round trip: a hauler is away for the whole trip, so the fleet has to
// hold that much at once to keep a source drained. Dividing by what one body carries gives the
// number of them, which scales correctly as bodies grow - bigger haulers mean fewer of them, not
// the same count carrying more.
function haulerTarget(room, haulerBody) {
	const capacity = carryCapacityOf(haulerBody || []);
	if (!capacity) return 0;

	const inFlight = room
		.find(FIND_SOURCES)
		.reduce((sum, source) => sum + SOURCE_OUTPUT_PER_TICK * roundTripTicks(room, source), 0);

	return Math.ceil(inFlight / capacity);
}

function minerTarget(room) {
	return room.find(FIND_SOURCES_ACTIVE).reduce((sum, source) => sum + mining.maxMinersForSource(room, source), 0);
}

// Builders are sized by the work outstanding rather than by a headcount: 5000 energy of remaining
// construction is roughly one builder's worth of sustained work, so the crew grows with the queue
// and shrinks back to nothing when the room has finished building.
const BUILD_WORK_PER_BUILDER = 5000;

function builderTarget(room) {
	const remaining = room
		.find(FIND_MY_CONSTRUCTION_SITES)
		.reduce((sum, site) => sum + (site.progressTotal - site.progress), 0);

	return Math.ceil(remaining / BUILD_WORK_PER_BUILDER);
}

// While there is anything to build, upgrading takes a back seat and one upgrader keeps the
// downgrade clock topped up. With nothing left to build, surplus energy has nowhere better to go.
function upgraderTarget(room) {
	const hasConstruction = room.find(FIND_MY_CONSTRUCTION_SITES).length > 0;
	return hasConstruction ? 1 : 3;
}

function countRole(room, role) {
	return _.filter(Game.creeps, creep => creep.room.name === room.name && creep.memory.role === role).length;
}

// Without a miner nothing enters the economy, and without a hauler nothing reaches the spawn, so
// either shortage is self-perpetuating: the room stops accumulating and can never reach the energy
// its full-size body needs. In that state the right move is a small creep now over a proper one
// never, which is why these two - and only these two - fall back to spending what is on hand.
function isEmergency(room) {
	return countRole(room, 'miner') === 0 || countRole(room, 'hauler') === 0;
}

// Generalists predate the split into hauler, builder and upgrader. Their WORK+CARRY+MOVE body can
// do any of the three jobs, so they are relabelled into whichever role is furthest below its target
// rather than left to expire - waiting out 1500 ticks of lifetime would leave the new roles
// understaffed while perfectly capable creeps stood by under an obsolete name.
//
// Only the label changes. New haulers spawn as CARRY+MOVE, so the fleet converts to the cheaper
// body as these retire; relabelling them hauler too would just delay that.
function migrateGeneralists(room) {
	const generalists = _.filter(
		Game.creeps,
		creep => creep.room.name === room.name && creep.memory.role === 'generalist'
	);
	if (generalists.length === 0) return;

	const targets = { builder: builderTarget(room), upgrader: upgraderTarget(room) };

	for (const creep of generalists) {
		const neediest = Object.keys(targets).reduce((worst, role) =>
			targets[role] - countRole(room, role) > targets[worst] - countRole(room, worst) ? role : worst
		);

		// Every target already met - the rest are surplus under any name, and hauling is the job
		// they can still do without a dedicated body.
		const stillNeeded = targets[neediest] - countRole(room, neediest) > 0;
		creep.memory.role = stillNeeded ? neediest : 'hauler';
	}
}

module.exports = {
	minerTarget,
	haulerTarget,
	builderTarget,
	upgraderTarget,
	countRole,
	isEmergency,
	migrateGeneralists,
};

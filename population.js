const mining = require('./mining');
const creepBodies = require('./creepBodies');

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

// Counted across every source rather than only those holding energy, so the establishment doesn't
// shrink while a source regenerates - a miner lost in that window would otherwise go unreplaced
// until the source refilled, which is the moment the room most needs it already standing there.
function minerTarget(room) {
	return room.find(FIND_SOURCES).reduce((sum, source) => sum + mining.maxMinersForSource(room, source), 0);
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

// One WORK part turns one energy per tick into controller progress, so a body's WORK count is what
// it can absorb while it is standing there.
const UPGRADE_PER_WORK_PER_TICK = 1;

// Every point of energy a room mines has three possible destinations: a creep body, a construction
// site, or the controller. Whatever the first two do not claim has to go to the controller, because
// a source refills to full on its own schedule and whatever is still in it at that moment is
// produced and lost. The room cannot bank what it does not spend.
//
// The rule this replaces was "one upgrader while any site is open, three otherwise". It keyed off
// whether building was happening rather than whether energy was actually scarce - so with five
// sites permanently open, the room sat on twelve thousand uncollected energy and wasted 26% of
// everything its sources produced, while one upgrader moved the controller at 1.2 energy a tick.
// The presence of work is not the same as the absence of surplus.
function upgraderTarget(room, upgraderBody) {
	const body = upgraderBody || [];
	const workParts = body.filter(part => part === WORK).length;
	const carry = carryCapacityOf(body);
	if (!workParts || !carry) return 1;

	// What the map hands this room per tick, which is not a choice anyone made.
	const produced = room.find(FIND_SOURCES).length * SOURCE_OUTPUT_PER_TICK;

	// Builders are the other claim on that energy and are already sized to the work outstanding, so
	// their draw is subtracted rather than guessed at. Builder and upgrader share one recipe, so at
	// a given energy capacity they are the same body - which is what makes this body a fair stand-in
	// for theirs, and BUILD_POWER the only difference between the two rates.
	const buildDraw = builderTarget(room) * workParts * BUILD_POWER;
	const spare = Math.max(0, produced - Math.min(produced, buildDraw));

	// An upgrader only upgrades while standing at the controller; the rest of its cycle is spent
	// fetching. Same round-trip reasoning as the hauler count, so the two stay consistent.
	const ticksSpentUpgrading = carry / (workParts * UPGRADE_PER_WORK_PER_TICK);
	const trip = roundTripTicks(room, room.controller);
	const throughput = (workParts * UPGRADE_PER_WORK_PER_TICK * ticksSpentUpgrading) / (ticksSpentUpgrading + trip);

	// Capped by how many creeps can physically stand next to the controller, the same limit that
	// bounds miners around a source and haulers at a sink. Without it the arithmetic asks for
	// seventeen upgraders to absorb twenty energy a tick through bodies that carry a hundred and
	// walk thirty-four ticks to get there - a number that is correct and unbuildable, and would
	// swamp the room with creeps that queue for a square instead of upgrading.
	const roomAtTheController = mining.getAccessibleTiles(room, room.controller.pos).length;

	// Always at least one: a controller left alone long enough downgrades, which costs far more
	// than the creep that would have prevented it.
	return Math.max(1, Math.min(Math.ceil(spare / throughput), roomAtTheController));
}

function countRole(room, role) {
	return _.filter(Game.creeps, creep => creep.room.name === room.name && creep.memory.role === role).length;
}

// A replacement ordered only after its predecessor dies leaves the source idle for the whole
// spawn-plus-walk. Ordered one lead time early, the shift changes at the pit instead: the relief
// stands two tiles off while the incumbent works its last ticks. The lead comes from the actual
// body - a 5-WORK miner drags itself at one step per five plains ticks, so the walk dominates -
// plus a small margin for the spawn queue's own latency.
const HANDOVER_MARGIN_TICKS = 10;

function minerTicksPerStep(room) {
	const body = creepBodies.bodyFor('miner', room.energyCapacityAvailable) || [];
	const moveParts = body.filter(part => part === MOVE).length || 1;
	const heavyParts = body.length - moveParts;
	// Plains cost 2 fatigue per non-MOVE part; each MOVE clears 2 per tick.
	return Math.max(1, Math.ceil(heavyParts / moveParts));
}

function minerLeadTicks(room, source) {
	const body = creepBodies.bodyFor('miner', room.energyCapacityAvailable) || [];
	const spawnTicks = body.length * CREEP_SPAWN_TIME;
	const walkSteps = roundTripTicks(room, source) / 2;
	return spawnTicks + walkSteps * minerTicksPerStep(room) + HANDOVER_MARGIN_TICKS;
}

// Sources whose sitting miner is inside its lead window and has no relief ordered yet.
function sourcesNeedingRelief(room) {
	const needing = [];
	for (const source of room.find(FIND_SOURCES)) {
		const lead = minerLeadTicks(room, source);
		const dying = _.some(
			Game.creeps,
			creep =>
				creep.memory.role === 'miner' &&
				creep.memory.task && creep.memory.task.targetId === source.id &&
				creep.ticksToLive !== undefined && creep.ticksToLive < lead
		);
		const hasRelief = _.some(Game.creeps, creep => creep.memory.standbyFor === source.id);
		if (dying && !hasRelief) needing.push(source.id);
	}
	return needing;
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

	const targets = {
		builder: builderTarget(room),
		upgrader: upgraderTarget(room, creepBodies.bodyFor('upgrader', room.energyCapacityAvailable) || []),
	};

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
	sourcesNeedingRelief,
};

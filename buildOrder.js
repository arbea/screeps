const config = require('./config');
const hostiles = require('./hostiles');
const taskOrder = require('./taskOrder');
const TASK_TYPES = require('./taskTypes');

// What to build first isn't a preference to type into config: at any given moment the room is
// blocked on something concrete, and the structure that unblocks it is the one worth spending
// builder energy on. Every quantity below is measured from the room's own state, so the order
// moves with the situation - a tower jumps the queue the moment hostiles appear, roads never do.
//
// Three tiers rather than a hand-numbered list per structure: either the room genuinely cannot
// do something until this is built, or it has a real but non-blocking use for it, or it only
// makes something that already works go faster. Ties inside a tier are fine - when two things
// are both blocking, either one is a good use of a builder.
const BLOCKING = 6;
const USEFUL = 3;
const OPTIONAL = 0;

const TIER_LABELS = { [BLOCKING]: 'blocking', [USEFUL]: 'useful', [OPTIONAL]: 'optional' };

// Every structure type the bot can currently end up with a site for, so the dashboard can show
// the computed order without having to guess which types are in play.
const RANKED_TYPES = [
	STRUCTURE_SPAWN,
	STRUCTURE_TOWER,
	STRUCTURE_EXTENSION,
	STRUCTURE_CONTAINER,
	STRUCTURE_STORAGE,
	STRUCTURE_RAMPART,
	STRUCTURE_WALL,
	STRUCTURE_ROAD,
];

// The spec caps concurrent sites at five. Builders divide their effort across whatever is open,
// so a long queue means many sites creeping toward completion together and none of them finishing
// - and every open site holds a slot in the room's shared site budget, which is what a tower or
// extension needs to be placeable at all. Five keeps work converging on finished structures.
const MAX_CONCURRENT_SITES = 5;

// Every placement path has to ask before creating a site, or they collectively overrun the cap
// while each stays under it on its own.
function siteBudgetRemaining(room) {
	return Math.max(0, MAX_CONCURRENT_SITES - room.find(FIND_MY_CONSTRUCTION_SITES).length);
}

// FIND_MY_STRUCTURES plus a per-source container scan is far too expensive to repeat every tick
// just to order a build queue, and none of it changes quickly - so it reuses the same cadence
// and Memory-cache shape as the repair scan. Hostile presence is the one input that does flip
// from tick to tick, so that one is read fresh below instead of being cached here.
function getCachedNeeds(room) {
	if (!Memory.buildNeeds) Memory.buildNeeds = {};

	const cache = Memory.buildNeeds[room.name];
	const stale = !cache || Game.time - cache.lastScan >= config.REPAIR_SCAN_INTERVAL;
	if (!stale) return cache;

	const counts = {};
	for (const structure of room.find(FIND_MY_STRUCTURES)) {
		counts[structure.structureType] = (counts[structure.structureType] || 0) + 1;
	}

	const sourcesWithoutContainer = room.find(FIND_SOURCES).filter(
		source =>
			source.pos.findInRange(FIND_STRUCTURES, 1, {
				filter: structure => structure.structureType === STRUCTURE_CONTAINER,
			}).length === 0
	).length;

	Memory.buildNeeds[room.name] = { lastScan: Game.time, counts, sourcesWithoutContainer };
	return Memory.buildNeeds[room.name];
}

function missingCount(structureType, needs, level) {
	const limits = CONTROLLER_STRUCTURES[structureType];
	const allowed = limits ? limits[level] : 0;
	return Math.max(0, allowed - (needs.counts[structureType] || 0));
}

function tierFor(structureType, needs, level, underAttack) {
	// Without a spawn the room cannot replace a single creep, so an unbuilt one outranks
	// everything; once at the limit another adds only throughput.
	if (structureType === STRUCTURE_SPAWN) {
		return missingCount(structureType, needs, level) > 0 ? BLOCKING : OPTIONAL;
	}

	// A room with no tower has no automated defence at all, and one under attack needs it now.
	if (structureType === STRUCTURE_TOWER) {
		const hasNone = (needs.counts[STRUCTURE_TOWER] || 0) === 0;
		return underAttack || hasNone ? BLOCKING : USEFUL;
	}

	// Extensions are what raises energyCapacityAvailable, and every body the room can't yet
	// afford (remote harvester, reserver) is gated behind it - blocking while any are missing.
	if (structureType === STRUCTURE_EXTENSION) {
		return missingCount(structureType, needs, level) > 0 ? BLOCKING : OPTIONAL;
	}

	// A source without a container drops its energy on the ground to decay; with one it holds.
	if (structureType === STRUCTURE_CONTAINER) {
		return needs.sourcesWithoutContainer > 0 ? USEFUL : OPTIONAL;
	}

	if (structureType === STRUCTURE_STORAGE) return USEFUL;

	// Barriers only matter while there is something to keep out.
	if (structureType === STRUCTURE_RAMPART || structureType === STRUCTURE_WALL) {
		return underAttack ? USEFUL : OPTIONAL;
	}

	// Roads never unblock anything - they only shorten trips that already complete.
	return OPTIONAL;
}

// Tiers order sites *within* BUILD only; BUILD's own rank in taskOrder decides where the whole
// group sits against hauling, repairing and upgrading. Keeping the two separate means a blocking
// structure can outrank an optional one without build work as a whole jumping the queue.
function buildPriority(room, structureType, underAttack) {
	const needs = getCachedNeeds(room);
	return taskOrder.basePriority(TASK_TYPES.BUILD) + tierFor(structureType, needs, room.controller.level, underAttack);
}

// Same computation the task queue runs, shaped for display: what the room would prioritise right
// now and why, so the order is visible without being editable.
function describeBuildOrder(room) {
	const needs = getCachedNeeds(room);
	const underAttack = hostiles.findThreateningCreeps(room).length > 0;
	const level = room.controller.level;

	return RANKED_TYPES.map(structureType => {
		const tier = tierFor(structureType, needs, level, underAttack);
		return {
			structureType,
			tier: TIER_LABELS[tier],
			priority: taskOrder.basePriority(TASK_TYPES.BUILD) + tier,
		};
	}).sort((a, b) => b.priority - a.priority);
}

module.exports = { buildPriority, describeBuildOrder, siteBudgetRemaining, MAX_CONCURRENT_SITES };

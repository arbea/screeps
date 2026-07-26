const TASK_TYPES = require('./taskTypes');

// The last-resort self-serve harvest is a priority level, not a task type - the task it labels is
// an ordinary HARVEST, which sits far higher up. It has no entry in TASK_TYPES, so it is named
// here as the string callers pass to basePriority.
const HARVEST_FALLBACK = 'HARVEST_FALLBACK';

// Ordered by what the room loses if the task goes undone, worst first. This replaces the
// drag-and-drop editor: the ordering was never really a preference, it is a consequence of what
// depends on what. Nothing can be produced without energy in the spawn, nothing can be hauled that
// was never mined, and nothing at all matters if the room is being destroyed while it happens.
//
// Positions are multiplied out so the escalations below have room to move a task several places
// up the list without needing numbers hand-picked to stay clear of their neighbours.
const TASK_ORDER = [
	TASK_TYPES.DEFENSE,
	TASK_TYPES.REMOTE_DEFENSE,
	TASK_TYPES.REFILL_TOWER,
	TASK_TYPES.MINE,
	TASK_TYPES.HARVEST,
	TASK_TYPES.HAUL,
	TASK_TYPES.RESERVE_CONTROLLER,
	TASK_TYPES.REMOTE_HARVEST,
	TASK_TYPES.BUILD,
	TASK_TYPES.REPAIR,
	TASK_TYPES.REFILL_SPAWN,
	TASK_TYPES.UPGRADE,
	TASK_TYPES.SCOUT,
	HARVEST_FALLBACK,
	TASK_TYPES.RECYCLE,
];

const RANK_STEP = 10;

function basePriority(key) {
	const index = TASK_ORDER.indexOf(key);
	if (index === -1) return 0;

	return (TASK_ORDER.length - index) * RANK_STEP;
}

// Both escalations below answer the same question - how close is the room to losing something it
// cannot get back - and both return to base once the danger passes, so neither can permanently
// crowd out the rest of the queue.
const DEFENSE_CEILING = basePriority(TASK_TYPES.DEFENSE);

function escalate(base, urgency) {
	const clamped = Math.max(0, Math.min(1, urgency));
	return Math.round(base + (DEFENSE_CEILING - base) * clamped);
}

// Let the downgrade clock run out and the room drops a controller level, taking with it every
// extension that level allowed. One upgrade refills the clock, so this falls straight back to base.
function upgradePriority(controller) {
	const base = basePriority(TASK_TYPES.UPGRADE);
	const fullClock = CONTROLLER_DOWNGRADE[controller.level];
	if (!fullClock) return base;

	return escalate(base, 1 - controller.ticksToDowngrade / fullClock);
}

// The body a room can spawn is decided by the energy actually sitting in its spawn and extensions
// at that instant, so empty stores block creep production entirely - capacity that never gets
// filled buys nothing.
function refillPriority(room) {
	const base = basePriority(TASK_TYPES.REFILL_SPAWN);
	if (!room.energyCapacityAvailable) return base;

	return escalate(base, 1 - room.energyAvailable / room.energyCapacityAvailable);
}

module.exports = { basePriority, upgradePriority, refillPriority, TASK_ORDER, HARVEST_FALLBACK };

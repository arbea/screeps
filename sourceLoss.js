// What a source produced that nobody harvested.
//
// A source resets to its full capacity every ENERGY_REGEN_TIME ticks no matter how much is left in
// it, so whatever is still sitting there at that moment is not carried over - it is simply gone.
// That leftover is the only honest measure of whether the room's mining actually keeps up with what
// the room is given, and it is the number this exists to drive to zero.
//
// It has to run every tick rather than on the snapshot interval: regeneration is one specific
// moment, and a sampler that looks every tenth tick sees the refilled source and learns nothing.

// How many cycles the rolling average is taken over. Ten regenerations is roughly 3000 ticks - long
// enough that one unlucky cycle does not read as a trend, short enough that a fix shows up while
// the person who made it is still watching.
const HISTORY_CYCLES = 10;

function ensureMemory() {
	if (!Memory.sourceLoss) Memory.sourceLoss = {};
	return Memory.sourceLoss;
}

function ensureSourceRecord(store, source) {
	if (!store[source.id]) {
		store[source.id] = {
			room: source.room.name,
			pos: { x: source.pos.x, y: source.pos.y },
			capacity: source.energyCapacity,
			lastEnergy: source.energy,
			lastSeenTick: Game.time,
			cycles: 0,
			wasted: 0,
			produced: 0,
			recent: [],
		};
	}
	return store[source.id];
}

function recordCycle(record, leftover) {
	record.cycles++;
	record.wasted += leftover;
	record.produced += record.capacity;

	record.recent.push(leftover);
	if (record.recent.length > HISTORY_CYCLES) record.recent.shift();
}

// Called for every source we can currently see, which for an owned room is every tick and for a
// remote one is only while somebody is standing in it.
function observeSource(source) {
	const store = ensureMemory();
	const record = ensureSourceRecord(store, source);

	// Regeneration is the only thing that puts energy back into a source, so a rise means the cycle
	// just turned over and whatever was in it the tick before was never harvested.
	const regenerated = source.energy > record.lastEnergy;

	// Only trusted when the previous reading was from the tick immediately before. After a gap in
	// vision the source has already refilled and the stale reading would be booked as waste that
	// nobody can prove happened - and an invented number is worse here than a missing one, because
	// this one is supposed to be driven to zero.
	const continuous = record.lastSeenTick === Game.time - 1;
	if (regenerated && continuous) recordCycle(record, record.lastEnergy);

	record.lastEnergy = source.energy;
	record.lastSeenTick = Game.time;
	record.capacity = source.energyCapacity;
}

function run(room) {
	for (const source of room.find(FIND_SOURCES)) observeSource(source);
}

// No summary is published alongside this. The dashboard already receives the whole Memory tree in
// its one poll, so rolling the records up here would only write a second copy of them into a
// structure that is serialised every tick - and Memory size is a running cost, not a one-off.
module.exports = { run, HISTORY_CYCLES };

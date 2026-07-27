// Where every unit of energy comes from and where it goes.
//
// T3's question grew from "how much does regeneration waste" to "is any energy being wasted
// anywhere" - and that can only be answered by an account of every flow, because a waste stream
// nobody measures reads as zero. Income is counted at the rock (source drain), spending at the
// action that spends it, and waste at the moment it becomes unrecoverable.
//
// What counts as waste is a definition, not an observation, so it is stated here once:
//   regen     - energy a source regenerated over (booked by sourceLoss.js, joined by the dashboard)
//   decay     - dropped energy evaporating on the ground (1/1000 per tick, rounded up per pile)
//   death     - energy a creep was carrying when it died (a looted tombstone earns it back as
//               salvage income, so the net loss is visible rather than assumed)
//   downgrade - controller progress lost to a downgrade tick
// Upgrading, spawning, building and repairing are allocation, not waste: they are the three
// destinations energy is supposed to reach, plus the upkeep tax that keeps roads and containers
// standing. If their shares look wrong, that is a strategy question the pie makes visible - not
// something to hard-code a judgment about.

// Aligned with idleStats's window so every rolling readout on the dashboard covers the same
// horizon: ten buckets of 300 ticks ≈ the same ~3000 ticks sourceLoss's ten-cycle window spans.
const BUCKET_TICKS = 300;
const KEEP_BUCKETS = 10;

function ensureLedger() {
	if (!Memory.energyLedger) {
		Memory.energyLedger = { bucketStart: Game.time, current: {}, buckets: [], sources: {}, controller: {} };
	}
	return Memory.energyLedger;
}

function record(flow, amount) {
	if (!(amount > 0)) return;
	const ledger = ensureLedger();
	ledger.current[flow] = (ledger.current[flow] || 0) + Math.round(amount);
}

function rotateBucket() {
	const ledger = ensureLedger();
	if (Game.time - ledger.bucketStart < BUCKET_TICKS) return;

	ledger.buckets.push({ start: ledger.bucketStart, flows: ledger.current });
	if (ledger.buckets.length > KEEP_BUCKETS) ledger.buckets.shift();
	ledger.bucketStart = Game.time;
	ledger.current = {};
}

// Income measured where it enters the economy: the drain on the source itself. A drop in stored
// energy can only be harvest; a rise can only be regeneration, which sourceLoss books - so the
// two records never double-count and between them cover the source completely.
function observeSources(room) {
	const ledger = ensureLedger();
	for (const source of room.find(FIND_SOURCES)) {
		const prev = ledger.sources[source.id];
		if (prev !== undefined && source.energy < prev) record('harvest', prev - source.energy);
		ledger.sources[source.id] = source.energy;
	}
}

// Controller progress is energy one-for-one, so the delta IS the upgrade spend - no hook in the
// upgrader needed, and a negative delta is the downgrade waste stream. A level change resets
// progress, so that tick is skipped rather than misread as a huge swing.
function observeController(room) {
	const controller = room.controller;
	if (!controller || !controller.my) return;

	const ledger = ensureLedger();
	const prev = ledger.controller[room.name];
	const continuous = prev && prev.tick === Game.time - 1 && prev.level === controller.level;
	if (continuous) {
		const delta = controller.progress - prev.progress;
		if (delta > 0) record('upgrade', delta);
		else if (delta < 0) record('downgrade', -delta);
	}
	ledger.controller[room.name] = { level: controller.level, progress: controller.progress, tick: Game.time };
}

// Dropped piles evaporate at 1/1000 per tick, rounded up per pile - the game's own decay rule.
function observeDecay(room) {
	for (const pile of room.find(FIND_DROPPED_RESOURCES)) {
		if (pile.resourceType !== RESOURCE_ENERGY) continue;
		record('decay', Math.ceil(pile.amount / ENERGY_DECAY));
	}
}

function run(room) {
	rotateBucket();
	observeSources(room);
	observeController(room);
	observeDecay(room);
}

// The rolling totals every consumer reads: current bucket plus the kept history.
function summary() {
	const ledger = ensureLedger();
	const totals = {};
	for (const bucket of ledger.buckets.concat([{ flows: ledger.current }])) {
		for (const flow in bucket.flows) totals[flow] = (totals[flow] || 0) + bucket.flows[flow];
	}
	return totals;
}

module.exports = { run, record, summary };

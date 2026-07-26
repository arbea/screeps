const config = require('./config');
const { log } = require('./log');

// Bucket thresholds as fractions of a full bucket, from the spec's CPU tiers. The bucket is the
// bank of unspent CPU: spending above the per-tick limit draws it down, and if it ever empties the
// game skips ticks outright. Reacting to how full it is - rather than to a single tick's usage -
// is what lets the bot spend freely when it has reserves and shed work before it runs out.
const BURST_BUCKET = 0.8;
const LEAN_BUCKET = 0.4;
const CRISIS_BUCKET = 0.1;

// Hard stop within a single tick. Blowing the per-tick limit is what drains the bucket in the
// first place, so once this much of it is gone the remaining systems are skipped no matter which
// mode we are in - a mode is a plan for the tick, this is the abort.
const FUSE = 0.85;

const MODES = { BURST: 'burst', NORMAL: 'normal', LEAN: 'lean', CRISIS: 'crisis' };

function currentMode() {
	const filled = Game.cpu.bucket / 10000;

	if (filled < CRISIS_BUCKET) return MODES.CRISIS;
	if (filled < LEAN_BUCKET) return MODES.LEAN;
	if (filled > BURST_BUCKET) return MODES.BURST;
	return MODES.NORMAL;
}

function fuseBlown() {
	return Game.cpu.getUsed() > Game.cpu.limit * FUSE;
}

// Systems run in the order the spec fixes: memory → intel → empire → war → ally → colonies →
// creeps. empire and war have no implementation yet; their slots stay empty rather than being
// filled with something else, so adding them later doesn't reshuffle what already runs.
//
// core   - keeps running in crisis (creep actions, production, defence)
// flex   - intel/empire/ally, which tolerate being stale; in lean only one runs per tick
const SYSTEMS = [];

function register(name, run, options) {
	SYSTEMS.push({ name, run, core: !!(options && options.core), flex: !!(options && options.flex) });
}

function shouldRun(system, mode, flexTurnName) {
	if (mode === MODES.CRISIS) return system.core;
	if (system.flex && mode === MODES.LEAN) return system.name === flexTurnName;
	return true;
}

// In lean mode the flex systems take turns, one per tick, so their combined cost is paid once
// instead of every tick. The cursor advances whether or not the chosen system errored, otherwise
// one broken system would starve the others of their turn forever.
function nextFlexName() {
	const flexNames = SYSTEMS.filter(system => system.flex).map(system => system.name);
	if (flexNames.length === 0) return null;

	if (!Memory.kernel) Memory.kernel = {};
	const cursor = Memory.kernel.flexCursor || 0;
	Memory.kernel.flexCursor = (cursor + 1) % flexNames.length;
	return flexNames[cursor % flexNames.length];
}

// One system throwing must not take the rest of the tick with it: a creep left unrun is a wasted
// tick, but an uncaught error stops production and defence too, and the room stops responding
// entirely. The failure is logged with the system that caused it so it is visible rather than
// silently swallowed.
function runSystem(system, mode) {
	try {
		system.run(mode);
	} catch (err) {
		log(`[核心] 系統 ${system.name} 發生錯誤:${err.message}`);
	}
}

function run() {
	const mode = currentMode();
	const flexTurnName = mode === MODES.LEAN ? nextFlexName() : null;
	const skipped = [];

	for (const system of SYSTEMS) {
		if (!shouldRun(system, mode, flexTurnName)) continue;

		// The fuse is checked before each system rather than inside them, so whatever is still
		// pending is dropped whole instead of being cut off midway through its work.
		if (fuseBlown()) {
			skipped.push(system.name);
			continue;
		}

		runSystem(system, mode);
	}

	reportUsage(mode, skipped);
}

function reportUsage(mode, skipped) {
	const used = Game.cpu.getUsed();
	Memory.cpuStats = { used, limit: Game.cpu.limit, bucket: Game.cpu.bucket, tick: Game.time, mode };

	if (skipped.length > 0) {
		log(`[核心] CPU 保險絲跳脫(${used.toFixed(1)}/${Game.cpu.limit}),略過:${skipped.join('、')}`);
		return;
	}

	const overThreshold = used > Game.cpu.limit * config.CPU_WARN_THRESHOLD;
	if (overThreshold) {
		log(`⚠ CPU 使用 ${used.toFixed(1)}/${Game.cpu.limit}(bucket ${Game.cpu.bucket}、模式 ${mode})`);
	}
}

module.exports = { register, run, currentMode, MODES };

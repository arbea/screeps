const DEFAULTS = {
	PRIORITY: {
		DEFENSE: 100,
		REFILL_SPAWN: 90,
		HARVEST: 80,
		REFILL_TOWER: 70,
		BUILD: 50,
		REPAIR: 40,
		UPGRADE: 20,
	},

	SPAWN_PRIORITY: {
		DEFENDER: 100,
		GENERALIST: 50,
	},

	MAX_HARVESTERS_PER_SOURCE: 3,
	REPAIR_HP_THRESHOLD: 0.8,

	BACKLOG_TICKS_THRESHOLD: 5,
	GENERALIST_RATIO: { work: 1, carry: 1, move: 1 },
	DEFENDER_BODY: [ATTACK, ATTACK, MOVE, MOVE],
	MAX_CREEPS: 8,
	MIN_ENERGY_TO_SPAWN: 200,

	LOG_ENABLED: true,
	EVENT_LOG_SIZE: 50,

	REPAIR_SCAN_INTERVAL: 20,
	SNAPSHOT_INTERVAL: 5,
	CPU_WARN_THRESHOLD: 0.8,
};

function deepClone(value) {
	if (Array.isArray(value)) return value.slice();

	const isPlainObject = typeof value === 'object' && value !== null;
	if (isPlainObject) {
		const clone = {};
		for (const key in value) clone[key] = deepClone(value[key]);
		return clone;
	}

	return value;
}

function deepMerge(target, source) {
	for (const key in source) {
		const noOverride = source[key] === null || source[key] === undefined;
		if (noOverride) continue;

		const sourceIsPlainObject = typeof source[key] === 'object' && !Array.isArray(source[key]);
		const targetIsPlainObject = typeof target[key] === 'object' && target[key] !== null;
		if (sourceIsPlainObject && targetIsPlainObject) {
			deepMerge(target[key], source[key]);
		} else {
			target[key] = source[key];
		}
	}
}

const config = deepClone(DEFAULTS);

// Re-derives every knob from DEFAULTS each call, then layers Memory.config on top,
// so clearing an override (setting it to null) reverts the knob without a global reset.
config.applyOverrides = function () {
	const merged = deepClone(DEFAULTS);
	deepMerge(merged, Memory.config || {});
	for (const key in merged) config[key] = merged[key];
};

module.exports = config;

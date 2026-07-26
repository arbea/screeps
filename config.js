const DEFAULTS = {
	// The alliance protocol's trust circle. Who we stand with is a standing commitment, not
	// anything the map can tell us, so it belongs here - but unlike the other entries it must
	// never be widened by what allies broadcast about themselves: the protocol specifies each
	// player enforces their own list, and auto-merging one would let any listed name add more.
	ALLIES: ['douasin', 'arbea'],

	// Players we never shoot at, without being allies. All four are RCL8 neighbours; the theatre
	// assessment is that staying invisible to them is worth more than any exchange we could win,
	// and that a single stray shot at a passing unit is enough to invite one we cannot survive.
	// They still count toward DEFCON - we notice the danger and can safemode, we just don't fire.
	NON_AGGRESSION: ['keqing', 'rmuchan', 'Petrichor', 'backslash'],

	REPAIR_HP_THRESHOLD: 0.8,
	AUTO_BUILD_CONTAINERS: true,
	AUTO_BUILD_ROADS: true,
	ROAD_TRAFFIC_THRESHOLD: 50,

	BACKLOG_TICKS_THRESHOLD: 5,
	MIN_ENERGY_TO_SPAWN: 200,

	LOG_ENABLED: true,
	EVENT_LOG_SIZE: 150,

	REPAIR_SCAN_INTERVAL: 50,
	SNAPSHOT_INTERVAL: 5,
	CPU_WARN_THRESHOLD: 0.8,

	EXPANSION_ENABLED: true,
	EXPANSION_INTERVAL: 10,
	MIN_SOURCES_FOR_REMOTE: 1,
	DEFEND_REMOTE_ROOMS: true,


	STALL_TASK_TICKS: 100,
	STALL_POSITION_TICKS: 50,
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

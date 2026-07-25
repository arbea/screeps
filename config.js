const DEFAULTS = {
	PRIORITY: {
		DEFENSE: 100,
		REFILL_SPAWN: 90,
		HARVEST: 80,
		HAUL: 75,
		REFILL_TOWER: 70,
		BUILD: 50,
		REPAIR: 40,
		UPGRADE: 20,
	},

	SPAWN_PRIORITY: {
		DEFENDER: 100,
		MINER: 95,
		GENERALIST: 50,
	},

	REPAIR_HP_THRESHOLD: 0.8,
	AUTO_BUILD_CONTAINERS: true,

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

	EXPANSION_ENABLED: true,
	EXPANSION_INTERVAL: 10,
	MAX_REMOTE_ROOMS: 2,
	MIN_SOURCES_FOR_REMOTE: 1,
	DEFEND_REMOTE_ROOMS: true,

	PRIORITY_SCOUT: 10,
	PRIORITY_RESERVE: 60,
	PRIORITY_REMOTE_HARVEST: 65,
	PRIORITY_REMOTE_DEFENSE: 95,

	SPAWN_PRIORITY_SCOUT: 30,
	SPAWN_PRIORITY_RESERVER: 70,
	SPAWN_PRIORITY_REMOTE_HARVESTER: 60,
	SPAWN_PRIORITY_REMOTE_DEFENDER: 90,

	SCOUT_BODY: [MOVE],
	RESERVER_BODY: [CLAIM, MOVE],
	REMOTE_HARVESTER_BODY: [WORK, WORK, CARRY, MOVE, MOVE],

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

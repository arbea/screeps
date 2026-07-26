const config = require('./config');
const kernel = require('./kernel');
const taskQueue = require('./taskQueue');
const creepActions = require('./creepActions');
const spawnQueue = require('./spawnQueue');
const mapSnapshot = require('./mapSnapshot');
const economyStats = require('./economyStats');
const strategySnapshot = require('./strategySnapshot');
const expansion = require('./expansion');
const traffic = require('./traffic');

function cleanDeadCreepMemory() {
	for (const name in Memory.creeps) {
		const creepIsDead = !(name in Game.creeps);
		if (creepIsDead) delete Memory.creeps[name];
	}
}

// Pre-creates the containers a nested Memory.config write (e.g. config.GENERALIST_RATIO.work)
// needs to already exist, since the Screeps memory-path API can't create intermediate objects.
function ensureConfigMemoryShape() {
	if (!Memory.config) Memory.config = {};
	if (!Memory.config.GENERALIST_RATIO) Memory.config.GENERALIST_RATIO = {};
}

function runMemory() {
	if (!Memory.taskBacklog) Memory.taskBacklog = {};
	if (!Memory.eventLog) Memory.eventLog = [];
	ensureConfigMemoryShape();
	config.applyOverrides();
	cleanDeadCreepMemory();
}

function ownedRooms() {
	const rooms = [];
	for (const roomName in Game.rooms) {
		const room = Game.rooms[roomName];
		const owned = room.controller && room.controller.my;
		if (owned) rooms.push(room);
	}
	return rooms;
}

// Room intel is gathered from rooms we already have vision into, so it costs nothing to look but
// is worth skipping when CPU is short - it only feeds expansion decisions, which tolerate being
// a few ticks stale. That is what makes it a flex system.
function runIntel() {
	// Being a flex system governs what gets shed when CPU is short; this interval is the separate
	// question of how often the scan is worth doing at all, and rooms change slowly enough that
	// every tick would be waste even with CPU to spare.
	const isIntelTick = Game.time % config.EXPANSION_INTERVAL === 0;
	if (!isIntelTick) return;

	expansion.updateRoomIntel();
}

// Per-room sequence from the spec: defence → population → remote → war manpower → link →
// build/lab/market → spawn. The first three are all task emission, which the task queue does in a
// single pass; war manpower, link and lab/market have nothing built yet. Spawning stays last
// deliberately - it decides what to produce from the backlog the phases before it just left
// behind, so running it earlier would have it deciding on stale demand.
//
// Task building, spawning and creep actions are what keep a room alive; the snapshots and the
// road surveyor only describe it. In crisis the descriptive half is dropped so the room keeps
// defending and producing on whatever CPU is left.
function runColonies(mode) {
	const essentialOnly = mode === kernel.MODES.CRISIS;

	for (const room of ownedRooms()) {
		taskQueue.runTaskQueue(room);

		if (!essentialOnly) {
			traffic.runTraffic(room, mode);
			mapSnapshot.publishMapSnapshot(room);
			economyStats.publishEconomyStats(room);
			strategySnapshot.publishStrategySnapshot(room);
		}

		spawnQueue.runSpawnQueue(room, Memory.taskBacklog);
	}
}

function runCreeps() {
	for (const name in Game.creeps) {
		creepActions.runCreep(Game.creeps[name]);
	}
}

// Registered in the order the spec fixes. empire and war are not built yet, so their slots are
// simply absent rather than stubbed - when they arrive they slot in between intel and ally
// without disturbing anything registered here.
kernel.register('memory', runMemory, { core: true });
kernel.register('intel', runIntel, { flex: true });
kernel.register('colonies', runColonies, { core: true });
kernel.register('creeps', runCreeps, { core: true });

module.exports.loop = function () {
	kernel.run();
};

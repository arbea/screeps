const config = require('./config');
const { logSpawn } = require('./log');
const expansion = require('./expansion');
const mining = require('./mining');
const creepBodies = require('./creepBodies');
const hostiles = require('./hostiles');
const spawnOrder = require('./spawnOrder');

function getAvailableSpawn(room) {
	return room.find(FIND_MY_SPAWNS, { filter: spawn => !spawn.spawning })[0];
}

function countCreepsWithBodyPart(room, partType) {
	return _.filter(
		Game.creeps,
		creep => creep.room.name === room.name && _.some(creep.body, part => part.type === partType)
	).length;
}

function hasStaleBacklog(taskBacklog) {
	const now = Game.time;
	return _.some(taskBacklog, firstSeenTick => now - firstSeenTick >= config.BACKLOG_TICKS_THRESHOLD);
}

function addDefenderRequest(room, requests) {
	const attackers = hostiles.findHostileCreeps(room);
	const defenderCount = countCreepsWithBodyPart(room, ATTACK) + countCreepsWithBodyPart(room, RANGED_ATTACK);
	const underAttackAndUndefended = attackers.length > 0 && defenderCount === 0;
	if (!underAttackAndUndefended) return;

	requests.push({
		role: 'defender',
		priority: spawnOrder.spawnPriority('defender'),
		body: creepBodies.buildDefenderBody(room.energyAvailable),
	});
}

// config.GENERALIST_RATIO can come from Memory (dashboard-editable, external input), so a
// malformed or mistyped ratio can't be trusted to stay within a sane range on its own.
function clampRatioPart(value) {
	const invalid = typeof value !== 'number' || !Number.isFinite(value) || value < 0;
	return invalid ? 1 : Math.min(value, MAX_CREEP_SIZE);
}

function appendParts(body, partType, count) {
	const remaining = MAX_CREEP_SIZE - body.length;
	const safeCount = Math.min(Math.max(0, count), remaining);
	for (let i = 0; i < safeCount; i++) body.push(partType);
}

function buildGeneralistBody(energyAvailable) {
	const ratio = {
		work: clampRatioPart(config.GENERALIST_RATIO.work),
		carry: clampRatioPart(config.GENERALIST_RATIO.carry),
		move: clampRatioPart(config.GENERALIST_RATIO.move),
	};
	const ratioSum = ratio.work + ratio.carry + ratio.move;
	const unitCost = ratio.work * BODYPART_COST[WORK] + ratio.carry * BODYPART_COST[CARRY] + ratio.move * BODYPART_COST[MOVE];

	const unitsByEnergy = Math.floor(energyAvailable / unitCost);
	const unitsByPartLimit = Math.floor(MAX_CREEP_SIZE / ratioSum);
	const units = Math.max(1, Math.min(unitsByEnergy, unitsByPartLimit));

	const body = [];
	appendParts(body, WORK, units * ratio.work);
	appendParts(body, CARRY, units * ratio.carry);
	appendParts(body, MOVE, units * ratio.move);
	return body;
}

function buildMinerBody(energyCapacity) {
	const workCount = mining.minerWorkCount(energyCapacity);
	const body = [];
	for (let i = 0; i < workCount; i++) body.push(WORK);
	body.push(MOVE);
	return body;
}

function addMinerRequest(room, requests) {
	const sources = room.find(FIND_SOURCES_ACTIVE);
	const totalMinerSlots = sources.reduce((sum, source) => sum + mining.maxMinersForSource(room, source), 0);
	const minerCount = _.filter(Game.creeps, creep => creep.memory.role === 'miner' && creep.room.name === room.name).length;
	const needsMiner = minerCount < totalMinerSlots;
	if (!needsMiner) return;

	requests.push({
		role: 'miner',
		priority: spawnOrder.spawnPriority('miner'),
		body: buildMinerBody(room.energyCapacityAvailable),
		memory: { role: 'miner' },
	});
}

// An idle, empty-handed generalist can only ever pick up a HAUL task (BUILD/REPAIR/UPGRADE
// all require carried energy it doesn't have). So "is there a labor surplus" isn't a number
// to tune - it's answerable directly from the map: sum up how many HAUL slots the sources
// can actually support (same tile/backlog-derived capacity taskQueue uses to open them) and
// compare against how many idle, broke generalists already exist. No knob needed.
function countIdleBrokeGeneralists(room) {
	return _.filter(
		Game.creeps,
		creep =>
			creep.room.name === room.name &&
			creep.memory.role !== 'miner' &&
			!creep.memory.task &&
			creep.store[RESOURCE_ENERGY] === 0
	).length;
}

function totalHaulCapacity(room) {
	return room.find(FIND_SOURCES_ACTIVE).reduce((sum, source) => sum + mining.haulSlotsForSource(room, source), 0);
}

function countActiveHaulers(room) {
	return _.filter(
		Game.creeps,
		creep => creep.room.name === room.name && creep.memory.task && creep.memory.task.type === 'HAUL'
	).length;
}

// HAUL delivers straight into spawn/extension/tower, so it never leaves a broke generalist
// holding energy of its own - the self-serve HARVEST_FALLBACK slots (mining.js) are the *only*
// other route by which one can ever earn carryable energy to spend on BUILD/REPAIR/UPGRADE.
// A backlog of buildable work doesn't mean "spawn more hands" if both routes into the economy
// are already saturated - it means the existing population has nowhere to go either.
function totalFallbackHarvestCapacity(room) {
	return room.find(FIND_SOURCES_ACTIVE).reduce((sum, source) => sum + mining.fallbackHarvestSlotsForSource(room, source), 0);
}

function countActiveFallbackHarvesters(room) {
	return _.filter(
		Game.creeps,
		creep => creep.room.name === room.name && creep.memory.task && creep.memory.task.type === 'HARVEST'
	).length;
}

function addGeneralistRequest(room, taskBacklog, requests) {
	if (!hasStaleBacklog(taskBacklog)) return;

	// A generalist already waiting idle with nothing to carry, while every route into the
	// economy (HAUL or self-serve fallback harvest) the map can support is already filled,
	// means spawning another one adds population that has nowhere to go right now - not
	// "needs more hands".
	const someoneWaiting = countIdleBrokeGeneralists(room) > 0;
	const haulSlotsFull = countActiveHaulers(room) >= totalHaulCapacity(room);
	const fallbackSlotsFull = countActiveFallbackHarvesters(room) >= totalFallbackHarvestCapacity(room);
	if (someoneWaiting && haulSlotsFull && fallbackSlotsFull) return;

	requests.push({
		role: 'generalist',
		priority: spawnOrder.spawnPriority('generalist'),
		body: buildGeneralistBody(room.energyAvailable),
	});
}

function getSpawnRequests(room, taskBacklog) {
	const requests = [];
	addDefenderRequest(room, requests);
	addMinerRequest(room, requests);
	addGeneralistRequest(room, taskBacklog, requests);

	const myUsername = room.controller.owner.username;
	requests.push(...expansion.getExpansionSpawnRequests(room, myUsername));

	requests.sort((a, b) => b.priority - a.priority);
	return requests;
}

function bodyCost(body) {
	return body.reduce((sum, part) => sum + BODYPART_COST[part], 0);
}

function runSpawnQueue(room, taskBacklog) {
	const spawn = getAvailableSpawn(room);
	if (!spawn) return;
	if (room.energyAvailable < config.MIN_ENERGY_TO_SPAWN) return;

	// Pick the highest-priority request we can actually afford, not just the top request -
	// otherwise one expensive high-priority body (e.g. a CLAIM-part reserver) permanently
	// blocks every cheaper request behind it whenever the room can't yet afford it.
	const requests = getSpawnRequests(room, taskBacklog);
	const request = requests.find(candidate => room.energyAvailable >= bodyCost(candidate.body));
	if (!request) return;

	const cost = bodyCost(request.body);
	const name = `${request.role}_${Game.time}`;
	spawn.spawnCreep(request.body, name, { memory: request.memory || {} });
	logSpawn(request.role, name, cost);
}

module.exports = { runSpawnQueue };

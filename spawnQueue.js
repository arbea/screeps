const config = require('./config');
const { logSpawn } = require('./log');
const expansion = require('./expansion');
const mining = require('./mining');

function getAvailableSpawn(room) {
	return room.find(FIND_MY_SPAWNS, { filter: spawn => !spawn.spawning })[0];
}

function countCreepsInRoom(room) {
	return _.filter(Game.creeps, creep => creep.room.name === room.name).length;
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
	const hostiles = room.find(FIND_HOSTILE_CREEPS);
	const defenderCount = countCreepsWithBodyPart(room, ATTACK) + countCreepsWithBodyPart(room, RANGED_ATTACK);
	const underAttackAndUndefended = hostiles.length > 0 && defenderCount === 0;
	if (!underAttackAndUndefended) return;

	requests.push({
		role: 'defender',
		priority: config.SPAWN_PRIORITY.DEFENDER,
		body: config.DEFENDER_BODY,
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
		priority: config.SPAWN_PRIORITY.MINER,
		body: buildMinerBody(room.energyCapacityAvailable),
		memory: { role: 'miner' },
	});
}

function addGeneralistRequest(room, taskBacklog, requests) {
	const atPopulationCap = countCreepsInRoom(room) >= config.MAX_CREEPS;
	if (atPopulationCap) return;
	if (!hasStaleBacklog(taskBacklog)) return;

	requests.push({
		role: 'generalist',
		priority: config.SPAWN_PRIORITY.GENERALIST,
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

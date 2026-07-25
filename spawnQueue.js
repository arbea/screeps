const config = require('./config');
const { logSpawn } = require('./log');

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

function buildGeneralistBody(energyAvailable) {
	const ratio = config.GENERALIST_RATIO;
	const ratioSum = ratio.work + ratio.carry + ratio.move;
	const unitCost = ratio.work * BODYPART_COST[WORK] + ratio.carry * BODYPART_COST[CARRY] + ratio.move * BODYPART_COST[MOVE];

	const unitsByEnergy = Math.floor(energyAvailable / unitCost);
	const unitsByPartLimit = Math.floor(MAX_CREEP_SIZE / ratioSum);
	const units = Math.max(1, Math.min(unitsByEnergy, unitsByPartLimit));

	const body = [];
	for (let i = 0; i < units * ratio.work; i++) body.push(WORK);
	for (let i = 0; i < units * ratio.carry; i++) body.push(CARRY);
	for (let i = 0; i < units * ratio.move; i++) body.push(MOVE);
	return body;
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
	addGeneralistRequest(room, taskBacklog, requests);

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

	const request = getSpawnRequests(room, taskBacklog)[0];
	if (!request) return;

	const cost = bodyCost(request.body);
	if (room.energyAvailable < cost) return;

	const name = `${request.role}_${Game.time}`;
	spawn.spawnCreep(request.body, name, { memory: {} });
	logSpawn(request.role, name, cost);
}

module.exports = { runSpawnQueue };

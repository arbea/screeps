const config = require('./config');
const { logSpawn } = require('./log');
const expansion = require('./expansion');
const creepBodies = require('./creepBodies');
const hostiles = require('./hostiles');
const spawnOrder = require('./spawnOrder');
const population = require('./population');

function getAvailableSpawn(room) {
	return room.find(FIND_MY_SPAWNS, { filter: spawn => !spawn.spawning })[0];
}

function countCreepsWithBodyPart(room, partType) {
	return _.filter(
		Game.creeps,
		creep => creep.room.name === room.name && _.some(creep.body, part => part.type === partType)
	).length;
}

// Normally a body is sized against what the room can hold once refilled, so waiting a few ticks
// buys the biggest creep the room can support. In an emergency it is sized against what is in the
// bank right now, because the shortage is what stops the room refilling in the first place.
function budgetFor(room) {
	return population.isEmergency(room) ? room.energyAvailable : room.energyCapacityAvailable;
}

function addDefenderRequest(room, requests) {
	const attackers = hostiles.findHostileCreeps(room);
	const defenderCount = countCreepsWithBodyPart(room, ATTACK) + countCreepsWithBodyPart(room, RANGED_ATTACK);
	const underAttackAndUndefended = attackers.length > 0 && defenderCount === 0;
	if (!underAttackAndUndefended) return;

	// Sized against energy on hand rather than capacity: an attack is happening now, and a smaller
	// defender that exists beats a larger one still waiting for the extensions to fill.
	requests.push({ role: 'defender', body: creepBodies.bodyFor('defender', room.energyAvailable) });
}

// Each role asks the same question - how many does the room want, how many exist - so the targets
// live in population.js and this only turns a shortfall into a request.
function addPopulationRequests(room, requests) {
	const budget = budgetFor(room);
	const haulerBody = creepBodies.bodyFor('hauler', budget);

	const targets = [
		{ role: 'miner', target: population.minerTarget(room) },
		{ role: 'hauler', target: population.haulerTarget(room, haulerBody || []) },
		{ role: 'upgrader', target: population.upgraderTarget(room, creepBodies.bodyFor('upgrader', budget) || []) },
		{ role: 'builder', target: population.builderTarget(room) },
	];

	for (const { role, target } of targets) {
		if (population.countRole(room, role) >= target) continue;

		// A recipe that can't afford a single repeat yields nothing, and the spec's rule is to skip
		// the role rather than spawn a token creep that costs a full body's spawn time to achieve
		// almost nothing.
		const body = creepBodies.bodyFor(role, budget);
		if (!body) continue;

		requests.push({ role, body });
	}
}

function getSpawnRequests(room) {
	const requests = [];
	addDefenderRequest(room, requests);
	addPopulationRequests(room, requests);

	const myUsername = room.controller.owner.username;
	requests.push(...expansion.getExpansionSpawnRequests(room, myUsername));

	// A role the room cannot afford a single repeat of yields no body at all, and everything below
	// costs the body it is given. Dropping those in one place covers every source of requests at
	// once, so a role that only becomes buildable at a higher RCL is simply absent until then.
	const buildable = requests.filter(request => request.body);

	// Every request carries its role, so the spec's production order is applied in one place here
	// rather than being restated at each call site.
	for (const request of buildable) {
		if (request.priority === undefined) request.priority = spawnOrder.spawnPriority(request.role);
		if (!request.memory) request.memory = { role: request.role };
	}

	buildable.sort((a, b) => b.priority - a.priority);
	return buildable;
}

function runSpawnQueue(room) {
	const spawn = getAvailableSpawn(room);
	if (!spawn) return;

	// The floor exists so the room doesn't drain itself on a minimum-size creep during normal
	// operation - but in an emergency that is exactly the trade worth making.
	const belowFloor = room.energyAvailable < config.MIN_ENERGY_TO_SPAWN;
	if (belowFloor && !population.isEmergency(room)) return;

	const requests = getSpawnRequests(room);

	// Skipping to a cheaper request is right only when the expensive one is out of reach for good.
	// A miner costing 550 in a room whose extensions hold 550 is affordable the moment they fill -
	// but a 500-energy hauler behind it kept spending the room back down to 428, so the miner was
	// never reachable and the room ran a source short indefinitely. Anything the room could pay for
	// at full capacity is worth waiting for; anything it could not is what the fallthrough is for,
	// so an unbuildable reserver still can't block the queue.
	const worthWaitingFor = requests.find(
		candidate => creepBodies.bodyCost(candidate.body) <= room.energyCapacityAvailable
	);
	const affordableNow = requests.find(candidate => room.energyAvailable >= creepBodies.bodyCost(candidate.body));

	const savingUp = worthWaitingFor && worthWaitingFor !== affordableNow;
	if (savingUp) return;

	const request = affordableNow;
	if (!request) return;

	const cost = creepBodies.bodyCost(request.body);
	const name = `${request.role}_${Game.time}`;
	const spawned = spawn.spawnCreep(request.body, name, { memory: request.memory }) === OK;
	if (spawned) logSpawn(request.role, name, cost);
}

module.exports = { runSpawnQueue };

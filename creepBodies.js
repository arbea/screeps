const mining = require('./mining');

// Bodies are base + repeat×n, with n grown until the energy budget or the game's part limit stops
// it. Writing them as a recipe rather than a hand-built array means one formula scales every role
// from a 300-energy starter room to a 12,900-energy RCL8 one without a second set of numbers.
//
// A recipe that cannot afford even one repeat returns null rather than a token creep: the spec's
// rule is to skip a role you cannot build properly, because a one-part body costs a full creep's
// worth of spawn time and CPU to accomplish almost nothing.
function partsCost(parts) {
	return parts.reduce((sum, part) => sum + BODYPART_COST[part], 0);
}

function buildBody(recipe, energyBudget) {
	const base = recipe.base || [];
	const repeat = recipe.repeat || [];

	if (repeat.length === 0) return partsCost(base) <= energyBudget ? base.slice() : null;

	const affordableRepeats = Math.floor((energyBudget - partsCost(base)) / partsCost(repeat));
	const repeatsByPartLimit = Math.floor((MAX_CREEP_SIZE - base.length) / repeat.length);
	const repeats = Math.min(affordableRepeats, repeatsByPartLimit, recipe.maxRepeat || Infinity);

	if (repeats < 1) return null;

	const body = base.slice();
	for (let i = 0; i < repeats; i++) body.push(...repeat);
	return body;
}

// A hauler carries and moves, nothing else. It used to be a generalist carrying WORK parts it
// never used on a delivery - parts that cost energy, slow the creep down and buy nothing, since
// under the ledger the hauler never mines. Dropping them doubles the load per energy spent.
const RECIPES = {
	hauler: { repeat: [CARRY, MOVE] },
	builder: { repeat: [WORK, CARRY, MOVE] },
	upgrader: { repeat: [WORK, CARRY, MOVE] },
	defender: { repeat: [ATTACK, MOVE] },
	// Travels further than a home-room creep, so it gets more MOVE per WORK.
	remoteHarvester: { repeat: [WORK, WORK, CARRY, MOVE, MOVE] },
	remoteDefender: { repeat: [ATTACK, MOVE] },
	scout: { base: [MOVE] },
	// All WORK and legs: dismantling needs no CARRY (the trickle of energy it returns is spent
	// where it stands), and every CARRY forgone is another 50 hits per tick against the wall.
	breacher: { repeat: [WORK, MOVE] },
	reserver: { base: [CLAIM, MOVE] },
};

// The miner is the one body the game itself bounds: five WORK parts drain a source at exactly its
// regen rate, so a sixth would idle. It carries nothing - it stands on its square and drops what
// it mines, which is the whole point of decoupling it from hauling.
function minerRecipe(energyBudget) {
	return { base: [MOVE], repeat: [WORK], maxRepeat: mining.minerWorkCount(energyBudget) };
}

function bodyFor(role, energyBudget) {
	if (role === 'miner') return buildBody(minerRecipe(energyBudget), energyBudget);

	const recipe = RECIPES[role];
	if (!recipe) return null;

	return buildBody(recipe, energyBudget);
}

function bodyCost(body) {
	return partsCost(body);
}

module.exports = { bodyFor, buildBody, bodyCost, RECIPES };

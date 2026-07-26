const TASK_TYPES = require('./taskTypes');
const taskOrder = require('./taskOrder');
const mining = require('./mining');

// Delivery order from the spec, lowest number first. Production comes before everything because a
// room that cannot spawn cannot recover from anything; towers next because they are the only thing
// that shoots back on its own; links and storage last, as they hold energy rather than spend it.
const REQUEST_RANK = {
	[STRUCTURE_SPAWN]: 0,
	[STRUCTURE_EXTENSION]: 0,
	[STRUCTURE_TOWER]: 1,
	[STRUCTURE_LINK]: 2,
	[STRUCTURE_STORAGE]: 3,
};

const LOWEST_RANK = 3;

// Requests sit inside HAUL's own band: where hauling ranks against building or upgrading is one
// question, and which sink to fill first is another. Mixing them would let a storage top-up
// outrank a build task simply for being a delivery.
function requestPriority(structureType) {
	const rank = REQUEST_RANK[structureType];
	const known = rank !== undefined;
	return taskOrder.basePriority(TASK_TYPES.HAUL) + (known ? LOWEST_RANK - rank : 0);
}

// A hauler's whole load is spoken for the moment it accepts a delivery, so it is deducted from the
// target's need immediately rather than when it arrives. Without this every hauler in the room
// sees the same empty extension and converges on it, and all but the first arrive to find it full.
function inTransitTo(targetId) {
	let claimed = 0;
	for (const name in Game.creeps) {
		const creep = Game.creeps[name];
		const task = creep.memory.task;
		const headingThere = task && task.type === TASK_TYPES.HAUL && task.targetId === targetId;
		if (headingThere) claimed += creep.store[RESOURCE_ENERGY];
	}
	return claimed;
}

// Same reasoning on the collection side: two haulers sent to the same 50-energy pile means one
// wasted trip, so a pile counts only what nobody is already on their way to take.
function claimedFromSupply(supplyId) {
	let claimed = 0;
	for (const name in Game.creeps) {
		const creep = Game.creeps[name];
		const task = creep.memory.task;
		const goingThere = task && task.pickupFrom === supplyId;
		if (goingThere) claimed += creep.store.getFreeCapacity(RESOURCE_ENERGY);
	}
	return claimed;
}

function isProductionShort(room) {
	return room.energyAvailable < room.energyCapacityAvailable;
}

function collectRequests(room) {
	const sinks = room.find(FIND_MY_STRUCTURES, {
		filter: structure => REQUEST_RANK[structure.structureType] !== undefined && structure.store,
	});

	const requests = [];
	for (const sink of sinks) {
		const free = sink.store.getFreeCapacity(RESOURCE_ENERGY);
		if (!free) continue;

		// Storage is where surplus goes to rest. Filling it while the spawn is still short would
		// park energy the room needs right now, so it only accepts deliveries once production is
		// satisfied.
		const parkingSurplusTooEarly = sink.structureType === STRUCTURE_STORAGE && isProductionShort(room);
		if (parkingSurplusTooEarly) continue;

		const need = free - inTransitTo(sink.id);
		if (need <= 0) continue;

		requests.push({
			id: sink.id,
			pos: sink.pos,
			structureType: sink.structureType,
			need,
			priority: requestPriority(sink.structureType),
		});
	}
	return requests;
}

// Everything a hauler could load from. Miners drop where they stand, so containers and loose piles
// are the normal case; storage only opens up when production needs feeding, which is the same rule
// that keeps deliveries out of it.
function collectSupplies(room) {
	const supplies = [];

	for (const pile of room.find(FIND_DROPPED_RESOURCES, { filter: resource => resource.resourceType === RESOURCE_ENERGY })) {
		supplies.push({ id: pile.id, pos: pile.pos, amount: pile.amount });
	}

	for (const structure of room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_CONTAINER })) {
		const stored = structure.store[RESOURCE_ENERGY];
		if (stored > 0) supplies.push({ id: structure.id, pos: structure.pos, amount: stored });
	}

	// Ruins and tombstones are the only "demolition" the game allows: neither can be removed by
	// hand, both decay on their own schedule - what can be done is carry their store home first.
	// collectFrom already withdraws from anything with a store, so listing them is the whole job.
	for (const ruin of room.find(FIND_RUINS, { filter: r => r.store[RESOURCE_ENERGY] > 0 })) {
		supplies.push({ id: ruin.id, pos: ruin.pos, amount: ruin.store[RESOURCE_ENERGY] });
	}
	for (const tomb of room.find(FIND_TOMBSTONES, { filter: t => t.store[RESOURCE_ENERGY] > 0 })) {
		supplies.push({ id: tomb.id, pos: tomb.pos, amount: tomb.store[RESOURCE_ENERGY] });
	}

	const storage = room.storage;
	if (storage && isProductionShort(room) && storage.store[RESOURCE_ENERGY] > 0) {
		supplies.push({ id: storage.id, pos: storage.pos, amount: storage.store[RESOURCE_ENERGY] });
	}

	return supplies.filter(supply => supply.amount - claimedFromSupply(supply.id) > 0);
}

// The spec's scoring: a bigger pile is worth walking for, but each step costs twenty energy's worth
// of preference, so a hauler takes the near-enough pile rather than crossing the room for a
// slightly larger one. Distance dominates for anything under a few hundred, which is what keeps
// round trips short.
const DISTANCE_WEIGHT = 20;

function scoreSupply(creep, supply) {
	return supply.amount - creep.pos.getRangeTo(supply.pos) * DISTANCE_WEIGHT;
}

function bestSupplyFor(creep) {
	const supplies = collectSupplies(creep.room);
	if (supplies.length === 0) return null;

	return supplies.reduce((best, supply) => (scoreSupply(creep, supply) > scoreSupply(creep, best) ? supply : best));
}

// One task per hauler-load of unmet need, so a spawn drained of 300 pulls several haulers while a
// half-empty extension pulls one. Sized against a conservative body rather than any particular
// creep's capacity - the queue is built before anyone is assigned to it.
const HAULER_CAPACITY_ESTIMATE = 50;

function addHaulTasks(room, tasks) {
	for (const request of collectRequests(room)) {
		// Also capped by how many haulers can physically stand next to the sink, the same limit
		// that bounds miners around a source. A tower with 1000 free capacity would otherwise open
		// twenty tasks that no twenty creeps could ever service at once, flooding the queue and the
		// snapshot with work that only looks available.
		const byNeed = Math.ceil(request.need / HAULER_CAPACITY_ESTIMATE);
		const byRoomAtTheSink = mining.getAccessibleTiles(room, request.pos).length;

		const slots = Math.min(byNeed, byRoomAtTheSink);
		for (let slot = 0; slot < slots; slot++) {
			tasks.push({
				id: `${TASK_TYPES.HAUL}:${request.id}:${slot}`,
				type: TASK_TYPES.HAUL,
				priority: request.priority,
				targetId: request.id,
			});
		}
	}
}

// What the spawn queue needs to know: is there delivery work nobody is doing? This replaces asking
// how many haulers a source's surrounding tiles could hold - the ledger measures demand, and demand
// is what another pair of hands would actually answer.
function unclaimedRequestCount(room) {
	const claimed = new Set();
	for (const name in Game.creeps) {
		const task = Game.creeps[name].memory.task;
		if (task && task.type === TASK_TYPES.HAUL) claimed.add(task.id);
	}

	const tasks = [];
	addHaulTasks(room, tasks);
	return tasks.filter(task => !claimed.has(task.id)).length;
}

module.exports = { addHaulTasks, bestSupplyFor, unclaimedRequestCount, collectRequests, collectSupplies };

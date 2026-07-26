const TASK_TYPES = require('./taskTypes');
const { logDone } = require('./log');
const { checkAndHandleStall } = require('./stallDetection');
const hostiles = require('./hostiles');
const logistics = require('./logistics');
const energyLedger = require('./energyLedger');

function runDefense(creep, hostile) {
	const inRange = creep.pos.inRangeTo(hostile, 1);
	if (!inRange) {
		creep.moveTo(hostile);
		return false;
	}
	creep.attack(hostile);
	return false;
}

function runRefill(creep, structure) {
	const energyEmpty = creep.store[RESOURCE_ENERGY] === 0;
	if (energyEmpty) return true;

	const targetFull = structure.store.getFreeCapacity(RESOURCE_ENERGY) === 0;
	if (targetFull) return true;

	const inRange = creep.pos.isNearTo(structure);
	if (!inRange) {
		creep.moveTo(structure);
		return false;
	}
	creep.transfer(structure, RESOURCE_ENERGY);
	return true;
}

// Builders and upgraders spend energy but are not carriers, so an empty one used to abandon its
// task - which put it straight back in the queue where HAUL outranks what it was hired to do, and
// it never came back. Fetching its own load from the ledger instead is what makes a dedicated role
// mean anything: it stays on its job across the whole cycle of running dry and refilling.
//
// Returns true when there is nothing to fetch and nothing to spend, which is the one case where
// giving the task up is right - holding it would block anyone else from taking it.
function refuel(creep) {
	const supply = logistics.bestSupplyFor(creep);
	if (!supply) return true;

	// Recorded so other creeps deduct this one's share of the pile while it walks over.
	creep.memory.task.pickupFrom = supply.id;
	collectFrom(creep, supply);
	return false;
}

function runBuild(creep, site) {
	const energyEmpty = creep.store[RESOURCE_ENERGY] === 0;
	if (energyEmpty) return refuel(creep);

	const inRange = creep.pos.inRangeTo(site, 3);
	if (!inRange) {
		creep.moveTo(site);
		return false;
	}
	// The intent's spend, counted only when the intent is accepted. BUILD_POWER per WORK, capped
	// by what the creep holds and what the site still needs - the same caps the game applies.
	const built = creep.build(site) === OK;
	if (built) {
		const workParts = creep.getActiveBodyparts(WORK);
		energyLedger.record('build', Math.min(workParts * BUILD_POWER, creep.store[RESOURCE_ENERGY], site.progressTotal - site.progress));
	}
	return false;
}

function runRepair(creep, structure) {
	const energyEmpty = creep.store[RESOURCE_ENERGY] === 0;
	if (energyEmpty) return refuel(creep);

	const repaired = structure.hits === structure.hitsMax;
	if (repaired) return true;

	const inRange = creep.pos.inRangeTo(structure, 3);
	if (!inRange) {
		creep.moveTo(structure);
		return false;
	}
	// One energy per WORK per repair tick (REPAIR_POWER hits at REPAIR_COST each), capped by the
	// hits actually missing and the energy actually held.
	const repairing = creep.repair(structure) === OK;
	if (repairing) {
		const workParts = creep.getActiveBodyparts(WORK);
		energyLedger.record('repair', Math.min(
			workParts * REPAIR_POWER * REPAIR_COST,
			creep.store[RESOURCE_ENERGY],
			Math.ceil((structure.hitsMax - structure.hits) * REPAIR_COST)
		));
	}
	return false;
}

function runUpgrade(creep, controller, task) {
	// Tasks issued before upgrading was sliced into slots carry none. Ending one hands the
	// upgrader back to the queue, which reissues slotted ids on the next tick - the same
	// migration path the miners' workPos went through.
	if (task.slot === undefined) return true;

	const energyEmpty = creep.store[RESOURCE_ENERGY] === 0;
	if (energyEmpty) return refuel(creep);

	const inRange = creep.pos.inRangeTo(controller, 3);
	if (!inRange) {
		creep.moveTo(controller);
		return false;
	}
	creep.upgradeController(controller);
	return false;
}

function runScout(creep, task) {
	const arrived = creep.room.name === task.targetRoomName;
	if (arrived) return true;

	creep.moveTo(new RoomPosition(25, 25, task.targetRoomName));
	return false;
}

function runReserveController(creep, controller) {
	const inRange = creep.pos.inRangeTo(controller, 1);
	if (!inRange) {
		creep.moveTo(controller);
		return false;
	}
	creep.reserveController(controller);
	return false;
}

function deliverEnergyHome(creep) {
	const homeRoomName = creep.memory.homeRoom;
	const inHomeRoom = creep.room.name === homeRoomName;
	if (!inHomeRoom) {
		creep.moveTo(new RoomPosition(25, 25, homeRoomName));
		return false;
	}

	const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
	if (!spawn) return false;

	const inRange = creep.pos.isNearTo(spawn);
	if (!inRange) {
		creep.moveTo(spawn);
		return false;
	}
	// Remote income enters the economy here, not at the foreign rock - energy lost on the road
	// home was never income.
	const delivered = creep.transfer(spawn, RESOURCE_ENERGY) === OK;
	if (delivered) {
		energyLedger.record('remote', Math.min(creep.store[RESOURCE_ENERGY], spawn.store.getFreeCapacity(RESOURCE_ENERGY)));
	}
	return true;
}

function runRemoteHarvest(creep, source, task) {
	const full = creep.store.getFreeCapacity() === 0;
	if (full) return deliverEnergyHome(creep);

	// Outside the target room the waypoint is the room, not the source. The source object only
	// resolves while something else keeps that room visible, so steering by it from a distance
	// makes the destination flip between source and room-centre every time vision flickers -
	// each flip threw the cached path away, and a harvester spent 600 ticks re-pathing in its
	// own driveway. One fixed waypoint per leg; precision starts where vision is guaranteed.
	const outbound = task && task.targetRoomName && creep.room.name !== task.targetRoomName;
	if (outbound) {
		creep.moveTo(new RoomPosition(25, 25, task.targetRoomName));
		return false;
	}

	const inRange = creep.pos.isNearTo(source);
	if (!inRange) {
		creep.moveTo(source);
		return false;
	}
	creep.harvest(source);
	return false;
}

// No energy involved in either direction that matters: dismantling needs none, and the trickle
// it returns stays in the store until it overflows, which is fine - the wall is the point.
function runDismantle(creep, wall) {
	const inRange = creep.pos.isNearTo(wall);
	if (!inRange) {
		creep.moveTo(wall);
		return false;
	}
	creep.dismantle(wall);
	return false;
}

function runMine(creep, source, task) {
	// Tasks issued before miners were given squares have none to hold. Ending one hands the miner
	// back to the queue, which reissues it with a square on the next tick, so no migration step is
	// needed for miners already in the field.
	if (!task.workPos) return true;

	// Once on its own square the miner never moves again: it harvests in place, and its energy
	// drops onto whatever is beneath it - the container, if one was built there.
	const atWorkPos = creep.pos.x === task.workPos.x && creep.pos.y === task.workPos.y;
	if (!atWorkPos) {
		// The square itself, not a tile beside it: what the miner drops lands where it stands, and
		// beside the container is the ground.
		creep.moveTo(task.workPos.x, task.workPos.y, { range: 0 });
		return false;
	}
	creep.harvest(source);
	return false;
}

function deliverEnergyToStructures(creep) {
	const target = creep.room.find(FIND_MY_STRUCTURES, {
		filter: structure =>
			(structure.structureType === STRUCTURE_SPAWN ||
				structure.structureType === STRUCTURE_EXTENSION ||
				structure.structureType === STRUCTURE_TOWER) &&
			structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
	})[0];
	// Nowhere left to put it means the room's stores are full, not that this creep still has
	// work to do - reporting "not done" here strands it holding a full load forever, and once
	// every hauler is stranded the miners keep dropping energy that decays on the ground. The
	// haul is finished; ending it frees the creep to be reassigned, and since it is carrying
	// energy it immediately qualifies for BUILD/REPAIR/UPGRADE, which is where that load should
	// go when the stores can't take it.
	if (!target) return true;

	const inRange = creep.pos.isNearTo(target);
	if (!inRange) {
		creep.moveTo(target);
		return false;
	}
	creep.transfer(target, RESOURCE_ENERGY);
	return true;
}

function collectFrom(creep, supply) {
	const inRange = creep.pos.isNearTo(supply.pos);
	if (!inRange) {
		creep.moveTo(supply.pos.x, supply.pos.y);
		return false;
	}

	// A loose pile is picked up; a container or storage is withdrawn from. Resolving the object
	// only once we are adjacent keeps this to one lookup per arrival rather than per tick of travel.
	const target = Game.getObjectById(supply.id);
	if (!target) return false;

	if (target.amount !== undefined) {
		creep.pickup(target);
	} else {
		// Tombstones and ruins are the one supply that never passed through a source we metered,
		// so emptying them is income in its own right - and the offset that turns a looted
		// corpse's death loss back into a net figure.
		const grave = target.deathTime !== undefined || target.destroyTime !== undefined;
		const withdrawn = creep.withdraw(target, RESOURCE_ENERGY) === OK;
		if (grave && withdrawn) {
			energyLedger.record('salvage', Math.min(creep.store.getFreeCapacity(RESOURCE_ENERGY), target.store[RESOURCE_ENERGY]));
		}
	}
	return false;
}

// The hauler belongs to no source. Its task names only where the energy is going; where it comes
// from is chosen fresh each trip from whatever the ledger scores highest, so an emptied source
// simply stops being picked and its haulers move to another without anyone reassigning them.
function runHaul(creep, sink, task) {
	const room = creep.room;
	const roomHasCapacity = creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0;

	if (roomHasCapacity) {
		const supply = logistics.bestSupplyFor(creep);
		if (supply) {
			// Remembered so other haulers deduct this creep's share of that pile while it is on its
			// way, which is what stops two of them being sent to the same load.
			task.pickupFrom = supply.id;
			return collectFrom(creep, supply);
		}
		// Nothing left to collect - release the claim so it stops being deducted from a pile this
		// creep is no longer going to.
		delete task.pickupFrom;
	}

	const carrying = creep.store[RESOURCE_ENERGY] > 0;
	// Nothing to carry and nothing to collect: the delivery cannot be made, so release the task
	// rather than stand on it and keep the sink claimed against everyone else.
	if (!carrying) return true;

	const sinkFull = sink.store && sink.store.getFreeCapacity(RESOURCE_ENERGY) === 0;
	if (sinkFull) return true;

	const inRange = creep.pos.isNearTo(sink);
	if (!inRange) {
		creep.moveTo(sink);
		return false;
	}
	creep.transfer(sink, RESOURCE_ENERGY);
	return true;
}

// Never reports done: recycleCreep destroys the creep on success, so there is no creep left to
// clear the task from. A failure (out of range, spawn busy) just retries next tick.
function runRecycle(creep, spawn) {
	const inRange = creep.pos.isNearTo(spawn);
	if (!inRange) {
		creep.moveTo(spawn);
		return false;
	}
	const recycled = spawn.recycleCreep(creep) === OK;
	if (recycled) {
		// An estimate, stated as one: the game refunds a share of the build cost scaled by the
		// life the creep had left, dropped where it stood. Booked here because the pile it lands
		// in never touches a metered source.
		const bodyCost = creep.body.reduce((sum, part) => sum + BODYPART_COST[part.type], 0);
		energyLedger.record('recycle', Math.floor((bodyCost / 2) * ((creep.ticksToLive || 0) / CREEP_LIFE_TIME)));
	}
	return false;
}

function runRemoteDefense(creep, task) {
	const inTargetRoom = creep.room.name === task.targetRoomName;
	if (!inTargetRoom) {
		creep.moveTo(new RoomPosition(25, 25, task.targetRoomName));
		return false;
	}

	const hostile = hostiles.findHostileCreeps(creep.room)[0];
	if (!hostile) return true;

	const inRange = creep.pos.inRangeTo(hostile, 1);
	if (!inRange) {
		creep.moveTo(hostile);
		return false;
	}
	creep.attack(hostile);
	return false;
}

const ACTIONS = {
	[TASK_TYPES.DEFENSE]: runDefense,
	[TASK_TYPES.REFILL_SPAWN]: runRefill,
	[TASK_TYPES.REFILL_TOWER]: runRefill,
	[TASK_TYPES.MINE]: runMine,
	[TASK_TYPES.HAUL]: runHaul,
	[TASK_TYPES.BUILD]: runBuild,
	[TASK_TYPES.REPAIR]: runRepair,
	[TASK_TYPES.UPGRADE]: runUpgrade,
	[TASK_TYPES.SCOUT]: runScout,
	[TASK_TYPES.DISMANTLE]: runDismantle,
	[TASK_TYPES.RESERVE_CONTROLLER]: runReserveController,
	[TASK_TYPES.REMOTE_HARVEST]: runRemoteHarvest,
	[TASK_TYPES.REMOTE_DEFENSE]: runRemoteDefense,
	[TASK_TYPES.RECYCLE]: runRecycle,
};

// SCOUT and REMOTE_DEFENSE don't target a fixed object id (there's nothing to grab an id
// from in a room we haven't seen yet, or the target is whichever hostile is currently
// present), so they run against the task itself rather than a resolved Game object.
const ROOM_TARGETED_TASKS = new Set([TASK_TYPES.SCOUT, TASK_TYPES.REMOTE_DEFENSE]);

// A relief miner has no task yet by design - its predecessor still holds the source. Walking to
// the pit now is the whole point of having been spawned early; range 2 keeps it off the work
// square and out of the incumbent's way until the MINE task frees up.
function standByForRelief(creep) {
	const sourceId = creep.memory.standbyFor;
	if (!sourceId) return;

	const source = Game.getObjectById(sourceId);
	if (!source) return;

	const atPost = creep.pos.inRangeTo(source, 2);
	if (!atPost) creep.moveTo(source, { range: 2 });
}

function runCreep(creep) {
	// The cargo a creep dies with is only knowable if it was written down while it lived - the
	// corpse's store is gone by the time the memory sweep sees the death. Kept only while
	// non-zero so empty creeps don't grow a permanent field.
	const carrying = creep.store[RESOURCE_ENERGY];
	if (carrying > 0) creep.memory.carrying = carrying;
	else if (creep.memory.carrying !== undefined) delete creep.memory.carrying;

	const task = creep.memory.task;
	if (!task) {
		standByForRelief(creep);
		return;
	}

	// Whatever it was standing by for, it has real work now.
	if (creep.memory.standbyFor !== undefined) delete creep.memory.standbyFor;

	const wasStalled = checkAndHandleStall(creep);
	if (wasStalled) return;

	if (ROOM_TARGETED_TASKS.has(task.type)) {
		const done = ACTIONS[task.type](creep, task);
		if (done) {
			logDone(creep, task, null);
			delete creep.memory.task;
		}
		return;
	}

	const target = Game.getObjectById(task.targetId);
	if (!target) {
		// A remote target only resolves via getObjectById once its room is actually visible
		// (a creep is standing in it). Before that first arrival there's nothing to fetch yet -
		// that's not a dead task, just travel toward the room instead of discarding it.
		const stillTravelingToTarget = task.targetRoomName && creep.room.name !== task.targetRoomName;
		if (stillTravelingToTarget) {
			creep.moveTo(new RoomPosition(25, 25, task.targetRoomName));
			return;
		}
		delete creep.memory.task;
		return;
	}

	const done = ACTIONS[task.type](creep, target, task);
	if (done) {
		logDone(creep, task, target);
		delete creep.memory.task;
	}
}

module.exports = { runCreep };

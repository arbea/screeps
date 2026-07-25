const TASK_TYPES = require('./taskTypes');
const { logDone } = require('./log');

function runDefense(creep, hostile) {
	const inRange = creep.pos.inRangeTo(hostile, 1);
	if (!inRange) {
		creep.moveTo(hostile);
		return false;
	}
	creep.attack(hostile);
	return false;
}

function runHarvest(creep, source) {
	const full = creep.store.getFreeCapacity() === 0;
	if (full) return true;

	const inRange = creep.pos.isNearTo(source);
	if (!inRange) {
		creep.moveTo(source);
		return false;
	}
	creep.harvest(source);
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

function runBuild(creep, site) {
	const energyEmpty = creep.store[RESOURCE_ENERGY] === 0;
	if (energyEmpty) return true;

	const inRange = creep.pos.inRangeTo(site, 3);
	if (!inRange) {
		creep.moveTo(site);
		return false;
	}
	creep.build(site);
	return false;
}

function runRepair(creep, structure) {
	const energyEmpty = creep.store[RESOURCE_ENERGY] === 0;
	if (energyEmpty) return true;

	const repaired = structure.hits === structure.hitsMax;
	if (repaired) return true;

	const inRange = creep.pos.inRangeTo(structure, 3);
	if (!inRange) {
		creep.moveTo(structure);
		return false;
	}
	creep.repair(structure);
	return false;
}

function runUpgrade(creep, controller) {
	const energyEmpty = creep.store[RESOURCE_ENERGY] === 0;
	if (energyEmpty) return true;

	const inRange = creep.pos.inRangeTo(controller, 3);
	if (!inRange) {
		creep.moveTo(controller);
		return false;
	}
	creep.upgradeController(controller);
	return false;
}

const ACTIONS = {
	[TASK_TYPES.DEFENSE]: runDefense,
	[TASK_TYPES.REFILL_SPAWN]: runRefill,
	[TASK_TYPES.REFILL_TOWER]: runRefill,
	[TASK_TYPES.HARVEST]: runHarvest,
	[TASK_TYPES.BUILD]: runBuild,
	[TASK_TYPES.REPAIR]: runRepair,
	[TASK_TYPES.UPGRADE]: runUpgrade,
};

function runCreep(creep) {
	const task = creep.memory.task;
	if (!task) return;

	const target = Game.getObjectById(task.targetId);
	if (!target) {
		delete creep.memory.task;
		return;
	}

	const done = ACTIONS[task.type](creep, target);
	if (done) {
		logDone(creep, task, target);
		delete creep.memory.task;
	}
}

module.exports = { runCreep };

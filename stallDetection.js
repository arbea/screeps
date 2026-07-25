const config = require('./config');
const TASK_TYPES = require('./taskTypes');
const { log } = require('./log');

// MINE and RESERVE_CONTROLLER are designed to sit at the same spot forever without ever
// completing - that's correct behavior for them, not a stall, so they're excluded outright
// rather than tuned around with thresholds.
const EXCLUDED_FROM_STALL_CHECK = new Set([TASK_TYPES.MINE, TASK_TYPES.RESERVE_CONTROLLER]);

function isSamePosition(a, b) {
	return a && b && a.x === b.x && a.y === b.y && a.roomName === b.roomName;
}

// Must run once per creep per tick even when nothing looks wrong, since it's what maintains
// the "how long has this task/position been unchanged" bookkeeping the stall check depends on.
function trackCreep(creep) {
	const task = creep.memory.task;
	if (!task) {
		delete creep.memory.taskStartTick;
		delete creep.memory.taskId;
		return;
	}

	const isNewTask = creep.memory.taskId !== task.id;
	if (isNewTask) {
		creep.memory.taskId = task.id;
		creep.memory.taskStartTick = Game.time;
	}

	const currentPos = { x: creep.pos.x, y: creep.pos.y, roomName: creep.pos.roomName };
	const stayedPut = isSamePosition(creep.memory.lastPos, currentPos);
	if (!stayedPut) {
		creep.memory.posUnchangedSince = Game.time;
	}
	creep.memory.lastPos = currentPos;
}

function isStalled(creep) {
	const task = creep.memory.task;
	if (!task) return false;
	if (EXCLUDED_FROM_STALL_CHECK.has(task.type)) return false;

	const taskStuck = Game.time - creep.memory.taskStartTick > config.STALL_TASK_TICKS;
	const positionStuck = Game.time - (creep.memory.posUnchangedSince || Game.time) > config.STALL_POSITION_TICKS;
	return taskStuck && positionStuck;
}

function unstickCreep(creep) {
	const task = creep.memory.task;
	const taskTicks = Game.time - creep.memory.taskStartTick;
	const positionTicks = Game.time - creep.memory.posUnchangedSince;
	log(
		`[發呆] ${creep.name} 卡在「${task.type}」${taskTicks} tick、位置 ${positionTicks} tick 沒變,強制解除任務重新指派`
	);

	delete creep.memory.task;
	delete creep.memory.taskStartTick;
	delete creep.memory.taskId;
	delete creep.memory.posUnchangedSince;
	delete creep.memory.lastPos;
}

// Returns true if the creep was stalled and got unstuck, so the caller can skip running its
// task action this tick (it has none left to run) rather than acting on stale state.
function checkAndHandleStall(creep) {
	trackCreep(creep);

	if (!isStalled(creep)) return false;

	unstickCreep(creep);
	return true;
}

module.exports = { checkAndHandleStall };

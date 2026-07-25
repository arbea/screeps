const config = require('./config');
const TASK_TYPES = require('./taskTypes');

function log(message) {
	if (!config.LOG_ENABLED) return;
	console.log(`[${Game.time}] ${message}`);
	pushEventLog(message);
}

function pushEventLog(message) {
	Memory.eventLog.push({ tick: Game.time, message });

	const configuredSize = config.EVENT_LOG_SIZE;
	const validSize = typeof configuredSize === 'number' && Number.isFinite(configuredSize) && configuredSize > 0;
	const maxSize = validSize ? configuredSize : 50;

	const overCap = Memory.eventLog.length > maxSize;
	if (overCap) Memory.eventLog.shift();
}

function describeTask(task, target) {
	if (!target) {
		if (task.targetRoomName) {
			const label = task.type === TASK_TYPES.SCOUT ? '偵查' : '遠程防禦';
			return `${label} (${task.targetRoomName})`;
		}
		return task.type;
	}

	switch (task.type) {
		case TASK_TYPES.HARVEST:
			return `礦源 (${target.pos.x},${target.pos.y})`;
		case TASK_TYPES.REFILL_SPAWN:
			return `${target.structureType === STRUCTURE_SPAWN ? 'Spawn' : 'Extension'} 補給`;
		case TASK_TYPES.REFILL_TOWER:
			return '防禦塔補給';
		case TASK_TYPES.BUILD:
			return `工地 (${target.pos.x},${target.pos.y})`;
		case TASK_TYPES.REPAIR:
			return `${target.structureType} (${target.pos.x},${target.pos.y})`;
		case TASK_TYPES.UPGRADE:
			return 'Controller 升級';
		case TASK_TYPES.DEFENSE:
			return target.owner ? target.owner.username : '不明敵人';
		case TASK_TYPES.RESERVE_CONTROLLER:
			return `佔領 Controller (${target.pos.roomName})`;
		case TASK_TYPES.REMOTE_HARVEST:
			return `遠程礦源 (${target.pos.roomName} ${target.pos.x},${target.pos.y})`;
		default:
			return task.type;
	}
}

function logAssign(creep, task, target) {
	log(`[派工] ${creep.name} 前往處理:${describeTask(task, target)}`);
}

function logDone(creep, task, target) {
	log(`[完工] ${creep.name} 完成了:${describeTask(task, target)}`);
}

function logSpawn(role, name, cost) {
	const roleLabel = role === 'defender' ? '戰鬥兵' : '通才兵';
	log(`[誕生] 新的${roleLabel} ${name} 誕生了(造價 ${cost} 能量)`);
}

function logDefense(room, hostile) {
	const attacker = hostile.owner ? hostile.owner.username : '不明生物';
	log(`[入侵] ${room.name} 出現敵人:${attacker}`);
}

module.exports = { log, logAssign, logDone, logSpawn, logDefense, describeTask };

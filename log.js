const config = require('./config');
const TASK_TYPES = require('./taskTypes');

function log(message) {
	if (!config.LOG_ENABLED) return;
	console.log(`[${Game.time}] ${message}`);
	pushEventLog(message);
}

function pushEventLog(message) {
	Memory.eventLog.push({ tick: Game.time, message });

	const overCap = Memory.eventLog.length > config.EVENT_LOG_SIZE;
	if (overCap) Memory.eventLog.shift();
}

const ROOM_ONLY_TASK_LABELS = {
	[TASK_TYPES.SCOUT]: '偵查',
	[TASK_TYPES.REMOTE_DEFENSE]: '遠程防禦',
	[TASK_TYPES.REMOTE_HARVEST]: '遠程礦源(移動中)',
	[TASK_TYPES.RESERVE_CONTROLLER]: '佔領 Controller(移動中)',
};

function describeTask(task, target) {
	if (!target) {
		if (task.targetRoomName) {
			const label = ROOM_ONLY_TASK_LABELS[task.type] || task.type;
			return `${label} (${task.targetRoomName})`;
		}
		return task.type;
	}

	switch (task.type) {
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
		case TASK_TYPES.MINE:
			return `駐守開採 (${target.pos.x},${target.pos.y})`;
		case TASK_TYPES.HAUL:
			return `搬運能量 (${target.pos.x},${target.pos.y})`;
		case TASK_TYPES.RECYCLE:
			return '回收多餘礦工';
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

const SPAWN_ROLE_LABELS = {
	defender: '戰鬥兵',
	miner: '礦工',
	hauler: '搬運兵',
	builder: '建造兵',
	upgrader: '升級兵',
	scout: '偵查兵',
	reserver: '佔領兵',
	remoteHarvester: '遠程採礦兵',
	remoteDefender: '遠程戰鬥兵',
};

function logSpawn(role, name, cost) {
	const roleLabel = SPAWN_ROLE_LABELS[role] || role;
	log(`[誕生] 新的${roleLabel} ${name} 誕生了(造價 ${cost} 能量)`);
}

function logDefense(room, hostile) {
	const attacker = hostile.owner ? hostile.owner.username : '不明生物';
	log(`[入侵] ${room.name} 出現敵人:${attacker}`);
}

module.exports = { log, logAssign, logDone, logSpawn, logDefense, describeTask };

const config = require('./config');
const hostiles = require('./hostiles');

const ROOM_WIDTH = 50;

function toPoint(target) {
	return { x: target.pos.x, y: target.pos.y };
}

// Packed into a single tile index rather than an {x,y} pair. A developed room holds hundreds of
// roads, and Memory is serialised in full every tick, so the difference between `{"x":12,"y":34}`
// and `612` is a cost paid continuously rather than once per snapshot.
function toTileIndex(target) {
	return target.pos.y * ROOM_WIDTH + target.pos.x;
}

// Grouped by whatever the room actually holds rather than by a fixed list, so a structure type that
// only becomes available at a later controller level appears on its own. Spawns are left out: they
// are published separately and drawn as their own marker.
function structuresByType(room) {
	const byType = {};

	for (const structure of room.find(FIND_STRUCTURES)) {
		if (structure.structureType === STRUCTURE_SPAWN) continue;

		if (!byType[structure.structureType]) byType[structure.structureType] = [];
		byType[structure.structureType].push(toTileIndex(structure));
	}

	return byType;
}

// Structures change on the order of hundreds of ticks - one extension finished, one road laid - so
// rescanning them at the snapshot's own cadence would pay for the room's costliest find ten times
// over for every change it catches. The previous reading stands until the next scan.
//
// Measured against the tick the last scan actually happened rather than against a modulo of the
// clock: a modulo only lines up while the snapshot's own interval divides it, and a scan tick the
// snapshot skips is a scan that never happens.
const STRUCTURE_SCAN_INTERVAL = 50;

function structuresFor(room) {
	const published = Memory.mapSnapshot[room.name];
	const scannedAt = published && published.structuresScannedAt;

	// A missing timestamp has to count as stale, and the reason is arithmetic: a snapshot written
	// by the version before this field existed carries structures but no stamp, and
	// `Game.time - undefined` is NaN - which is not >= anything, so the entry read as fresh, got
	// republished with its timestamp still missing, and froze that way permanently. The structure
	// list stopped updating the moment this cache shipped: the dashboard went on reporting 76
	// relic walls the bot had already destroyed, because the count came from a snapshot that
	// could no longer be replaced.
	const stale = !published || !published.structures || scannedAt === undefined || Game.time - scannedAt >= STRUCTURE_SCAN_INTERVAL;
	if (!stale) return { structures: published.structures, structuresScannedAt: scannedAt };

	return { structures: structuresByType(room), structuresScannedAt: Game.time };
}

function publishMapSnapshot(room) {
	const isSnapshotTick = Game.time % config.SNAPSHOT_INTERVAL === 0;
	if (!isSnapshotTick) return;

	if (!Memory.mapSnapshot) Memory.mapSnapshot = {};

	Memory.mapSnapshot[room.name] = {
		tick: Game.time,
		sources: room.find(FIND_SOURCES).map(toPoint),
		...structuresFor(room),
		spawns: room.find(FIND_MY_SPAWNS).map(toPoint),
		controller: room.controller ? toPoint(room.controller) : null,
		constructionSites: room.find(FIND_MY_CONSTRUCTION_SITES).map(toPoint),
		hostiles: hostiles.findThreateningCreeps(room).map(toPoint),
		creeps: room.find(FIND_MY_CREEPS).map(creep => {
			const task = creep.memory.task;
			const target = task ? Game.getObjectById(task.targetId) : null;
			return {
				x: creep.pos.x,
				y: creep.pos.y,
				name: creep.name,
				role: creep.memory.role || 'generalist',
				taskType: task ? task.type : null,
				targetPos: target ? toPoint(target) : null,
				taskStartTick: creep.memory.taskStartTick || null,
				idleTicks: creep.memory.idleSince === undefined ? 0 : Game.time - creep.memory.idleSince,
				idleTotal: creep.memory.idleTotal || 0,
				// A CLAIM body lives on the shorter clock, so its share is measured against that.
				lived: creep.ticksToLive === undefined
					? 0
					: (creep.getActiveBodyparts(CLAIM) > 0 ? CREEP_CLAIM_LIFE_TIME : CREEP_LIFE_TIME) - creep.ticksToLive,
				energy: creep.store[RESOURCE_ENERGY],
				energyCapacity: creep.store.getCapacity(RESOURCE_ENERGY),
				hits: creep.hits,
				hitsMax: creep.hitsMax,
			};
		}),
	};
}

module.exports = { publishMapSnapshot };

const config = require('./config');
const buildOrder = require('./buildOrder');

// Every tick, count which room tiles our creeps are standing on - a cheap O(creep count)
// scan (no room.find of static structures) that builds a picture of the paths actually being
// walked, so road placement can follow real traffic instead of a guessed layout.
function recordTraffic(room) {
	if (!Memory.traffic) Memory.traffic = {};
	if (!Memory.traffic[room.name]) Memory.traffic[room.name] = {};

	const traffic = Memory.traffic[room.name];
	for (const creep of room.find(FIND_MY_CREEPS)) {
		const key = `${creep.pos.x},${creep.pos.y}`;
		traffic[key] = (traffic[key] || 0) + 1;
	}
}

function hasRoadOrSite(room, x, y) {
	const hasRoad = room.lookForAt(LOOK_STRUCTURES, x, y).some(structure => structure.structureType === STRUCTURE_ROAD);
	if (hasRoad) return true;

	return room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y).some(site => site.structureType === STRUCTURE_ROAD);
}

// Roads are the optional tier: finishing anything the room is actually blocked on comes first,
// and opening road sites alongside them only splits the same builders across more work. Since
// roads never unblock anything, they get only what is left of the site budget once everything
// else has taken its share.
function hasHigherPriorityWork(room) {
	return room.find(FIND_MY_CONSTRUCTION_SITES, {
		filter: site => site.structureType !== STRUCTURE_ROAD,
	}).length > 0;
}

// The budget has to prune as well as gate, or a queue that ran away before the cap existed stays
// jammed forever: road sites nobody is working still hold slots the room needs for a tower or an
// extension. Only untouched sites are removed - anything with build progress represents energy
// already spent, and throwing that away would waste the very resource this is protecting, so a
// room can sit legitimately over the cap until those finish.
function pruneExcessRoadSites(room) {
	const overBudget = room.find(FIND_MY_CONSTRUCTION_SITES).length - buildOrder.MAX_CONCURRENT_SITES;
	if (overBudget <= 0) return;

	const roadSites = room.find(FIND_MY_CONSTRUCTION_SITES, {
		filter: site => site.structureType === STRUCTURE_ROAD,
	});

	let excess = overBudget;
	for (const site of roadSites) {
		const untouched = site.progress === 0;
		if (!untouched) continue;

		site.remove();
		excess--;
		if (excess <= 0) return;
	}
}

// Scans the accumulated traffic counts on the same cadence as the other periodic scans
// (repair/container placement) and lays a road on any tile crossed often enough that it's
// clearly a real path, not a one-off detour. Tiles that already have a road (or a queued site)
// get dropped from the table so it only ever tracks tiles still worth watching, instead of
// growing forever.
function placeRoadsOnHighTraffic(room) {
	const traffic = Memory.traffic[room.name];

	const isScanTick = Game.time % config.REPAIR_SCAN_INTERVAL === 0;
	if (!isScanTick) return;

	if (hasHigherPriorityWork(room)) return;

	let allowance = buildOrder.siteBudgetRemaining(room);
	if (allowance <= 0) return;

	const terrain = room.getTerrain();
	for (const key in traffic) {
		const [x, y] = key.split(',').map(Number);

		if (hasRoadOrSite(room, x, y)) {
			delete traffic[key];
			continue;
		}

		const notFrequentEnough = traffic[key] < config.ROAD_TRAFFIC_THRESHOLD;
		if (notFrequentEnough) continue;
		if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

		const created = room.createConstructionSite(x, y, STRUCTURE_ROAD) === OK;
		if (!created) continue;

		allowance--;
		if (allowance <= 0) return;
	}
}

function runTraffic(room) {
	if (!config.AUTO_BUILD_ROADS) return;

	recordTraffic(room);

	const isScanTick = Game.time % config.REPAIR_SCAN_INTERVAL === 0;
	if (isScanTick) pruneExcessRoadSites(room);

	placeRoadsOnHighTraffic(room);
}

module.exports = { runTraffic };

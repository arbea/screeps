const config = require('./config');

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

// Scans the accumulated traffic counts on the same cadence as the other periodic scans
// (repair/container placement) and lays a road on any tile crossed often enough that it's
// clearly a real path, not a one-off detour. Tiles that already have a road (or a queued site)
// get dropped from the table so it only ever tracks tiles still worth watching, instead of
// growing forever.
function placeRoadsOnHighTraffic(room) {
	const traffic = Memory.traffic[room.name];

	const isScanTick = Game.time % config.REPAIR_SCAN_INTERVAL === 0;
	if (!isScanTick) return;

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

		room.createConstructionSite(x, y, STRUCTURE_ROAD);
	}
}

function runTraffic(room) {
	if (!config.AUTO_BUILD_ROADS) return;

	recordTraffic(room);
	placeRoadsOnHighTraffic(room);
}

module.exports = { runTraffic };

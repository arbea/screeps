// Constants, not knobs: there is no runtime override layer and nothing reads Memory for these.
// Changing one means editing this line and deploying, which is deliberate - a value that can be
// altered from outside is a value whose live meaning cannot be read off the source.
const config = {
	// The alliance protocol's trust circle. Who we stand with is a standing commitment, not
	// anything the map can tell us, so it belongs here - but unlike the other entries it must
	// never be widened by what allies broadcast about themselves: the protocol specifies each
	// player enforces their own list, and auto-merging one would let any listed name add more.
	ALLIES: ['douasin', 'arbea'],

	// Players we never shoot at, without being allies. All four are RCL8 neighbours; the theatre
	// assessment is that staying invisible to them is worth more than any exchange we could win,
	// and that a single stray shot at a passing unit is enough to invite one we cannot survive.
	// They still count toward DEFCON - we notice the danger and can safemode, we just don't fire.
	NON_AGGRESSION: ['keqing', 'rmuchan', 'Petrichor', 'backslash'],

	REPAIR_HP_THRESHOLD: 0.8,
	AUTO_BUILD_CONTAINERS: true,
	AUTO_BUILD_ROADS: true,
	ROAD_TRAFFIC_THRESHOLD: 50,

	BACKLOG_TICKS_THRESHOLD: 5,
	MIN_ENERGY_TO_SPAWN: 200,

	LOG_ENABLED: true,
	EVENT_LOG_SIZE: 150,

	REPAIR_SCAN_INTERVAL: 50,
	SNAPSHOT_INTERVAL: 5,
	CPU_WARN_THRESHOLD: 0.8,

	EXPANSION_ENABLED: true,
	EXPANSION_INTERVAL: 10,
	MIN_SOURCES_FOR_REMOTE: 1,
	DEFEND_REMOTE_ROOMS: true,


	STALL_TASK_TICKS: 100,
	STALL_POSITION_TICKS: 50,
};

module.exports = config;

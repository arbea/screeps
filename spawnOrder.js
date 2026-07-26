// The spec fixes this sequence outright, so it is a constant and not something to configure. The
// order encodes what a room cannot function without: a builder spawned ahead of a miner spends
// energy nobody is replacing, and an upgrader ahead of a hauler has nothing to carry. Reordering
// it is how a room starves itself, which is why it isn't offered as a knob.
//
// Roles the bot does not spawn yet keep their place, so adding one later drops it into the right
// rank without renumbering anything. The spec's "remote groups" and "mineral groups" are expanded
// into the concrete roles that occupy them.
const SPAWN_ORDER = [
	'defender',
	'ranger',
	'miner',
	'hauler',
	'hunter',
	'upgrader',
	'builder',
	'soldier',
	'medic',
	'drainer',
	'scout',
	'breacher',
	'reserver',
	'remoteHarvester',
	'remoteDefender',
	'mineralHarvester',
	'claimer',
	'pioneer',
];

// The generalist predates the spec's split into hauler, upgrader and builder and still does all
// three jobs. It takes the hauler's rank - the highest of the three it covers - until it is split
// into the separate roles the spec describes.
const ROLE_RANK_ALIASES = { generalist: 'hauler' };

// Higher wins, because the spawn queue sorts requests descending. Deriving the number from the
// position keeps the list itself the single source of truth: inserting a role shifts everything
// below it automatically, with no numbers to keep in sync.
function spawnPriority(role) {
	const rankedRole = ROLE_RANK_ALIASES[role] || role;
	const index = SPAWN_ORDER.indexOf(rankedRole);

	// An unlisted role is something the spec never contemplated; it spawns last rather than
	// silently outranking everything by landing at index -1.
	if (index === -1) return 0;

	return SPAWN_ORDER.length - index;
}

module.exports = { spawnPriority, SPAWN_ORDER };

const config = require('./config');

// Single gate for "is this creep an enemy". Every hostility decision - targeting, threat counting,
// defender spawning, whether a room counts as under attack - has to ask here rather than calling
// FIND_HOSTILE_CREEPS directly, because that constant means "not mine", which includes allies.
// One unfiltered call is enough to shoot at a member of the trust circle.
function isAlly(username) {
	return config.ALLIES.includes(username);
}

// Creeps in the room that we are actually willing to fight.
function findHostileCreeps(room) {
	return room.find(FIND_HOSTILE_CREEPS, {
		filter: creep => !creep.owner || !isAlly(creep.owner.username),
	});
}

module.exports = { isAlly, findHostileCreeps };

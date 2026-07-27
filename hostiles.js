const config = require('./config');

// Two different questions, deliberately kept apart:
//
//   findHostileCreeps    - who will we shoot at
//   findThreateningCreeps - who counts as danger
//
// They differ for the RCL8 neighbours. We never fire on them, because at this size any exchange
// ends one way and being ignored is the whole strategy - but a siege by one is still a siege, and
// pretending otherwise would suppress DEFCON exactly when safemode is the only card left. So they
// are excluded from targeting and included in threat.
//
// FIND_HOSTILE_CREEPS means "not mine", which includes allies, so nothing may call it directly.
function isAlly(username) {
	return config.ALLIES.includes(username);
}

function isUnderNonAggression(username) {
	return (config.NON_AGGRESSION || []).includes(username);
}

function ownerOf(creep) {
	return creep.owner ? creep.owner.username : null;
}

// Creeps we are willing to fight. An unowned creep has no name to check and is treated as fair
// game, which covers Invader NPCs.
function findHostileCreeps(room) {
	return room.find(FIND_HOSTILE_CREEPS, {
		filter: creep => {
			const owner = ownerOf(creep);
			return !isAlly(owner) && !isUnderNonAggression(owner);
		},
	});
}

// Creeps whose presence means the room is in danger, whether or not we intend to shoot back.
function findThreateningCreeps(room) {
	return room.find(FIND_HOSTILE_CREEPS, { filter: creep => !isAlly(ownerOf(creep)) });
}

module.exports = { isAlly, isUnderNonAggression, findHostileCreeps, findThreateningCreeps };

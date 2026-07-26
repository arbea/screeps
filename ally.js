const config = require('./config');
const defcon = require('./defcon');
const { log } = require('./log');

const PROTOCOL_VERSION = 1;
const SEGMENT = 90;
const INTERVAL = 20;

// A message that doesn't announce this exact version isn't parsed at all. Guessing at the meaning
// of a format we don't know is worse than staying silent: these messages drive troop movements.
function isSpeakingOurProtocol(message) {
	return message && message.v === PROTOCOL_VERSION;
}

function myUsername() {
	for (const roomName in Game.rooms) {
		const room = Game.rooms[roomName];
		if (room.controller && room.controller.my) return room.controller.owner.username;
	}
	return null;
}

function partners() {
	const self = myUsername();
	return config.ALLIES.filter(name => name !== self);
}

// Only one foreign segment can be read per tick, so with more than one ally they take turns. The
// cursor advances every cycle regardless of whether the read produced anything, so a silent ally
// can't block the others from ever being read.
function nextPartner() {
	const names = partners();
	if (names.length === 0) return null;

	if (!Memory.ally) Memory.ally = {};
	const cursor = Memory.ally.partnerCursor || 0;
	Memory.ally.partnerCursor = (cursor + 1) % names.length;
	return names[cursor % names.length];
}

function ownedRoomReports() {
	const reports = [];
	for (const roomName in Game.rooms) {
		const room = Game.rooms[roomName];
		if (!room.controller || !room.controller.my) continue;

		reports.push({ name: roomName, rcl: room.controller.level, defcon: defcon.level(room) });
	}
	return reports;
}

// Only rooms where we actually saw military structures are worth sending. Sharing rooms we know
// nothing about would overwrite an ally's fresher reading with our ignorance, since intel merges
// by recency.
function shareableIntel() {
	const intel = {};
	for (const roomName in Memory.rooms || {}) {
		const known = Memory.rooms[roomName];
		const hasMilitaryReading = known.towers !== undefined || known.spawns !== undefined;
		if (!hasMilitaryReading) continue;

		intel[roomName] = {
			towers: known.towers || 0,
			towerEnergy: known.towerEnergy || 0,
			spawns: known.spawns || 0,
			lastSeen: known.lastSeen,
		};
	}
	return intel;
}

// A room under real threat asks for help on its own - the spec's point is that nobody should have
// to notice and type a request. DEFCON 1 is an enemy merely being present, which we handle alone.
function defenseRequests() {
	return ownedRoomReports()
		.filter(report => report.defcon >= defcon.LEVELS.THREATENED)
		.map(report => ({ type: 'defense', room: report.name, note: `DEFCON ${report.defcon}` }));
}

// Requests that aren't triggered by game state - asking an ally something - are queued into
// Memory rather than written into this file, so posing a new question is a console line instead of
// a code change and a deploy. Drained when sent: the protocol answers with an ack, so a request
// left in the queue would be re-asked every cycle.
function drainOutbox() {
	if (!Memory.ally) Memory.ally = {};

	const queued = Memory.ally.outbox || [];
	Memory.ally.outbox = [];
	return queued;
}

function buildMessage() {
	if (!Memory.ally) Memory.ally = {};

	return {
		v: PROTOCOL_VERSION,
		tick: Game.time,
		// Sent as our own declaration of who we stand with. It is never merged from what arrives -
		// accepting an ally's list would let anyone already on it add members on our behalf.
		allies: config.ALLIES,
		rooms: ownedRoomReports(),
		war: Memory.war || { target: null, phase: null },
		intel: shareableIntel(),
		requests: [...defenseRequests(), ...drainOutbox()],
		// Acknowledgements owed from messages read since we last spoke. Sending them clears the
		// debt; an ally reading its own tick back knows the request was seen, not that it was
		// obeyed - the protocol requires an answer, not compliance.
		ack: Memory.ally.pendingAck || [],
	};
}

// Newer readings win per room. An ally standing in a room right now knows more about it than our
// last visit did, and the reverse is equally true, so whichever observation is younger is kept.
function mergeIntel(message) {
	if (!message.intel) return;
	if (!Memory.rooms) Memory.rooms = {};

	for (const roomName in message.intel) {
		const incoming = message.intel[roomName];
		const known = Memory.rooms[roomName];
		const theirsIsNewer = !known || (incoming.lastSeen || message.tick) > (known.lastSeen || 0);
		if (!theirsIsNewer) continue;

		Memory.rooms[roomName] = {
			...(known || {}),
			towers: incoming.towers,
			towerEnergy: incoming.towerEnergy,
			spawns: incoming.spawns,
			lastSeen: incoming.lastSeen || message.tick,
			viaAlly: true,
		};
	}
}

function receive(message, sender) {
	if (!isSpeakingOurProtocol(message)) return;

	Memory.allyMsg = message;
	mergeIntel(message);

	const requests = message.requests || [];
	if (requests.length === 0) return;

	// Owed in our next message whether or not we can act on them. Answering is the part of the
	// protocol we control; acting depends on having rangers and a terminal, which this room does
	// not yet - so the honest response is an acknowledgement and nothing more.
	if (!Memory.ally) Memory.ally = {};
	const pending = Memory.ally.pendingAck || [];
	if (!pending.includes(message.tick)) pending.push(message.tick);
	Memory.ally.pendingAck = pending;

	for (const request of requests) {
		log(`[盟軍] ${sender} 請求 ${request.type}(${request.room || '—'}):${request.note || ''}`);
	}
}

// The segment activated this tick is only readable on the next one, so the write and the read
// always act on the previous cycle's activation. Calling setActiveSegments every cycle keeps 90
// live continuously rather than re-arming it from scratch.
function run() {
	const isCycleTick = Game.time % INTERVAL === 0;
	if (!isCycleTick) return;

	RawMemory.setActiveSegments([SEGMENT]);

	const segmentReady = RawMemory.segments[SEGMENT] !== undefined;
	if (!segmentReady) return;

	RawMemory.setPublicSegments([SEGMENT]);
	RawMemory.segments[SEGMENT] = JSON.stringify(buildMessage());

	// Sent, so the debt is settled; anything arriving below re-files its own.
	if (Memory.ally) Memory.ally.pendingAck = [];

	const foreign = RawMemory.foreignSegment;
	const fromAPartner = foreign && partners().includes(foreign.username);
	if (fromAPartner) {
		try {
			receive(JSON.parse(foreign.data), foreign.username);
		} catch (err) {
			// Their segment is theirs to get wrong - a malformed message is skipped, not fatal.
			log(`[盟軍] 無法解析 ${foreign.username} 的訊息:${err.message}`);
		}
	}

	const partner = nextPartner();
	if (partner) RawMemory.setActiveForeignSegment(partner, SEGMENT);
}

module.exports = { run, buildMessage, receive, PROTOCOL_VERSION, SEGMENT };

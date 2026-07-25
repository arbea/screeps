const config = require('./config');

function log(message) {
	if (!config.LOG_ENABLED) return;
	console.log(`[${Game.time}] ${message}`);
}

module.exports = { log };

// Catches identifiers that do not resolve - the class of bug `node -c` cannot see, because a call
// to a function that was never defined is perfectly valid syntax.
//
// It exists because renaming a variable in one place and not another put `bodyBudget(room)` into
// spawnQueue.js where the function is called `budgetFor`. Every tick, building the spawn requests
// threw a ReferenceError, the kernel caught it, and the room simply stopped spawning. Syntax
// checks passed the whole time; the population fell from nine to five before an ally noticed.
//
//   node tools/check-references.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// The game supplies these; they are not defined by any module here, so an unresolved reference to
// one of them is expected rather than a fault.
const GAME_GLOBALS = /^(Game|Memory|RawMemory|PathFinder|RoomPosition|RoomVisual|Creep|Room|Structure|Source|Store|ConstructionSite|Flag|OK|ERR_[A-Z_]+|FIND_[A-Z_]+|STRUCTURE_[A-Z_]+|RESOURCE_[A-Z_]+|TERRAIN_MASK_[A-Z_]+|LOOK_[A-Z_]+|COLOR_[A-Z_]+|BODYPART_COST|MAX_CREEP_SIZE|CARRY_CAPACITY|SOURCE_ENERGY_CAPACITY|ENERGY_REGEN_TIME|BUILD_POWER|REPAIR_POWER|UPGRADE_CONTROLLER_POWER|HARVEST_POWER|CONTROLLER_STRUCTURES|CONTROLLER_DOWNGRADE|CREEP_LIFE_TIME|WORK|CARRY|MOVE|ATTACK|RANGED_ATTACK|HEAL|CLAIM|TOUGH|TOP|BOTTOM|LEFT|RIGHT|TOP_LEFT|TOP_RIGHT|BOTTOM_LEFT|BOTTOM_RIGHT|_)$/;

// Comments and strings are stripped before anything is scanned. Without this, ordinary prose gets
// read as code the moment a word happens to sit before a bracket - "enough to afford (a body)"
// became a call to afford(). A checker that cries wolf is a checker nobody runs.
function stripNonCode(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/(^|[^:])\/\/[^\n]*/g, '$1')
		.replace(/`(?:\\[\s\S]|[^\\`])*`/g, '``')
		.replace(/'(?:\\[\s\S]|[^\\'])*'/g, "''")
		.replace(/"(?:\\[\s\S]|[^\\"])*"/g, '""');
}

function checkModule(file) {
	const source = stripNonCode(fs.readFileSync(file, 'utf8'));

	// Compiling in a context with no globals surfaces a reference the moment it is evaluated, but
	// only for code that actually runs. Static scanning is what finds the ones inside functions.
	try {
		new vm.Script(source, { filename: file });
	} catch (err) {
		return [`${path.basename(file)}: ${err.message}`];
	}

	// Every name that is called as a function, minus every name that is declared, required, or
	// supplied by the game or by a member expression.
	const declared = new Set();
	for (const match of source.matchAll(/(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*))/g)) {
		declared.add(match[1] || match[2]);
	}
	// Destructured declarations: const { a, b } = ...
	for (const match of source.matchAll(/(?:const|let|var)\s*\{([^}]*)\}/g)) {
		for (const name of match[1].split(',')) declared.add(name.trim().split(':').pop().trim());
	}
	// Parameters, loosely: anything inside a function's parentheses.
	for (const match of source.matchAll(/function\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g)) {
		for (const name of match[1].split(',')) declared.add(name.trim().split('=')[0].trim());
	}
	for (const match of source.matchAll(/\(([^)]*)\)\s*=>/g)) {
		for (const name of match[1].split(',')) declared.add(name.trim().split('=')[0].trim());
	}
	for (const match of source.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) declared.add(match[1]);
	// for (const x of ...) / catch (err)
	for (const match of source.matchAll(/(?:for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)|catch\s*\(\s*([A-Za-z_$][\w$]*))/g)) {
		declared.add(match[1] || match[2]);
	}
	// Object shorthand methods - `roomCallback(roomName) {` - are definitions, not calls, and so is
	// a prototype assignment like `Creep.prototype.moveTo = function (...)`.
	for (const match of source.matchAll(/([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g)) declared.add(match[1]);
	for (const match of source.matchAll(/\.([A-Za-z_$][\w$]*)\s*=\s*function/g)) declared.add(match[1]);

	const problems = [];
	const seen = new Set();
	for (const match of source.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
		const name = match[2];
		if (seen.has(name)) continue;
		seen.add(name);

		const isKeyword = /^(if|for|while|switch|catch|return|typeof|function|new|require|super|await|delete|void|do|else)$/.test(name);
		if (isKeyword || declared.has(name) || GAME_GLOBALS.test(name)) continue;
		if (typeof global[name] === 'function') continue;

		const line = source.slice(0, match.index).split('\n').length;
		problems.push(`${path.basename(file)}:${line}  ${name}(...) is never defined`);
	}
	return problems;
}

const files = fs
	.readdirSync(ROOT)
	.filter(name => name.endsWith('.js'))
	.map(name => path.join(ROOT, name));

let problems = [];
for (const file of files) problems = problems.concat(checkModule(file));

if (problems.length === 0) {
	console.log(`checked ${files.length} modules - every called name resolves`);
	process.exit(0);
}

for (const problem of problems) console.log(problem);
process.exit(1);

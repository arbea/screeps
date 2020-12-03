var roleWorker = require("role.worker");
var roletest = require("role.test");
var roombase = require("room.base");
Memory.rooms = Game.rooms;
module.exports.loop = function () {
  /* //tower atk
    var tower = Game.getObjectById('e81d03b9c8698f785978e824');
    if(tower) {
        var closestDamagedStructure = tower.pos.findClosestByRange(FIND_STRUCTURES, {
            filter: (structure) => structure.hits < structure.hitsMax
        });
        if(closestDamagedStructure) {
            tower.repair(closestDamagedStructure);
        }

        var closestHostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
        if(closestHostile) {
            tower.attack(closestHostile);
        }
    }
*/
  for (var name in Game.rooms) {
    var room = Game.rooms[name];
    roombase.run(room);
  }
  /*
    var targets_tadsk = Game.rooms.sim.spawns["Spawn1"].find(FIND_STRUCTURES, {
      filter: (structure) => {
        return ((structure.structureType == STRUCTURE_EXTENSION ||
          structure.structureType == STRUCTURE_SPAWN));
      },
    });
    */


  //spawn
  var test = _.filter(Game.creeps, (creep) => creep.memory.role == "test");
  var worker = _.filter(Game.creeps, (creep) => creep.memory.role == "Worker");

  if (test.length < 1) {
    Game.spawns["Spawn1"].spawnCreep([WORK, CARRY, CARRY, MOVE, MOVE], "test", {
      memory: { role: "test", mem_space: STRUCTURE_SPAWN },
    });
  } else if (worker.length < 4) {
    var newName = "Worker" + Game.time;
    //console.log("Spawning new Worker: " + newName);
    Game.spawns["Spawn1"].spawnCreep([WORK, CARRY, CARRY, MOVE, MOVE], newName, {
      memory: { role: "Worker", task: STRUCTURE_SPAWN },
    });
  }
  //screeps act
  for (var name in Game.creeps) {
    var creep = Game.creeps[name];
    if (creep.memory.role == "Worker") {
      roleWorker.run(creep);
    }
    if (creep.memory.role == "test") {
      roletest.run(creep);
    }
    //clear mem
    for (var name in Memory.creeps) {
      if (!Game.creeps[name]) {
        delete Memory.creeps[name];
        console.log("Clearing non-existing creep memory:", name);
      }
    }
  };
}
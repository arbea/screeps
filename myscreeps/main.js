var roleWorker = require("role.worker");
var roleDeffender = require("role.deffender");
var roleHealer = require("role.healer");

module.exports.loop = function () {
  /* 
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
  //spawn
  var closestHostile = Game.spawns["Spawn1"].room.find(FIND_HOSTILE_CREEPS);
  var worker = _.filter(Game.creeps, (creep) => creep.memory.role == "Worker");
  var healer = _.filter(Game.creeps, (creep) => creep.memory.role == "Healer");

  if (closestHostile.length > 0 && Game.spawns["Spawn1"].energy >= 300) {
    var newName = "Deffender" + Game.time;
    //console.log(closestHostile);
    Game.spawns["Spawn1"].spawnCreep([ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE, ATTACK, ATTACK], newName, {
      memory: { role: "Deffender" },
    });
  }
  if (worker.length < 8 && Game.spawns["Spawn1"].energy >= 300) {
    var newName = "Worker" + Game.time;
    //console.log("Spawning new Worker: " + newName);
    Game.spawns["Spawn1"].spawnCreep([WORK, WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE], newName, {
      memory: { role: "Worker", nowtask: "mine" },
    });
  }
  /*if (healer.length < 1 && Game.spawns["Spawn1"].energy >= 300) {
    var newName = "Healer" + Game.time;
    console.log("Spawning new Worker: " + newName);
    Game.spawns["Spawn1"].spawnCreep([HEAL, HEAL, HEAL, HEAL, MOVE, MOVE, MOVE, MOVE], newName, {
      memory: { role: "Healer", targetID: "null" },
    });
  }*/
  //screeps act
  for (var name in Game.creeps) {
    var creep = Game.creeps[name];

    switch (creep.memory.role) {
      case "Worker":
        roleWorker.run(creep);
        break;
      case "Deffender":
        roleDeffender.run(creep);
        break;
      case "Healer":
        roleHealer.run(creep);
        break;
    }
  }
  //clear mem
  for (var name in Memory.creeps) {
    if (!Game.creeps[name]) {
      delete Memory.creeps[name];
      //console.log("Clearing non-existing creep memory:", name);
    }
  }
};

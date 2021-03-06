var roleWorker = require("role.worker");
var roleDeffender = require("role.deffender");
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
  //spawn
  var closestHostile = Game.spawns["Spawn1"].room.find(FIND_HOSTILE_CREEPS);
  var worker = _.filter(Game.creeps, (creep) => creep.memory.role == "Worker");

  if (closestHostile.length > 0 && Game.spawns["Spawn1"].energy >= 300) {
    var newName = "Deffender" + Game.time;
    console.log(closestHostile);
    Game.spawns["Spawn1"].spawnCreep([ATTACK, MOVE, MOVE, ATTACK,], newName, {
      memory: { role: "Deffender" },
    });
  } if (worker.length < 5 && Game.spawns["Spawn1"].energy >= 300) {
    var newName = "Worker" + Game.time;
    console.log("Spawning new Worker: " + newName);
    Game.spawns["Spawn1"].spawnCreep([WORK, CARRY, CARRY, CARRY, MOVE], newName, {
      memory: { role: "Worker" },
    });
  }
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
      console.log("Clearing non-existing creep memory:", name);
    }
  }
};

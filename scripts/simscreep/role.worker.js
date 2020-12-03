var roleWorker = {
  run: function (creep) {
    if (creep.store.getFreeCapacity() > 0) {//go mine
      creep.say('mine');
      const sources = creep.pos.findClosestByPath(FIND_SOURCES);
      if (creep.harvest(sources) == ERR_NOT_IN_RANGE) {
        creep.moveTo(sources, { visualizePathStyle: { stroke: "#ffaa00" } });
      }
    } else {
      //find targets
      var targets_transfer = creep.room.find(FIND_STRUCTURES, {
        filter: (structure) => {
          return ((structure.structureType == STRUCTURE_EXTENSION ||
            structure.structureType == STRUCTURE_SPAWN) &&
            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
        },
      });
      const targets_build = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);

      //go work
      if (targets_transfer.length > 0) {
        creep.say('transfer');
        if (creep.transfer(targets_transfer[0], RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
          creep.moveTo(targets_transfer[0], {
            visualizePathStyle: { stroke: "#ffffff" },
          });
        }
      } else if (targets_build) {
        creep.say('build');
        if (creep.build(targets_build) == ERR_NOT_IN_RANGE) {
          creep.moveTo(targets_build, { visualizePathStyle: { stroke: '#ffffff' } });
        }
      } else if (creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE) {
        creep.say('upgrade');
        creep.moveTo(creep.room.controller, { visualizePathStyle: { stroke: '#ffffff' } });
      }
    }
  },//run
};

module.exports = roleWorker;

function work(pos, creep) {
  switch (creep.memory.nowtask) {
    case "mine":
      var err = creep.harvest(pos);
      break;
    case "upgradeController":
      var err = creep.upgradeController(creep.room.controller);
      break;
    case "transfer":
      var err = creep.transfer(pos, RESOURCE_ENERGY);
      break;
    case "build":
      var err = creep.build(pos);
      break;
    case "repair":
      var err = creep.repair(pos);
      break;
    default:
  }
  if (err) {
    if (err == ERR_NOT_IN_RANGE)
      creep.moveTo(pos, { visualizePathStyle: { stroke: '#ffffff' } });
    else if (err == ERR_NOT_ENOUGH_RESOURCES)
      creep.memory.nowtask = "mine";
  }
  creep.memory.err = err;
  creep.memory.pos = pos;
}
var roleWorker = {
  run: function (creep) {
    ///main work-------------
    var target;
    if (creep.memory.nowtask == "mine" && creep.store.getFreeCapacity() > 0) //go mine
      target = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    else if (creep.memory.nowtask = "null") {
      const target_transfer = creep.pos.findClosestByPath(FIND_STRUCTURES, {//
        filter: (structure) => {
          return ((structure.structureType == STRUCTURE_EXTENSION ||
            structure.structureType == STRUCTURE_SPAWN) &&
            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
        },
      });
      const target_repair = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (structure) => {
          return ((structure.structureType == STRUCTURE_ROAD ||
            structure.structureType == STRUCTURE_EXTENSION) &&
            structure.hits < 100);
        },
      });
      const target_build = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);

      var target_transfer_path = creep.pos.findPathTo(target_transfer);
      var target_repair_path = creep.pos.findPathTo(target_repair);
      var target_build_path = creep.pos.findPathTo(target_build);
      if (target_transfer_path) { creep.memory.nowtask = "transfer"; target = target_transfer; }
      if (target_transfer_path.length > target_repair_path.length) { creep.memory.nowtask = "repair"; target = target_repair; }
      if (target_repair_path.length > target_build_path.length) { creep.memory.nowtask = "build"; target = target_build; }
      if (creep.memory.nowtask == "null") { creep.memory.nowtask = "upgrade"; }
      creep.memory.target = target;
    }
    work(target, creep);
    creep.say(creep.memory.nowtask);
  },//run
};
module.exports = roleWorker;

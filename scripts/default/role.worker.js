var roleWorker = {
  run: function (creep) {
    function work(obj) {
      creep.moveTo(obj, { visualizePathStyle: { stroke: '#ffffff' } });
      switch (creep.memory.nowtask) {
        case "mine":
          var err = creep.harvest(obj);
          //creep.say("mine");
          break;
        case "upgradeController":
          var err = creep.upgradeController(obj);
          // creep.say("upgradeController");
          break;
        case "transfer":
          var err = creep.transfer(obj, RESOURCE_ENERGY);
          //creep.say("transfer");
          break;
        case "build":
          var err = creep.build(obj);
          //creep.say("build");
          break;
        case "repair":
          var err = creep.repair(obj);
          //creep.say("repair");
          break;
        default:
      }
      if (creep.memory.nowtask == "mine" && creep.store.getFreeCapacity() == 0)
        creep.memory.nowtask = "null";
      else if (creep.memory.nowtask == "repair")
        creep.memory.nowtask = "null";

      if (err && (err != ERR_NOT_IN_RANGE)) {
        //creep.say(err);
        if (err == ERR_NOT_ENOUGH_RESOURCES)          creep.memory.nowtask = "mine";
        else
          creep.memory.nowtask = "null";
      }
      //creep.memory.err = err;
      //creep.memory.pos = pos;
    }
    ///main work-------------
    var target;
    if (creep.memory.nowtask == "mine" && creep.store.getFreeCapacity() > 50) //go mine
    {

      var mineobj = Game.getObjectById("5bbcaba49099fc012e634097");
      //creep.say(PathFinder.search(creep.pos, mineobj).incomplete);
      //if ((PathFinder.search(creep.pos, mineobj).incomplete
      //  || creep.pos.isNearTo(mineobj)) && mineobj.energy > 0)
      if (mineobj.energy > 0)
        target = mineobj;
      else
        target = Game.getObjectById("5bbcaba49099fc012e634096");
      creep.memory.targetid = target.id;

    } else if (creep.memory.nowtask == "null") {
      //creep.say("gw");
      const target_transfer = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (structure) => {
          return ((structure.structureType == STRUCTURE_EXTENSION ||
            structure.structureType == STRUCTURE_SPAWN) &&
            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
        },
      });
      const target_repair = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (structure) => {
          return ((structure.structureType == STRUCTURE_ROAD ||
            structure.structureType == STRUCTURE_EXTENSION ||
            structure.structureType == STRUCTURE_CONTAINER) &&
            structure.hits < 900);
        },
      });
      const target_build = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);

      var target_transfer_path = creep.pos.findPathTo(target_transfer);
      var target_repair_path = creep.pos.findPathTo(target_repair);
      var target_build_path = creep.pos.findPathTo(target_build);

      if (target_transfer_path.length > target_repair_path.length) { creep.memory.nowtask = "repair"; target = target_repair; }
      if (target_repair_path.length > target_build_path.length) { creep.memory.nowtask = "build"; target = target_build; }
      if (creep.memory.nowtask == "null") { creep.memory.nowtask = "upgradeController"; target = creep.room.controller; }
      if (target_transfer) { creep.memory.nowtask = "transfer"; target = target_transfer; }
      if(target == null)
        Game.notify(JSON.stringify(creep.memory),60);

      Game.notify(JSON.stringify(creep.memory));
      creep.memory.targetid = target.id;
    }
    //creep.say(creep.memory.nowtask);
    work(Game.getObjectById(creep.memory.targetid));
  },//run
};
module.exports = roleWorker;

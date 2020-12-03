var roleDeffender = {
  run: function (creep) {
    creep.memory.nowtask = "ATK";
    //find targets
    var closestHostile = creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS);
    //go work
    if (closestHostile) {
      var err = creep.attack(closestHostile)
      if (err == ERR_NOT_IN_RANGE) {
        creep.moveTo(closestHostile, { visualizePathStyle: { stroke: "#ffffff" }, });
      }
    }
    creep.say(creep.memory.nowtask);
  },//run
};

module.exports = roleDeffender;

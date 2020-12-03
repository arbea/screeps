function work(targetID, creep) {
  var err;
  var tagetcreep = Game.getObjectById(targetID);
  creep.moveTo(tagetcreep.pos, { visualizePathStyle: { stroke: '#ffffff' } });
  err = creep.heal(tagetcreep);
  err = creep.rangedHeal(tagetcreep);
  if (tagetcreep.hitsMax - tagetcreep.hits < 100)
    creep.memory.targetID = "null";
  if ((err != ERR_NOT_IN_RANGE) || (tagetcreep == null))
    creep.memory.targetID = "null";
  //creep.say(err);
  //creep.memory.err = err;
  //creep.memory.tagetcreep = tagetcreep;
}

var roleHealer = {
  run: function (creep) {
    ///main work-------------
    if (creep.memory.targetID == "null") {
      //  const target = creep.pos.findClosestByPath(FIND_CREEPS, {
      //  filter: (creep) => { return (creep.hits < 1000); }
      // });
      const target = creep.pos.findClosestByPath(FIND_CREEPS);
      //console.log(target.id);
      //if (target != null)
      creep.memory.targetID = target.id;
    }
    work(creep.memory.targetID, creep);
  },//run
};
module.exports = roleHealer;

var roombase = {
    run: function (thisroom) {
        //list work to do

        //list spawns
        var targets = thisroom.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return (structure.structureType == STRUCTURE_EXTENSION
                    || ((structure.structureType == STRUCTURE_SPAWN) &&
                        structure.store.getFreeCapacity(RESOURCE_ENERGY)) > 0);
            }
        });
        if (targets.length > 0) {
            thisroom.memory.task.transfer = targets.pos;
        }
        //delete Memory.creeps[name];
        //room.memory.task = { "transfer", };

    },//run
};

module.exports = roombase;

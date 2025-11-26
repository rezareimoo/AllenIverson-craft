/**
 * Place block task handler
 */

const { Vec3 } = require("vec3");
const { completeCurrentTask, failTask } = require("../utils/queue");

/**
 * Handles the 'place' task - places a block from inventory
 * @param {Object} bot - The mineflayer bot instance
 * @param {Array} taskQueue - The task queue array
 * @param {Object} task - { type: 'place', target: string }
 */
async function handlePlace(bot, taskQueue, task) {
  const { target } = task;

  try {
    // Find the item in inventory
    const item = bot.inventory.items().find((i) => i.name === target);

    if (!item) {
      failTask(bot, taskQueue, `I don't have any ${target} in my inventory.`);
      return;
    }

    // Equip the block
    await bot.equip(item, "hand");

    // Find a suitable reference block nearby to place against
    // Look for solid blocks at the bot's feet level
    const botPos = bot.entity.position.floored();
    const searchOffsets = [
      new Vec3(1, -1, 0),
      new Vec3(-1, -1, 0),
      new Vec3(0, -1, 1),
      new Vec3(0, -1, -1),
      new Vec3(1, 0, 0),
      new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1),
      new Vec3(0, 0, -1),
    ];

    let referenceBlock = null;
    let faceVector = null;

    for (const offset of searchOffsets) {
      const checkPos = botPos.plus(offset);
      const block = bot.blockAt(checkPos);

      if (block && block.boundingBox === "block") {
        referenceBlock = block;
        // Calculate the face vector (opposite of offset, pointing up for ground blocks)
        if (offset.y === -1) {
          faceVector = new Vec3(0, 1, 0); // Place on top
        } else {
          faceVector = offset.scaled(-1); // Place against the side
        }
        break;
      }
    }

    if (!referenceBlock) {
      failTask(bot, taskQueue, `I can't find a good spot to place ${target}.`);
      return;
    }

    bot.chat(`Placing ${target}...`);

    // Place the block
    await bot.placeBlock(referenceBlock, faceVector);

    completeCurrentTask(bot, taskQueue, `Placed ${target}!`);
  } catch (error) {
    console.error("[Body] Place error:", error.message);
    failTask(bot, taskQueue, `Failed to place ${target}: ${error.message}`);
  }
}

module.exports = {
  handlePlace,
};


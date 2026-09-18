/**
 * Give / toss items to a player
 */

const { GoalNear } = require("mineflayer-pathfinder").goals;
const { completeCurrentTask, failTask, assertNotCancelled } = require("../utils/queue");
const { getInventoryCount } = require("../utils/inventory");
const {
  validateAndCorrectName,
  getSuggestions,
} = require("../utils/blockNames");

/**
 * @param {Object} bot
 * @param {Object} mcData
 * @param {Array} taskQueue
 * @param {Object} task - { type: 'give', target, count, player }
 * @param {number} cancelGen
 */
async function handleGive(bot, mcData, taskQueue, task, cancelGen) {
  let { target, count = 1, player } = task;

  try {
    assertNotCancelled(cancelGen);

    if (mcData) {
      const validation = validateAndCorrectName(target, mcData);
      if (!validation.valid) {
        const suggestions = getSuggestions(target, mcData);
        const suggestionMsg =
          suggestions.length > 0
            ? ` Did you mean: ${suggestions.join(", ")}?`
            : "";
        failTask(
          bot,
          taskQueue,
          `I don't know what "${target}" is.${suggestionMsg}`
        );
        return;
      }
      if (validation.corrected !== target) {
        target = validation.corrected;
      }
    }

    if (!player) {
      failTask(bot, taskQueue, "I don't know who to give items to.");
      return;
    }

    const have = getInventoryCount(bot, target);
    if (have < count) {
      failTask(
        bot,
        taskQueue,
        `I only have ${have} ${target}, need ${count}.`
      );
      return;
    }

    // Path to player (retry briefly if out of view)
    let targetPlayer = bot.players[player];
    if (!targetPlayer?.entity) {
      bot.chat(`Looking for ${player}...`);
      for (let i = 0; i < 5; i++) {
        assertNotCancelled(cancelGen);
        await sleep(500);
        targetPlayer = bot.players[player];
        if (targetPlayer?.entity) break;
      }
    }

    if (!targetPlayer?.entity) {
      failTask(bot, taskQueue, `I can't see ${player} to deliver items.`);
      return;
    }

    bot.chat(`Bringing ${count} ${target} to ${player}...`);
    const pos = targetPlayer.entity.position;
    await bot.pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, 2));
    assertNotCancelled(cancelGen);

    // Re-check player still nearby
    targetPlayer = bot.players[player];
    if (!targetPlayer?.entity) {
      failTask(bot, taskQueue, `${player} moved out of range.`);
      return;
    }

    // Toss items toward player
    let remaining = count;
    while (remaining > 0) {
      assertNotCancelled(cancelGen);
      const item = bot.inventory.items().find((i) => i.name === target);
      if (!item) break;

      const tossCount = Math.min(remaining, item.count);
      await bot.toss(item.type, null, tossCount);
      remaining -= tossCount;
      await sleep(200);
    }

    const given = count - remaining;
    if (given > 0) {
      completeCurrentTask(
        bot,
        taskQueue,
        `Gave ${given} ${target} to ${player}!`
      );
    } else {
      failTask(bot, taskQueue, `Couldn't toss ${target}.`);
    }
  } catch (error) {
    if (error.cancelled) {
      console.log("[Give] Cancelled");
      return;
    }
    console.error("[Give] Error:", error.message);
    failTask(bot, taskQueue, `Failed to give items: ${error.message}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  handleGive,
};

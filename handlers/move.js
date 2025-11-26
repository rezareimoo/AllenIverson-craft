/**
 * Movement task handler
 */

const { GoalNear } = require("mineflayer-pathfinder").goals;
const { completeCurrentTask, failTask } = require("../utils/queue");

/**
 * Handles the 'move' task - navigates to coordinates or a player
 * @param {Object} bot - The mineflayer bot instance
 * @param {Array} taskQueue - The task queue array
 * @param {Object} task - { type: 'move', x?, y?, z?, player? }
 */
async function handleMove(bot, taskQueue, task) {
  try {
    let goal;

    if (task.player) {
      // Move to a player
      const targetPlayer = bot.players[task.player];
      if (!targetPlayer || !targetPlayer.entity) {
        failTask(bot, taskQueue, `I can't see player "${task.player}".`);
        return;
      }
      const pos = targetPlayer.entity.position;
      goal = new GoalNear(pos.x, pos.y, pos.z, 2);
      bot.chat(`Moving to ${task.player}...`);
    } else if (
      task.x !== undefined &&
      task.y !== undefined &&
      task.z !== undefined
    ) {
      // Move to coordinates
      goal = new GoalNear(task.x, task.y, task.z, 2);
      bot.chat(`Moving to (${task.x}, ${task.y}, ${task.z})...`);
    } else {
      failTask(bot, taskQueue, "Invalid move command - need coordinates or player name.");
      return;
    }

    // Start pathfinding
    await bot.pathfinder.goto(goal);

    completeCurrentTask(bot, taskQueue, "I've arrived!");
  } catch (error) {
    // Check if it was interrupted (not a real error)
    if (error.message && error.message.includes("interrupted")) {
      console.log("[Body] Move was interrupted");
      // Don't fail task on interrupt, queue was already cleared
    } else {
      console.error("[Body] Move error:", error.message);
      failTask(bot, taskQueue, `I couldn't get there: ${error.message}`);
    }
  }
}

module.exports = {
  handleMove,
};


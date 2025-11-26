/**
 * Follow task handler
 */

const { GoalFollow } = require("mineflayer-pathfinder").goals;
const { failTask } = require("../utils/queue");

/**
 * Handles the 'follow' task - continuously follows a player
 * Note: This task remains active until interrupted by a new command
 * @param {Object} bot - The mineflayer bot instance
 * @param {Array} taskQueue - The task queue array
 * @param {Object} task - { type: 'follow', player: string }
 */
async function handleFollow(bot, taskQueue, task) {
  try {
    const targetPlayer = bot.players[task.player];
    if (!targetPlayer || !targetPlayer.entity) {
      failTask(bot, taskQueue, `I can't see player "${task.player}".`);
      return;
    }

    // Set up continuous following using GoalFollow
    const goal = new GoalFollow(targetPlayer.entity, 3); // Stay 3 blocks away
    bot.pathfinder.setGoal(goal, true); // dynamic = true for continuous following
    bot.chat(`Following ${task.player}!`);

    // Note: Follow task stays in queue - it's continuous until interrupted
    // We don't call completeCurrentTask() here
  } catch (error) {
    console.error("[Body] Follow error:", error.message);
    failTask(bot, taskQueue, `I couldn't follow: ${error.message}`);
  }
}

module.exports = {
  handleFollow,
};


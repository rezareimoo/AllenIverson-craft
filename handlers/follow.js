/**
 * Follow task handler — sets follow MODE once (not re-dispatched every tick)
 */

const { GoalFollow } = require("mineflayer-pathfinder").goals;
const { failTask } = require("../utils/queue");
const { botState } = require("../state/botState");

/**
 * Activates continuous follow mode and removes the follow task from the queue.
 */
async function handleFollow(bot, taskQueue, task) {
  try {
    const targetPlayer = bot.players[task.player];
    if (!targetPlayer || !targetPlayer.entity) {
      failTask(bot, taskQueue, `I can't see player "${task.player}".`);
      return;
    }

    const goal = new GoalFollow(targetPlayer.entity, 3);
    bot.pathfinder.setGoal(goal, true);
    botState.setMode("follow");
    botState.clearGoal();

    // Remove follow task from queue — mode keeps following until interrupt
    taskQueue.shift();
    botState.notifyQueueUpdated();

    bot.chat(`Following ${task.player}!`);
  } catch (error) {
    console.error("[Follow] Error:", error.message);
    failTask(bot, taskQueue, `I couldn't follow: ${error.message}`);
  }
}

module.exports = {
  handleFollow,
};

/**
 * Stop task handler
 */

const { abandonAll } = require("../utils/queue");
const { botState } = require("../state/botState");

function handleStop(bot, taskQueue) {
  try {
    bot.pathfinder.setGoal(null);
    bot.pathfinder.stop();
  } catch (e) {}

  botState.setMode("idle");
  abandonAll(bot, taskQueue, "Stopping!");
}

function handleUnknown(bot, taskQueue, task) {
  abandonAll(
    bot,
    taskQueue,
    task.reason || "I don't understand that command."
  );
}

module.exports = {
  handleStop,
  handleUnknown,
};

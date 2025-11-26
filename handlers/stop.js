/**
 * Stop task handler
 */

/**
 * Handles the 'stop' task - immediately stops all movement and clears the queue
 * @param {Object} bot - The mineflayer bot instance
 * @param {Array} taskQueue - The task queue array (will be cleared)
 */
function handleStop(bot, taskQueue) {
  bot.pathfinder.stop();
  bot.chat("Stopping!");
  taskQueue.length = 0; // Clear entire queue on stop
}

/**
 * Handles unknown commands from the LLM
 * @param {Object} bot - The mineflayer bot instance
 * @param {Array} taskQueue - The task queue array (will be cleared)
 * @param {Object} task - { type: 'unknown', reason: string }
 */
function handleUnknown(bot, taskQueue, task) {
  bot.chat(task.reason || "I don't understand that command.");
  taskQueue.length = 0; // Clear queue on unknown command
}

module.exports = {
  handleStop,
  handleUnknown,
};


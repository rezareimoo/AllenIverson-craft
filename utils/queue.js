/**
 * Queue management utilities
 */

/**
 * Completes the current task and moves to the next one in the queue.
 * @param {Object} bot - The mineflayer bot instance
 * @param {Array} taskQueue - The task queue array
 * @param {string} message - Optional completion message to chat
 */
function completeCurrentTask(bot, taskQueue, message = null) {
  if (message) {
    bot.chat(message);
  }
  taskQueue.shift(); // Remove completed task from front of queue

  if (taskQueue.length > 0) {
    console.log(`[Queue] ${taskQueue.length} tasks remaining`);
  } else {
    console.log("[Queue] All tasks completed!");
    bot.chat("All done!");
  }
}

/**
 * Fails the current task and clears the entire queue.
 * @param {Object} bot - The mineflayer bot instance
 * @param {Array} taskQueue - The task queue array (will be cleared)
 * @param {string} message - Error message to chat
 */
function failTask(bot, taskQueue, message) {
  bot.chat(message);
  taskQueue.length = 0; // Clear the entire queue on failure
  console.log("[Queue] Task failed, queue cleared");
}

module.exports = {
  completeCurrentTask,
  failTask,
};

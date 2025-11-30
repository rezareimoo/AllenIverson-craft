/**
 * Queue management utilities
 * Uses shared botState for event emission
 */

const { botState } = require("../state/botState");

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
  
  const completedTask = taskQueue.shift(); // Remove completed task from front of queue
  
  // Sync with botState and emit event
  botState.setQueue(taskQueue);
  if (completedTask) {
    botState.emit("task:completed", { task: completedTask });
  }

  if (taskQueue.length > 0) {
    console.log(`[Queue] ${taskQueue.length} tasks remaining`);
  } else {
    console.log("[Queue] All tasks completed!");
    bot.chat("All done!");
  }
  
  // Emit inventory update after task completion
  botState.emitInventoryUpdate();
}

/**
 * Fails the current task and clears the entire queue.
 * @param {Object} bot - The mineflayer bot instance
 * @param {Array} taskQueue - The task queue array (will be cleared)
 * @param {string} message - Error message to chat
 */
function failTask(bot, taskQueue, message) {
  bot.chat(message);
  const failedTask = taskQueue[0];
  taskQueue.length = 0; // Clear the entire queue on failure
  
  // Sync with botState and emit event
  botState.setQueue(taskQueue);
  botState.emit("task:failed", { task: failedTask, message });
  
  console.log("[Queue] Task failed, queue cleared");
}

/**
 * Adds a task to the queue
 * @param {Array} taskQueue - The task queue array
 * @param {Object} task - The task to add
 */
function addTask(taskQueue, task) {
  taskQueue.push(task);
  botState.setQueue(taskQueue);
}

/**
 * Adds multiple tasks to the queue
 * @param {Array} taskQueue - The task queue array
 * @param {Array} tasks - Array of tasks to add
 */
function addTasks(taskQueue, tasks) {
  taskQueue.push(...tasks);
  botState.setQueue(taskQueue);
}

/**
 * Inserts tasks at the front of the queue
 * @param {Array} taskQueue - The task queue array
 * @param {Array} tasks - Array of tasks to insert
 */
function insertTasksAtFront(taskQueue, tasks) {
  for (let i = tasks.length - 1; i >= 0; i--) {
    taskQueue.unshift(tasks[i]);
  }
  botState.setQueue(taskQueue);
}

/**
 * Removes a task at a specific index
 * @param {Array} taskQueue - The task queue array
 * @param {number} index - Index of task to remove
 * @returns {Object|null} The removed task or null
 */
function removeTaskAtIndex(taskQueue, index) {
  if (index >= 0 && index < taskQueue.length) {
    const removed = taskQueue.splice(index, 1)[0];
    botState.setQueue(taskQueue);
    return removed;
  }
  return null;
}

/**
 * Clears the entire queue
 * @param {Array} taskQueue - The task queue array
 */
function clearQueue(taskQueue) {
  taskQueue.length = 0;
  botState.setQueue(taskQueue);
}

/**
 * Syncs the taskQueue with botState (call after direct modifications)
 * @param {Array} taskQueue - The task queue array
 */
function syncQueue(taskQueue) {
  botState.setQueue(taskQueue);
}

module.exports = {
  completeCurrentTask,
  failTask,
  addTask,
  addTasks,
  insertTasksAtFront,
  removeTaskAtIndex,
  clearQueue,
  syncQueue,
};

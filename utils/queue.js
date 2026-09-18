/**
 * Queue management utilities
 * Uses shared botState for the authoritative queue and event emission.
 */

const { botState } = require("../state/botState");

/**
 * Completes the current task and moves to the next one in the queue.
 * @param {Object} bot - The mineflayer bot instance
 * @param {Array} taskQueue - The task queue array (must be botState.getQueueRef())
 * @param {string} message - Optional completion message to chat
 */
function completeCurrentTask(bot, taskQueue, message = null) {
  if (message) {
    bot.chat(message);
  }

  const completedTask = taskQueue.shift();
  botState.resetStepRetries();
  botState.notifyQueueUpdated();

  if (completedTask) {
    botState.emit("task:completed", { task: completedTask });
  }

  if (taskQueue.length > 0) {
    console.log(`[Queue] ${taskQueue.length} tasks remaining`);
  } else {
    console.log("[Queue] All tasks completed!");
    bot.chat("All done!");
    botState.clearGoal();
    if (botState.getMode() !== "follow") {
      botState.setMode("idle");
    }
  }

  botState.emitInventoryUpdate();
}

/**
 * Fails the current step. Retries a few times, then clears remaining plan
 * and emits failure so the supervisor can replan from the current goal.
 *
 * @returns {'retried'|'replanned'|'abandoned'}
 */
function failTask(bot, taskQueue, message, options = {}) {
  const { fatal = false } = options;
  const failedTask = taskQueue[0] || null;

  botState.pushFailure(message, failedTask);
  bot.chat(message);

  if (!fatal) {
    const retries = botState.incrementStepRetries();
    if (retries <= botState.getMaxStepRetries()) {
      console.log(
        `[Queue] Step failed (retry ${retries}/${botState.getMaxStepRetries()}): ${message}`
      );
      botState.emit("task:failed", {
        task: failedTask,
        message,
        retrying: true,
        retries,
      });
      botState.notifyQueueUpdated();
      return "retried";
    }
  }

  console.log(`[Queue] Task failed, abandoning current plan: ${message}`);
  taskQueue.length = 0;
  botState.resetStepRetries();
  botState.notifyQueueUpdated();
  botState.emit("task:failed", {
    task: failedTask,
    message,
    retrying: false,
    needsReplan: !!botState.getCurrentGoal(),
  });

  return botState.getCurrentGoal() ? "replanned" : "abandoned";
}

/**
 * Hard-fail: clear queue and goal immediately (used for stop / unknown).
 */
function abandonAll(bot, taskQueue, message) {
  if (message) bot.chat(message);
  const failedTask = taskQueue[0] || null;
  if (message) botState.pushFailure(message, failedTask);
  taskQueue.length = 0;
  botState.resetStepRetries();
  botState.clearGoal();
  botState.setMode("idle");
  botState.notifyQueueUpdated();
  if (failedTask && message) {
    botState.emit("task:failed", {
      task: failedTask,
      message,
      retrying: false,
    });
  }
}

function addTask(taskQueue, task) {
  taskQueue.push(task);
  botState.notifyQueueUpdated();
}

function addTasks(taskQueue, tasks) {
  taskQueue.push(...tasks);
  botState.notifyQueueUpdated();
}

function insertTasksAtFront(taskQueue, tasks) {
  for (let i = tasks.length - 1; i >= 0; i--) {
    taskQueue.unshift(tasks[i]);
  }
  botState.notifyQueueUpdated();
}

function removeTaskAtIndex(taskQueue, index) {
  if (index >= 0 && index < taskQueue.length) {
    const removed = taskQueue.splice(index, 1)[0];
    botState.notifyQueueUpdated();
    return removed;
  }
  return null;
}

function clearQueue(taskQueue) {
  taskQueue.length = 0;
  botState.resetStepRetries();
  botState.notifyQueueUpdated();
}

function syncQueue(taskQueue) {
  botState.notifyQueueUpdated();
}

function assertNotCancelled(generation) {
  if (botState.isCancelled(generation)) {
    const err = new Error("CANCELLED");
    err.cancelled = true;
    throw err;
  }
}

module.exports = {
  completeCurrentTask,
  failTask,
  abandonAll,
  addTask,
  addTasks,
  insertTasksAtFront,
  removeTaskAtIndex,
  clearQueue,
  syncQueue,
  assertNotCancelled,
};

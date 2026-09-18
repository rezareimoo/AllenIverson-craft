/**
 * Shared bot state module with event emission for real-time UI updates
 * Owns the authoritative task queue (mutate in place — never reassign).
 */

const EventEmitter = require("events");

class BotState extends EventEmitter {
  constructor() {
    super();
    /** @type {Array} Authoritative queue — always mutate in place */
    this._taskQueue = [];
    this._isExecuting = false;
    this._botInstance = null;
    this._mcData = null;
    this._isConnected = false;
    /** @type {'idle'|'follow'|'working'|'farming'} */
    this._mode = "idle";
    /** @type {Object|null} High-level goal being pursued */
    this._currentGoal = null;
    /** Incremented on every interrupt/cancel so in-flight handlers can abort */
    this._cancelGeneration = 0;
    /** Retry count for the current step */
    this._stepRetries = 0;
    this._maxStepRetries = 2;
    /** How many times we've re-expanded the current goal */
    this._goalReplans = 0;
    this._maxGoalReplans = 2;
    /** Recent failure messages for UI */
    this._failureHistory = [];
  }

  // Bot instance management
  setBot(bot) {
    this._botInstance = bot;
    this.emit("bot:updated");
  }

  getBot() {
    return this._botInstance;
  }

  setMcData(mcData) {
    this._mcData = mcData;
    this.emit("mcdata:updated");
  }

  getMcData() {
    return this._mcData;
  }

  setConnected(isConnected) {
    this._isConnected = isConnected;
    this.emit("bot:status", { connected: isConnected });
  }

  isConnected() {
    return this._isConnected;
  }

  /**
   * Returns the live queue array reference. Handlers must mutate this array
   * in place — never reassign the caller's variable to a new array.
   */
  getQueueRef() {
    return this._taskQueue;
  }

  getQueue() {
    return [...this._taskQueue];
  }

  /**
   * Sync snapshot to listeners after in-place mutations.
   */
  notifyQueueUpdated() {
    this.emit("queue:updated", this.getQueueState());
  }

  setQueue(queue) {
    this._taskQueue.length = 0;
    if (queue && queue.length) {
      this._taskQueue.push(...queue);
    }
    this.notifyQueueUpdated();
  }

  replaceQueue(tasks) {
    this._taskQueue.length = 0;
    if (tasks && tasks.length) {
      this._taskQueue.push(...tasks);
    }
    this._stepRetries = 0;
    this.notifyQueueUpdated();
  }

  addTask(task) {
    this._taskQueue.push(task);
    this.notifyQueueUpdated();
    this.emit("task:added", { task, index: this._taskQueue.length - 1 });
  }

  addTasks(tasks) {
    this._taskQueue.push(...tasks);
    this.notifyQueueUpdated();
  }

  insertTasksAtFront(tasks) {
    this._taskQueue.unshift(...tasks);
    this.notifyQueueUpdated();
  }

  removeTask(index) {
    if (index >= 0 && index < this._taskQueue.length) {
      const removed = this._taskQueue.splice(index, 1)[0];
      this.notifyQueueUpdated();
      this.emit("task:removed", { task: removed, index });
      return removed;
    }
    return null;
  }

  clearQueue() {
    const previousQueue = [...this._taskQueue];
    this._taskQueue.length = 0;
    this._stepRetries = 0;
    this.notifyQueueUpdated();
    this.emit("queue:cleared", { previousQueue });
  }

  getCurrentTask() {
    return this._taskQueue.length > 0 ? this._taskQueue[0] : null;
  }

  shiftTask() {
    const task = this._taskQueue.shift();
    if (task) {
      this._stepRetries = 0;
      this.notifyQueueUpdated();
      this.emit("task:completed", { task });
    }
    return task;
  }

  // Cancellation
  cancel() {
    this._cancelGeneration += 1;
    this._mode = "idle";
    this._isExecuting = false;
    this.clearQueue();
    this.emit("execution:cancelled", {
      generation: this._cancelGeneration,
    });
    return this._cancelGeneration;
  }

  getCancelGeneration() {
    return this._cancelGeneration;
  }

  isCancelled(generation) {
    return generation !== this._cancelGeneration;
  }

  // Mode (follow is a mode, not a re-dispatched task)
  setMode(mode) {
    this._mode = mode;
    this.emit("mode:changed", { mode });
  }

  getMode() {
    return this._mode;
  }

  // Goal tracking
  setCurrentGoal(goal) {
    this._currentGoal = goal;
    this._goalReplans = 0;
    this.emit("goal:updated", { goal });
  }

  getCurrentGoal() {
    return this._currentGoal;
  }

  clearGoal() {
    this._currentGoal = null;
    this._goalReplans = 0;
    this.emit("goal:updated", { goal: null });
  }

  incrementGoalReplans() {
    this._goalReplans += 1;
    return this._goalReplans;
  }

  getGoalReplans() {
    return this._goalReplans;
  }

  getMaxGoalReplans() {
    return this._maxGoalReplans;
  }

  // Step retries
  getStepRetries() {
    return this._stepRetries;
  }

  incrementStepRetries() {
    this._stepRetries += 1;
    return this._stepRetries;
  }

  resetStepRetries() {
    this._stepRetries = 0;
  }

  getMaxStepRetries() {
    return this._maxStepRetries;
  }

  // Failure history
  pushFailure(message, task = null) {
    this._failureHistory.unshift({
      message,
      task,
      at: Date.now(),
    });
    if (this._failureHistory.length > 20) {
      this._failureHistory.length = 20;
    }
    this.emit("failure:added", this._failureHistory[0]);
  }

  getFailureHistory() {
    return [...this._failureHistory];
  }

  // Execution state
  setExecuting(isExecuting) {
    const wasExecuting = this._isExecuting;
    this._isExecuting = isExecuting;

    if (isExecuting && !wasExecuting && this._taskQueue.length > 0) {
      this.emit("task:started", { task: this._taskQueue[0] });
    }

    this.emit("execution:changed", { isExecuting });
  }

  isExecuting() {
    return this._isExecuting;
  }

  failCurrentTask(message) {
    const task = this._taskQueue[0];
    this.pushFailure(message, task);
    this.clearQueue();
    this.clearGoal();
    this.setMode("idle");
    this.emit("task:failed", { task, message });
  }

  getInventory() {
    if (!this._botInstance) return [];

    return this._botInstance.inventory.items().map((item) => ({
      name: item.name,
      count: item.count,
      displayName: item.displayName,
      slot: item.slot,
    }));
  }

  getInventoryMap() {
    const map = {};
    for (const item of this.getInventory()) {
      map[item.name] = (map[item.name] || 0) + item.count;
    }
    return map;
  }

  emitInventoryUpdate() {
    this.emit("inventory:updated", this.getInventory());
  }

  getQueueState() {
    return {
      queue: this.getQueue(),
      isExecuting: this._isExecuting,
      currentTask: this.getCurrentTask(),
      queueLength: this._taskQueue.length,
      mode: this._mode,
      currentGoal: this._currentGoal,
      failureHistory: this.getFailureHistory().slice(0, 5),
    };
  }

  getFullState() {
    return {
      ...this.getQueueState(),
      inventory: this.getInventory(),
      connected: this._isConnected,
    };
  }
}

const botState = new BotState();

module.exports = {
  botState,
  BotState,
};

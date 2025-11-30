/**
 * Shared bot state module with event emission for real-time UI updates
 * Uses EventEmitter to notify when state changes
 */

const EventEmitter = require("events");

class BotState extends EventEmitter {
  constructor() {
    super();
    this._taskQueue = [];
    this._isExecuting = false;
    this._botInstance = null;
    this._mcData = null;
    this._isConnected = false;
  }

  // Bot instance management
  setBot(bot) {
    this._botInstance = bot;
    this.emit("bot:updated");
  }

  getBot() {
    return this._botInstance;
  }

  // Minecraft data management
  setMcData(mcData) {
    this._mcData = mcData;
    this.emit("mcdata:updated");
  }

  getMcData() {
    return this._mcData;
  }

  // Connection status
  setConnected(isConnected) {
    this._isConnected = isConnected;
    this.emit("bot:status", { connected: isConnected });
  }

  isConnected() {
    return this._isConnected;
  }

  // Task queue management with event emission
  getQueue() {
    return [...this._taskQueue];
  }

  setQueue(queue) {
    this._taskQueue = [...queue];
    this.emit("queue:updated", this.getQueueState());
  }

  addTask(task) {
    this._taskQueue.push(task);
    this.emit("queue:updated", this.getQueueState());
    this.emit("task:added", { task, index: this._taskQueue.length - 1 });
  }

  addTasks(tasks) {
    this._taskQueue.push(...tasks);
    this.emit("queue:updated", this.getQueueState());
  }

  insertTasksAtFront(tasks) {
    this._taskQueue.unshift(...tasks);
    this.emit("queue:updated", this.getQueueState());
  }

  removeTask(index) {
    if (index >= 0 && index < this._taskQueue.length) {
      const removed = this._taskQueue.splice(index, 1)[0];
      this.emit("queue:updated", this.getQueueState());
      this.emit("task:removed", { task: removed, index });
      return removed;
    }
    return null;
  }

  clearQueue() {
    const previousQueue = [...this._taskQueue];
    this._taskQueue = [];
    this.emit("queue:updated", this.getQueueState());
    this.emit("queue:cleared", { previousQueue });
  }

  getCurrentTask() {
    return this._taskQueue.length > 0 ? this._taskQueue[0] : null;
  }

  shiftTask() {
    const task = this._taskQueue.shift();
    if (task) {
      this.emit("queue:updated", this.getQueueState());
      this.emit("task:completed", { task });
    }
    return task;
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

  // Task failure handling
  failCurrentTask(message) {
    const task = this._taskQueue[0];
    this.clearQueue();
    this.emit("task:failed", { task, message });
  }

  // Get inventory from bot
  getInventory() {
    if (!this._botInstance) return [];
    
    return this._botInstance.inventory.items().map((item) => ({
      name: item.name,
      count: item.count,
      displayName: item.displayName,
      slot: item.slot,
    }));
  }

  // Emit inventory update (call this when inventory changes)
  emitInventoryUpdate() {
    this.emit("inventory:updated", this.getInventory());
  }

  // Get complete state for API responses
  getQueueState() {
    return {
      queue: this.getQueue(),
      isExecuting: this._isExecuting,
      currentTask: this.getCurrentTask(),
      queueLength: this._taskQueue.length,
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

// Singleton instance
const botState = new BotState();

module.exports = {
  botState,
  BotState,
};


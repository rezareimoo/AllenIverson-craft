// allenIverson.js - Minecraft AI Agent with LLM Integration
// A robust, interruptible bot using mineflayer + Ollama
// Supports multi-step task queues, crafting, and block placement

require("dotenv").config();
const mineflayer = require("mineflayer");
const { pathfinder, Movements } = require("mineflayer-pathfinder");
const collectBlock = require("mineflayer-collectblock").plugin;

// Import modular components
const { processUserRequest } = require("./brain");
const { handleCollect } = require("./handlers/collect");
const { handleCraft } = require("./handlers/craft");
const { handlePlace } = require("./handlers/place");
const { handleMove } = require("./handlers/move");
const { handleFollow } = require("./handlers/follow");
const { handleInventory } = require("./handlers/inventory");
const { handleStop, handleUnknown } = require("./handlers/stop");

// ============================================================================
// GLOBAL STATE - TASK QUEUE SYSTEM
// ============================================================================
// taskQueue holds an array of task objects to execute in sequence
// Each task is a JSON object like: { type: 'collect', target: 'oak_log', count: 5 }
// When queue is empty, the bot is IDLE
let taskQueue = [];

// Global minecraft-data reference (initialized on spawn)
let mcData = null;

// Flag to prevent overlapping task executions
let isExecuting = false;

// ============================================================================
// BOT INITIALIZATION
// ============================================================================
const bot = mineflayer.createBot({
  host: process.env.MC_HOST || "localhost",
  port: parseInt(process.env.MC_PORT) || 25565,
  username: process.env.BOT_USERNAME || "AllenIverson",
  version: false, // Auto-detect Minecraft version
});

// Load plugins
bot.loadPlugin(pathfinder);
bot.loadPlugin(collectBlock);

// ============================================================================
// THE "BODY" - SUPERVISION LOOP
// ============================================================================

/**
 * Main supervision loop that checks and executes tasks from the queue.
 * Runs every second to manage task execution sequentially.
 */
function supervisionLoop() {
  // If no tasks or already executing, skip
  if (taskQueue.length === 0 || isExecuting) {
    return;
  }

  // Get the current task (front of queue)
  const currentTask = taskQueue[0];

  // Mark as executing to prevent overlapping calls
  isExecuting = true;

  console.log(`[Supervisor] Executing task: ${JSON.stringify(currentTask)}`);

  // Dispatch to appropriate handler based on task type
  (async () => {
    try {
      switch (currentTask.type) {
        case "collect":
          await handleCollect(bot, mcData, taskQueue, currentTask);
          break;
        case "craft":
          await handleCraft(bot, mcData, taskQueue, currentTask);
          break;
        case "place":
          await handlePlace(bot, taskQueue, currentTask, mcData);
          break;
        case "move":
          await handleMove(bot, taskQueue, currentTask);
          break;
        case "follow":
          // Follow is continuous, handled differently
          await handleFollow(bot, taskQueue, currentTask);
          // Don't complete - follow stays active until interrupted
          break;
        case "inventory":
          handleInventory(bot, taskQueue, currentTask);
          break;
        case "stop":
          handleStop(bot, taskQueue);
          break;
        case "unknown":
          handleUnknown(bot, taskQueue, currentTask);
          break;
        default:
          console.log(`[Supervisor] Unknown task type: ${currentTask.type}`);
          taskQueue.shift(); // Remove unknown task
      }
    } catch (error) {
      console.error("[Supervisor] Execution error:", error.message);
      const { failTask } = require("./utils/queue");
      failTask(bot, taskQueue, `Task failed: ${error.message}`);
    } finally {
      isExecuting = false;
    }
  })();
}

// ============================================================================
// BOT EVENT HANDLERS
// ============================================================================

// Spawn event - initialize minecraft-data and start supervision loop
bot.on("spawn", () => {
  console.log("[Bot] AllenIverson has spawned!");

  // Initialize minecraft-data for the detected version
  mcData = require("minecraft-data")(bot.version);
  console.log(`[Bot] Minecraft version: ${bot.version}`);

  // Configure pathfinder movements
  const defaultMove = new Movements(bot, mcData);
  defaultMove.allow1by1towers = false;
  defaultMove.scafoldingCost = 6.0;
  defaultMove.allowSprinting = true;
  defaultMove.canDig = true;
  defaultMove.canBuild = true;
  bot.pathfinder.setMovements(defaultMove);

  // Increase pathfinder timeout for complex paths (default is 5 seconds)
  bot.pathfinder.thinkTimeout = 10000; // 10 seconds

  // Start the supervision loop (check every 1 second)
  setInterval(supervisionLoop, 1000);

  bot.chat("AllenIverson is ready! Tell me what to do.");
});

// Chat event - process user commands with interrupt capability
bot.on("chat", async (username, message) => {
  // Ignore own messages
  if (username === bot.username) return;

  // Only process messages that start with "Allen" (case-insensitive)
  const normalizedMessage = message.trim();
  if (!normalizedMessage.toLowerCase().startsWith("allen")) {
    return; // Ignore messages that don't start with "Allen"
  }

  // Extract the actual command (remove "Allen" prefix)
  const command = normalizedMessage.substring(5).trim(); // Remove "Allen" (5 chars)
  if (!command) {
    return; // Ignore if there's no command after "Allen"
  }

  console.log(`[Chat] ${username}: ${message} (command: "${command}")`);

  // INTERRUPT: Stop any current action immediately
  try {
    bot.pathfinder.stop();
  } catch (e) {
    // Pathfinder might not be active, that's okay
  }

  // Clear the entire task queue (interrupt current plan)
  taskQueue = [];
  isExecuting = false;

  // Process the new request through the LLM
  bot.chat("Planning...");
  const newTasks = await processUserRequest(command, mcData);

  if (newTasks && newTasks.length > 0) {
    console.log(
      `[Chat] New task queue (${newTasks.length} tasks):`,
      JSON.stringify(newTasks)
    );
    taskQueue = newTasks;

    if (newTasks.length > 1) {
      bot.chat(`Got it! I have ${newTasks.length} steps to complete.`);
    }
  } else {
    bot.chat("Sorry, I couldn't understand that command.");
  }
});

// Error handling
bot.on("error", (err) => {
  console.error("[Bot] Error:", err.message);
});

bot.on("kicked", (reason) => {
  console.log("[Bot] Kicked:", reason);
});

bot.on("end", () => {
  console.log("[Bot] Disconnected from server");
});

// Log when bot is ready to connect
console.log("[Bot] Starting AllenIverson...");
console.log(
  `[Bot] Connecting to ${process.env.MC_HOST || "localhost"}:${
    process.env.MC_PORT || 25565
  }`
);

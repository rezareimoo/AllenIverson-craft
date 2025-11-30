// allenIverson.js - Minecraft AI Agent with LLM Integration
// A robust, interruptible bot using mineflayer + Ollama
// Supports multi-step task queues, crafting, and block placement
// Now with Web UI via Express + Socket.io

require("dotenv").config();
const mineflayer = require("mineflayer");
const { pathfinder, Movements } = require("mineflayer-pathfinder");
const collectBlock = require("mineflayer-collectblock").plugin;
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");

// Import modular components
const { processUserRequest } = require("./brain");
const { handleCollect } = require("./handlers/collect");
const { handleCraft } = require("./handlers/craft");
const { handlePlace } = require("./handlers/place");
const { handleMove } = require("./handlers/move");
const { handleFollow } = require("./handlers/follow");
const { handleInventory } = require("./handlers/inventory");
const { handleStop, handleUnknown } = require("./handlers/stop");
const { botState } = require("./state/botState");
const { syncQueue, removeTaskAtIndex, clearQueue } = require("./utils/queue");
const { getCollectibleBlocks } = require("./utils/blockNames");
const {
  getCommonCraftableItems,
  getRecipeIngredients,
  getRecipes,
  requiresCraftingTable,
} = require("./utils/recipes");

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
// EXPRESS + SOCKET.IO SERVER SETUP
// ============================================================================
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ["http://localhost:5173", "http://localhost:3001"],
    methods: ["GET", "POST", "DELETE"],
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from React build
app.use(express.static(path.join(__dirname, "ui/dist")));

// ============================================================================
// API ROUTES
// ============================================================================

// Get current queue state
app.get("/api/queue", (req, res) => {
  res.json({
    queue: taskQueue,
    isExecuting,
    currentTask: taskQueue.length > 0 ? taskQueue[0] : null,
    queueLength: taskQueue.length,
  });
});

// Add task(s) to queue
app.post("/api/queue", (req, res) => {
  const { tasks } = req.body;

  if (!tasks || !Array.isArray(tasks)) {
    return res.status(400).json({ error: "Tasks must be an array" });
  }

  // Validate tasks
  for (const task of tasks) {
    if (!task.type) {
      return res.status(400).json({ error: "Each task must have a type" });
    }
  }

  taskQueue.push(...tasks);
  syncQueue(taskQueue);

  console.log(`[API] Added ${tasks.length} task(s) to queue`);
  io.emit("queue:updated", { queue: taskQueue, isExecuting });

  res.json({ success: true, queue: taskQueue });
});

// Remove task at index
app.delete("/api/queue/:index", (req, res) => {
  const index = parseInt(req.params.index, 10);

  if (isNaN(index) || index < 0 || index >= taskQueue.length) {
    return res.status(400).json({ error: "Invalid index" });
  }

  // Don't allow removing currently executing task
  if (index === 0 && isExecuting) {
    return res
      .status(400)
      .json({ error: "Cannot remove currently executing task" });
  }

  const removed = removeTaskAtIndex(taskQueue, index);
  console.log(`[API] Removed task at index ${index}:`, removed);
  io.emit("queue:updated", { queue: taskQueue, isExecuting });

  res.json({ success: true, removed, queue: taskQueue });
});

// Clear entire queue
app.delete("/api/queue", (req, res) => {
  // Stop any current pathfinding
  try {
    if (bot && bot.pathfinder) {
      bot.pathfinder.stop();
    }
  } catch (e) {
    // Pathfinder might not be active
  }

  clearQueue(taskQueue);
  isExecuting = false;

  console.log("[API] Queue cleared");
  io.emit("queue:updated", { queue: taskQueue, isExecuting });

  res.json({ success: true, queue: [] });
});

// Get current inventory
app.get("/api/inventory", (req, res) => {
  if (!bot) {
    return res.status(503).json({ error: "Bot not connected" });
  }

  const inventory = bot.inventory.items().map((item) => ({
    name: item.name,
    count: item.count,
    displayName: item.displayName,
    slot: item.slot,
  }));

  res.json({ inventory });
});

// Get bot status
app.get("/api/status", (req, res) => {
  res.json({
    connected: bot && bot.entity !== undefined,
    version: bot ? bot.version : null,
    position:
      bot && bot.entity
        ? {
            x: bot.entity.position.x,
            y: bot.entity.position.y,
            z: bot.entity.position.z,
          }
        : null,
    health: bot ? bot.health : null,
    food: bot ? bot.food : null,
    isExecuting,
    currentTask: taskQueue.length > 0 ? taskQueue[0] : null,
    queueLength: taskQueue.length,
  });
});

// Get list of collectible blocks
app.get("/api/blocks", (req, res) => {
  if (!mcData) {
    return res.status(503).json({ error: "Minecraft data not loaded" });
  }

  const blocks = getCollectibleBlocks(mcData);
  res.json({ blocks });
});

// Get list of craftable items with recipes
app.get("/api/items", (req, res) => {
  if (!mcData) {
    return res.status(503).json({ error: "Minecraft data not loaded" });
  }

  const items = getCommonCraftableItems(mcData, 200);
  res.json({ items });
});

// Get all items (for place/move tasks)
app.get("/api/all-items", (req, res) => {
  if (!mcData) {
    return res.status(503).json({ error: "Minecraft data not loaded" });
  }

  const items = Object.keys(mcData.itemsByName);
  const blocks = Object.keys(mcData.blocksByName);

  res.json({ items, blocks });
});

// Get recipe details for a specific item
app.get("/api/recipe/:itemName", (req, res) => {
  if (!mcData) {
    return res.status(503).json({ error: "Minecraft data not loaded" });
  }

  const { itemName } = req.params;
  const recipes = getRecipes(itemName, mcData);

  if (!recipes || recipes.length === 0) {
    return res.status(404).json({ error: `No recipe found for ${itemName}` });
  }

  const recipe = recipes[0];
  const ingredients = getRecipeIngredients(recipe, mcData);
  const needsTable = requiresCraftingTable(recipe);

  res.json({
    itemName,
    ingredients,
    requiresTable: needsTable,
    outputCount: recipe.result?.count || 1,
  });
});

// Get online players
app.get("/api/players", (req, res) => {
  if (!bot) {
    return res.status(503).json({ error: "Bot not connected" });
  }

  const players = Object.keys(bot.players)
    .filter((name) => name !== bot.username)
    .map((name) => ({
      name,
      entity: bot.players[name].entity !== undefined,
    }));

  res.json({ players });
});

// Serve React app for all other routes
app.get("*", (req, res) => {
  const indexPath = path.join(__dirname, "ui/dist/index.html");
  const fs = require("fs");

  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>AllenIverson Bot - Setup Required</title>
          <style>
            body { font-family: monospace; background: #1D1D1D; color: #fff; padding: 40px; }
            h1 { color: #5D8731; }
            code { background: #333; padding: 4px 8px; border-radius: 4px; }
            .step { margin: 20px 0; padding: 15px; background: #2D2D2D; border-left: 4px solid #5D8731; }
          </style>
        </head>
        <body>
          <h1>AllenIverson Bot UI</h1>
          <p>The UI hasn't been built yet. Choose one option:</p>
          
          <div class="step">
            <h3>Option 1: Development Mode (Recommended)</h3>
            <p>Run in a separate terminal:</p>
            <code>cd ui && npm install && npm run dev</code>
            <p>Then visit: <a href="http://localhost:5173" style="color:#5D8731">http://localhost:5173</a></p>
          </div>
          
          <div class="step">
            <h3>Option 2: Build for Production</h3>
            <code>cd ui && npm install && npm run build</code>
            <p>Then refresh this page.</p>
          </div>
          
          <p style="margin-top: 30px; color: #888;">API is running at <a href="/api/status" style="color:#5D8731">/api/status</a></p>
        </body>
      </html>
    `);
  }
});

// ============================================================================
// SOCKET.IO CONNECTION HANDLING
// ============================================================================
io.on("connection", (socket) => {
  console.log("[Socket] Client connected:", socket.id);

  // Send initial state
  socket.emit("bot:status", {
    connected: bot && bot.entity !== undefined,
    version: bot ? bot.version : null,
  });

  socket.emit("queue:updated", {
    queue: taskQueue,
    isExecuting,
    currentTask: taskQueue.length > 0 ? taskQueue[0] : null,
  });

  if (bot) {
    socket.emit(
      "inventory:updated",
      bot.inventory.items().map((item) => ({
        name: item.name,
        count: item.count,
        displayName: item.displayName,
      }))
    );
  }

  socket.on("disconnect", () => {
    console.log("[Socket] Client disconnected:", socket.id);
  });
});

// Forward botState events to Socket.io
botState.on("queue:updated", (data) => {
  io.emit("queue:updated", data);
});

botState.on("task:started", (data) => {
  io.emit("task:started", data);
});

botState.on("task:completed", (data) => {
  io.emit("task:completed", data);
});

botState.on("task:failed", (data) => {
  io.emit("task:failed", data);
});

botState.on("inventory:updated", (data) => {
  io.emit("inventory:updated", data);
});

// ============================================================================
// BOT INITIALIZATION
// ============================================================================
const bot = mineflayer.createBot({
  host: process.env.MC_HOST || "localhost",
  port: parseInt(process.env.MC_PORT) || 25565,
  username: process.env.BOT_USERNAME || "AllenIverson",
  version: false, // Auto-detect Minecraft version
});

// Store bot reference in botState
botState.setBot(bot);

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
  botState.setExecuting(true);

  console.log(`[Supervisor] Executing task: ${JSON.stringify(currentTask)}`);
  io.emit("task:started", { task: currentTask });

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
          syncQueue(taskQueue);
      }
    } catch (error) {
      console.error("[Supervisor] Execution error:", error.message);
      const { failTask } = require("./utils/queue");
      failTask(bot, taskQueue, `Task failed: ${error.message}`);
    } finally {
      isExecuting = false;
      botState.setExecuting(false);
      // Emit inventory update after each task
      io.emit(
        "inventory:updated",
        bot.inventory.items().map((item) => ({
          name: item.name,
          count: item.count,
          displayName: item.displayName,
        }))
      );
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
  botState.setMcData(mcData);
  botState.setConnected(true);
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

  // Notify connected clients
  io.emit("bot:status", { connected: true, version: bot.version });
  io.emit(
    "inventory:updated",
    bot.inventory.items().map((item) => ({
      name: item.name,
      count: item.count,
      displayName: item.displayName,
    }))
  );

  // Inventory change event (must be inside spawn as inventory isn't available before)
  bot.inventory.on("updateSlot", () => {
    io.emit(
      "inventory:updated",
      bot.inventory.items().map((item) => ({
        name: item.name,
        count: item.count,
        displayName: item.displayName,
      }))
    );
  });
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
  syncQueue(taskQueue);

  // Process the new request through the LLM
  bot.chat("Planning...");
  const newTasks = await processUserRequest(command, mcData);

  if (newTasks && newTasks.length > 0) {
    console.log(
      `[Chat] New task queue (${newTasks.length} tasks):`,
      JSON.stringify(newTasks)
    );
    taskQueue = newTasks;
    syncQueue(taskQueue);

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
  io.emit("bot:status", { connected: false, error: err.message });
});

bot.on("kicked", (reason) => {
  console.log("[Bot] Kicked:", reason);
  botState.setConnected(false);
  io.emit("bot:status", { connected: false, reason });
});

bot.on("end", () => {
  console.log("[Bot] Disconnected from server");
  botState.setConnected(false);
  io.emit("bot:status", { connected: false });
});

// ============================================================================
// START SERVERS
// ============================================================================
const UI_PORT = process.env.UI_PORT || 3001;

httpServer.listen(UI_PORT, () => {
  console.log(`[Server] Web UI available at http://localhost:${UI_PORT}`);
});

// Log when bot is ready to connect
console.log("[Bot] Starting AllenIverson...");
console.log(
  `[Bot] Connecting to ${process.env.MC_HOST || "localhost"}:${
    process.env.MC_PORT || 25565
  }`
);

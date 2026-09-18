// allenIverson.js - Minecraft gathering companion
// Intent → Goal → Deterministic plan → TaskController

require("dotenv").config();
const mineflayer = require("mineflayer");
const { pathfinder, Movements } = require("mineflayer-pathfinder");
const collectBlock = require("mineflayer-collectblock").plugin;
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");

const { processUserRequest } = require("./brain");
const { expandGoal } = require("./planner/expandGoal");
const { handleCollect } = require("./handlers/collect");
const { handleCraft } = require("./handlers/craft");
const { handlePlace } = require("./handlers/place");
const { handleMove } = require("./handlers/move");
const { handleFollow } = require("./handlers/follow");
const { handleInventory } = require("./handlers/inventory");
const { handleStop, handleUnknown } = require("./handlers/stop");
const { handleSmelt } = require("./handlers/smelt");
const { handleGive } = require("./handlers/give");
const { botState } = require("./state/botState");
const {
  syncQueue,
  removeTaskAtIndex,
  clearQueue,
  failTask,
} = require("./utils/queue");
const { getCollectibleBlocks } = require("./utils/blockNames");
const {
  getCommonCraftableItems,
  getRecipeIngredients,
  getRecipes,
  requiresCraftingTable,
} = require("./utils/recipes");

// Authoritative queue — always mutate in place via this reference
const taskQueue = botState.getQueueRef();

let mcData = null;
let supervisionTimer = null;
let inventoryHooked = false;

// ============================================================================
// EXPRESS + SOCKET.IO
// ============================================================================
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: true, // Allow LAN dashboard access
    methods: ["GET", "POST", "DELETE"],
  },
});

app.use(cors({ origin: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "ui/dist")));

function emitQueue() {
  io.emit("queue:updated", botState.getQueueState());
}

app.get("/api/queue", (req, res) => {
  res.json(botState.getQueueState());
});

app.post("/api/queue", (req, res) => {
  const { tasks } = req.body;
  if (!tasks || !Array.isArray(tasks)) {
    return res.status(400).json({ error: "Tasks must be an array" });
  }
  for (const task of tasks) {
    if (!task.type) {
      return res.status(400).json({ error: "Each task must have a type" });
    }
  }
  taskQueue.push(...tasks);
  botState.setMode("working");
  syncQueue(taskQueue);
  console.log(`[API] Added ${tasks.length} task(s) to queue`);
  emitQueue();
  res.json({ success: true, queue: botState.getQueue() });
});

app.delete("/api/queue/:index", (req, res) => {
  const index = parseInt(req.params.index, 10);
  if (isNaN(index) || index < 0 || index >= taskQueue.length) {
    return res.status(400).json({ error: "Invalid index" });
  }
  if (index === 0 && botState.isExecuting()) {
    return res
      .status(400)
      .json({ error: "Cannot remove currently executing task" });
  }
  const removed = removeTaskAtIndex(taskQueue, index);
  emitQueue();
  res.json({ success: true, removed, queue: botState.getQueue() });
});

app.delete("/api/queue", (req, res) => {
  interruptBot("Queue cleared");
  res.json({ success: true, queue: [] });
});

app.get("/api/inventory", (req, res) => {
  if (!bot) return res.status(503).json({ error: "Bot not connected" });
  res.json({ inventory: botState.getInventory() });
});

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
    isExecuting: botState.isExecuting(),
    mode: botState.getMode(),
    currentGoal: botState.getCurrentGoal(),
    currentTask: botState.getCurrentTask(),
    queueLength: taskQueue.length,
    failureHistory: botState.getFailureHistory().slice(0, 5),
  });
});

app.get("/api/goal", (req, res) => {
  res.json({
    goal: botState.getCurrentGoal(),
    mode: botState.getMode(),
    failureHistory: botState.getFailureHistory().slice(0, 10),
  });
});

app.get("/api/blocks", (req, res) => {
  if (!mcData) return res.status(503).json({ error: "Minecraft data not loaded" });
  res.json({ blocks: getCollectibleBlocks(mcData) });
});

app.get("/api/items", (req, res) => {
  if (!mcData) return res.status(503).json({ error: "Minecraft data not loaded" });
  res.json({ items: getCommonCraftableItems(mcData, 200) });
});

app.get("/api/all-items", (req, res) => {
  if (!mcData) return res.status(503).json({ error: "Minecraft data not loaded" });
  res.json({
    items: Object.keys(mcData.itemsByName),
    blocks: Object.keys(mcData.blocksByName),
  });
});

app.get("/api/recipe/:itemName", (req, res) => {
  if (!mcData) return res.status(503).json({ error: "Minecraft data not loaded" });
  const { itemName } = req.params;
  const recipes = getRecipes(itemName, mcData);
  if (!recipes || recipes.length === 0) {
    return res.status(404).json({ error: `No recipe found for ${itemName}` });
  }
  const recipe = recipes[0];
  res.json({
    itemName,
    ingredients: getRecipeIngredients(recipe, mcData),
    requiresTable: requiresCraftingTable(recipe),
    outputCount: recipe.result?.count || 1,
  });
});

app.get("/api/players", (req, res) => {
  if (!bot) return res.status(503).json({ error: "Bot not connected" });
  const players = Object.keys(bot.players)
    .filter((name) => name !== bot.username)
    .map((name) => ({
      name,
      entity: bot.players[name].entity !== undefined,
      position: bot.players[name].entity
        ? {
            x: bot.players[name].entity.position.x,
            y: bot.players[name].entity.position.y,
            z: bot.players[name].entity.position.z,
          }
        : null,
    }));
  res.json({ players });
});

app.get("*", (req, res) => {
  const indexPath = path.join(__dirname, "ui/dist/index.html");
  const fs = require("fs");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).send(`
      <!DOCTYPE html><html><head><title>AllenIverson Bot</title>
      <style>body{font-family:monospace;background:#1D1D1D;color:#fff;padding:40px}
      h1{color:#5D8731}code{background:#333;padding:4px 8px;border-radius:4px}</style>
      </head><body>
      <h1>AllenIverson Bot UI</h1>
      <p>Build the UI: <code>cd ui && npm install && npm run build</code></p>
      <p>Or dev: <code>cd ui && npm run dev</code> → http://localhost:5173</p>
      <p>API: <a href="/api/status" style="color:#5D8731">/api/status</a></p>
      </body></html>`);
  }
});

io.on("connection", (socket) => {
  console.log("[Socket] Client connected:", socket.id);
  socket.emit("bot:status", {
    connected: bot && bot.entity !== undefined,
    version: bot ? bot.version : null,
    mode: botState.getMode(),
    currentGoal: botState.getCurrentGoal(),
  });
  socket.emit("queue:updated", botState.getQueueState());
  if (bot) {
    socket.emit("inventory:updated", botState.getInventory());
  }
  socket.on("disconnect", () => {
    console.log("[Socket] Client disconnected:", socket.id);
  });
});

botState.on("queue:updated", (data) => io.emit("queue:updated", data));
botState.on("task:started", (data) => io.emit("task:started", data));
botState.on("task:completed", (data) => io.emit("task:completed", data));
botState.on("task:failed", (data) => io.emit("task:failed", data));
botState.on("inventory:updated", (data) => io.emit("inventory:updated", data));
botState.on("goal:updated", (data) => io.emit("goal:updated", data));
botState.on("mode:changed", (data) => io.emit("mode:changed", data));
botState.on("bot:status", (data) => io.emit("bot:status", data));

// ============================================================================
// BOT
// ============================================================================
const bot = mineflayer.createBot({
  host: process.env.MC_HOST || "localhost",
  port: parseInt(process.env.MC_PORT) || 25565,
  username: process.env.BOT_USERNAME || "AllenIverson",
  version: false,
});

botState.setBot(bot);
bot.loadPlugin(pathfinder);
bot.loadPlugin(collectBlock);

/**
 * Stop pathfinder, bump cancel generation, clear queue in place.
 */
function interruptBot(reason) {
  try {
    if (bot.pathfinder) {
      bot.pathfinder.setGoal(null);
      bot.pathfinder.stop();
    }
  } catch (e) {}

  botState.cancel(); // increments generation, clears queue, mode idle
  botState.setExecuting(false);
  console.log(`[Interrupt] ${reason || "interrupted"}`);
  emitQueue();
}

/**
 * Re-expand the current goal from live inventory after a hard step failure.
 */
function tryReplan(reason) {
  const goal = botState.getCurrentGoal();
  if (!goal || !mcData) {
    botState.clearGoal();
    botState.setMode("idle");
    return false;
  }

  const replans = botState.incrementGoalReplans();
  if (replans > botState.getMaxGoalReplans()) {
    bot.chat(`I gave up after ${botState.getMaxGoalReplans()} replans: ${reason}`);
    botState.clearGoal();
    botState.setMode("idle");
    return false;
  }

  console.log(`[Replan] Attempt ${replans}: ${reason}`);
  const expanded = expandGoal(goal, {
    mcData,
    inventoryMap: botState.getInventoryMap(),
    speaker: goal.player || goal._speaker,
  });

  if (!expanded.ok || !expanded.tasks.length) {
    bot.chat(`I couldn't finish: ${expanded.reason || reason}`);
    botState.clearGoal();
    botState.setMode("idle");
    return false;
  }

  botState.replaceQueue(expanded.tasks);
  botState.setMode("working");
  bot.chat(`Retrying plan (${expanded.tasks.length} steps)...`);
  return true;
}

function supervisionLoop() {
  // Follow mode: do not dispatch queue tasks until interrupted
  if (botState.getMode() === "follow") {
    return;
  }

  if (taskQueue.length === 0 || botState.isExecuting()) {
    return;
  }

  const currentTask = taskQueue[0];
  const cancelGen = botState.getCancelGeneration();

  botState.setExecuting(true);
  botState.setMode("working");
  console.log(`[Supervisor] Executing: ${JSON.stringify(currentTask)}`);
  io.emit("task:started", { task: currentTask });

  (async () => {
    try {
      switch (currentTask.type) {
        case "collect":
          await handleCollect(bot, mcData, taskQueue, currentTask, cancelGen);
          break;
        case "craft":
          await handleCraft(bot, mcData, taskQueue, currentTask, cancelGen);
          break;
        case "smelt":
          await handleSmelt(bot, mcData, taskQueue, currentTask, cancelGen);
          break;
        case "place":
          await handlePlace(bot, taskQueue, currentTask, mcData, cancelGen);
          break;
        case "move":
          await handleMove(bot, taskQueue, currentTask, cancelGen);
          break;
        case "give":
          await handleGive(bot, mcData, taskQueue, currentTask, cancelGen);
          break;
        case "follow":
          await handleFollow(bot, taskQueue, currentTask);
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
          taskQueue.shift();
          syncQueue(taskQueue);
      }

      // If queue emptied due to failure with needsReplan, try once
      if (
        taskQueue.length === 0 &&
        botState.getCurrentGoal() &&
        botState.getMode() !== "follow"
      ) {
        // Check if last failure requested replan (goal still set, queue empty, not success)
        const failures = botState.getFailureHistory();
        if (failures.length > 0 && Date.now() - failures[0].at < 5000) {
          tryReplan(failures[0].message);
        }
      }
    } catch (error) {
      if (error.cancelled) {
        console.log("[Supervisor] Task cancelled");
        return;
      }
      console.error("[Supervisor] Execution error:", error.message);
      const result = failTask(bot, taskQueue, `Task failed: ${error.message}`);
      if (result === "replanned" || result === "abandoned") {
        if (botState.getCurrentGoal()) tryReplan(error.message);
      }
    } finally {
      if (!botState.isCancelled(cancelGen)) {
        botState.setExecuting(false);
        if (botState.getMode() !== "follow" && taskQueue.length === 0) {
          if (!botState.getCurrentGoal()) botState.setMode("idle");
        }
      }
      io.emit("inventory:updated", botState.getInventory());
    }
  })();
}

/**
 * Strip wake-word prefix: "Allen", "Allen,", "hey Allen", bot username, etc.
 */
function extractCommand(message, botUsername) {
  let text = message.trim();
  const lower = text.toLowerCase();
  const username = (botUsername || "AllenIverson").toLowerCase();

  // "hey allen ..." / "ok allen ..."
  text = text.replace(/^(hey|ok|okay|yo|hi)\s+/i, "").trim();

  if (lower.startsWith(username)) {
    return text.slice(botUsername.length).replace(/^[,:\s]+/, "").trim();
  }
  if (lower.startsWith("alleniverson")) {
    return text.slice(12).replace(/^[,:\s]+/, "").trim();
  }
  if (lower.startsWith("allen")) {
    return text.slice(5).replace(/^[,:\s]+/, "").trim();
  }
  return null;
}

bot.on("spawn", () => {
  console.log("[Bot] AllenIverson has spawned!");

  mcData = require("minecraft-data")(bot.version);
  botState.setMcData(mcData);
  botState.setConnected(true);
  console.log(`[Bot] Minecraft version: ${bot.version}`);

  const defaultMove = new Movements(bot, mcData);
  defaultMove.allow1by1towers = false;
  defaultMove.scafoldingCost = 6.0;
  defaultMove.allowSprinting = true;
  defaultMove.canDig = true;
  defaultMove.canBuild = true;
  bot.pathfinder.setMovements(defaultMove);
  bot.pathfinder.thinkTimeout = 10000;

  // Only one supervision timer across respawns
  if (supervisionTimer) clearInterval(supervisionTimer);
  supervisionTimer = setInterval(supervisionLoop, 1000);

  bot.chat("AllenIverson is ready! Tell me what to gather.");

  io.emit("bot:status", {
    connected: true,
    version: bot.version,
    mode: botState.getMode(),
  });
  io.emit("inventory:updated", botState.getInventory());

  if (!inventoryHooked && bot.inventory) {
    inventoryHooked = true;
    bot.inventory.on("updateSlot", () => {
      io.emit("inventory:updated", botState.getInventory());
    });
  }
});

bot.on("chat", async (username, message) => {
  if (username === bot.username) return;

  const command = extractCommand(message, bot.username);
  if (command === null) return;
  if (!command) return;

  console.log(`[Chat] ${username}: ${message} → "${command}"`);

  interruptBot("New chat command");

  bot.chat("On it...");
  const result = await processUserRequest(command, mcData, {
    speaker: username,
  });

  // Ignore if a newer interrupt happened while planning
  // (cancel gen already bumped; just don't load stale plan if another command came)

  if (!result.tasks || result.tasks.length === 0) {
    bot.chat(result.reason || "Sorry, I couldn't understand that.");
    if (result.reason && result.source === "none") {
      // hint already in reason
    }
    return;
  }

  const goal = result.goal || null;
  if (goal) {
    goal._speaker = username;
    botState.setCurrentGoal(goal);
  }

  botState.replaceQueue(result.tasks);
  botState.setMode(result.tasks[0]?.type === "follow" ? "working" : "working");

  if (result.message) {
    bot.chat(result.message);
  } else if (result.tasks.length > 1) {
    bot.chat(`Got it — ${result.tasks.length} steps.`);
  }

  console.log(
    `[Chat] Goal=${JSON.stringify(goal)} source=${result.source} tasks=${result.tasks.length}`
  );
  emitQueue();
});

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

const UI_PORT = process.env.UI_PORT || 3001;
httpServer.listen(UI_PORT, () => {
  console.log(`[Server] Web UI available at http://localhost:${UI_PORT}`);
});

console.log("[Bot] Starting AllenIverson...");
console.log(
  `[Bot] Connecting to ${process.env.MC_HOST || "localhost"}:${
    process.env.MC_PORT || 25565
  }`
);

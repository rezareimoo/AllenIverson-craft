// allenIverson.js - Minecraft AI Agent with LLM Integration
// A robust, interruptible bot using mineflayer + OpenAI
// Supports multi-step task queues, crafting, and block placement

require("dotenv").config();
const mineflayer = require("mineflayer");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
const { GoalNear, GoalFollow, GoalBlock } = goals;
const collectBlock = require("mineflayer-collectblock").plugin;
const { OpenAI } = require("openai");
const { Vec3 } = require("vec3");

// ============================================================================
// GLOBAL STATE - TASK QUEUE SYSTEM
// ============================================================================
// taskQueue holds an array of task objects to execute in sequence
// Each task is a JSON object like: { type: 'collect', target: 'oak_log', count: 5 }
// When queue is empty, the bot is IDLE
// Example queue for "make a wooden pickaxe":
//   [
//     { type: 'collect', target: 'oak_log', count: 3 },
//     { type: 'craft', target: 'oak_planks', count: 12 },
//     { type: 'craft', target: 'stick', count: 2 },
//     { type: 'craft', target: 'wooden_pickaxe', count: 1 }
//   ]
let taskQueue = [];

// Global minecraft-data reference (initialized on spawn)
let mcData = null;

// Flag to prevent overlapping task executions
let isExecuting = false;

// ============================================================================
// OPENAI CLIENT INITIALIZATION
// ============================================================================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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

// Load plugins
bot.loadPlugin(pathfinder);
bot.loadPlugin(collectBlock);

// ============================================================================
// THE "BRAIN" - LLM MULTI-STEP PLANNER
// ============================================================================

/**
 * Processes a user's natural language request using OpenAI
 * and converts it into an ARRAY of structured JSON tasks for multi-step execution.
 *
 * @param {string} message - The user's chat message
 * @returns {Promise<Array|null>} - An array of task objects or null if invalid
 */
async function processUserRequest(message) {
  const systemPrompt = `You are a Minecraft assistant controlling a bot. Translate user commands into a JSON ARRAY of task steps.

IMPORTANT: Always output a JSON ARRAY, even for single tasks. Each task object must have a 'type' field.

Available task types:
- 'collect': Gather blocks/items from the world
- 'craft': Craft items (bot will handle crafting table automatically)
- 'place': Place a block from inventory
- 'move': Navigate to coordinates or a player
- 'follow': Continuously follow a player
- 'stop': Stop all actions and clear the queue

TASK FORMATS:

For 'collect' type:
{ "type": "collect", "target": "<block_name>", "count": <number> }
Block names: oak_log, birch_log, spruce_log, diamond_ore, iron_ore, coal_ore, cobblestone, dirt, sand, etc.

For 'craft' type:
{ "type": "craft", "target": "<item_name>", "count": <number> }
Item names: oak_planks, birch_planks, stick, crafting_table, wooden_pickaxe, stone_pickaxe, iron_pickaxe, diamond_pickaxe, wooden_sword, chest, furnace, torch, etc.

For 'place' type:
{ "type": "place", "target": "<block_name>" }

For 'move' type with coordinates:
{ "type": "move", "x": <number>, "y": <number>, "z": <number> }

For 'move' type to a player:
{ "type": "move", "player": "<player_name>" }

For 'follow' type:
{ "type": "follow", "player": "<player_name>" }

For 'stop' type:
{ "type": "stop" }

CRAFTING RECIPES (use these exact item names):
- oak_planks: requires 1 oak_log (makes 4)
- birch_planks: requires 1 birch_log (makes 4)
- spruce_planks: requires 1 spruce_log (makes 4)
- stick: requires 2 planks (makes 4)
- crafting_table: requires 4 planks
- wooden_pickaxe: requires 3 planks + 2 sticks (needs crafting_table)
- wooden_sword: requires 2 planks + 1 stick (needs crafting_table)
- wooden_axe: requires 3 planks + 2 sticks (needs crafting_table)
- stone_pickaxe: requires 3 cobblestone + 2 sticks (needs crafting_table)
- iron_pickaxe: requires 3 iron_ingot + 2 sticks (needs crafting_table)
- diamond_pickaxe: requires 3 diamond + 2 sticks (needs crafting_table)
- furnace: requires 8 cobblestone (needs crafting_table)
- chest: requires 8 planks (needs crafting_table)
- torch: requires 1 coal + 1 stick (makes 4)

MULTI-STEP PLANNING:
For complex requests, break them into sequential steps. The bot executes tasks in order.

Example: User says "make me a wooden pickaxe"
Output:
[
  { "type": "collect", "target": "oak_log", "count": 2 },
  { "type": "craft", "target": "oak_planks", "count": 8 },
  { "type": "craft", "target": "stick", "count": 4 },
  { "type": "craft", "target": "crafting_table", "count": 1 },
  { "type": "place", "target": "crafting_table" },
  { "type": "craft", "target": "wooden_pickaxe", "count": 1 }
]

Example: User says "come to me" (assuming user is Steve)
Output:
[
  { "type": "move", "player": "Steve" }
]

Example: User says "stop"
Output:
[
  { "type": "stop" }
]

Output ONLY valid JSON array. No explanations, no markdown, just the JSON array.
If the command doesn't make sense, output: [{ "type": "unknown", "reason": "<brief explanation>" }]`;

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      temperature: 0.1, // Low temperature for consistent JSON output
      max_tokens: 800, // Increased for multi-step plans
    });

    const content = response.choices[0].message.content.trim();
    console.log(`[Brain] LLM Response: ${content}`);

    // Parse the JSON response
    let taskArray = JSON.parse(content);

    // Ensure it's always an array
    if (!Array.isArray(taskArray)) {
      taskArray = [taskArray];
    }

    // Validate that each task has a type field
    for (const task of taskArray) {
      if (!task.type) {
        console.error("[Brain] Invalid task in response: missing 'type' field");
        return null;
      }
    }

    return taskArray;
  } catch (error) {
    console.error("[Brain] Error processing request:", error.message);
    bot.chat("Sorry, I couldn't understand that command.");
    return null;
  }
}

// ============================================================================
// THE "BODY" - TASK HANDLER FUNCTIONS
// ============================================================================

/**
 * Completes the current task and moves to the next one in the queue.
 * @param {string} message - Optional completion message to chat
 */
function completeCurrentTask(message = null) {
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
 * @param {string} message - Error message to chat
 */
function failTask(message) {
  bot.chat(message);
  taskQueue = []; // Clear the entire queue on failure
  console.log("[Queue] Task failed, queue cleared");
}

/**
 * Maps items to the blocks that need to be mined to obtain them.
 * Some items (like cobblestone) don't exist as blocks - you get them by mining other blocks.
 */
const ITEM_TO_BLOCK_SOURCE = {
  // Stone drops cobblestone when mined (without silk touch)
  cobblestone: "stone",
  // Ores drop items
  diamond: "diamond_ore",
  coal: "coal_ore",
  emerald: "emerald_ore",
  lapis_lazuli: "lapis_ore",
  redstone: "redstone_ore",
  raw_iron: "iron_ore",
  raw_gold: "gold_ore",
  raw_copper: "copper_ore",
  // Deepslate variants
  deepslate_cobblestone: "deepslate",
  // Nether
  quartz: "nether_quartz_ore",
  gold_nugget: "nether_gold_ore",
  // Gravel drops flint sometimes
  flint: "gravel",
  // Glowstone drops dust
  glowstone_dust: "glowstone",
};

/**
 * Handles the 'collect' task - finds and gathers blocks
 * Uses progressive distance search and collects one block at a time to avoid pathfinding timeouts
 * @param {Object} task - { type: 'collect', target: string, count: number }
 */
async function handleCollect(task) {
  const { target, count = 1 } = task;

  console.log(`[Collect] === Starting collect task ===`);
  console.log(`[Collect] Target: ${target}, Count: ${count}`);

  try {
    // Check if this item needs to be obtained by mining a different block
    const actualBlockToMine = ITEM_TO_BLOCK_SOURCE[target] || target;
    if (actualBlockToMine !== target) {
      console.log(
        `[Collect] Item "${target}" is obtained by mining "${actualBlockToMine}"`
      );
    }

    // Find the block type in minecraft-data
    const blockType = mcData.blocksByName[actualBlockToMine];
    if (!blockType) {
      console.log(
        `[Collect] ERROR: Block type "${actualBlockToMine}" not found in mcData`
      );
      console.log(
        `[Collect] Available similar blocks:`,
        Object.keys(mcData.blocksByName)
          .filter((name) => name.includes(actualBlockToMine.split("_")[0]))
          .slice(0, 10)
      );
      failTask(`I don't know what "${target}" is.`);
      return;
    }
    console.log(
      `[Collect] Block type found: ${blockType.name} (ID: ${blockType.id})`
    );

    // Log bot position
    const botPos = bot.entity.position;
    console.log(
      `[Collect] Bot position: x=${botPos.x.toFixed(1)}, y=${botPos.y.toFixed(
        1
      )}, z=${botPos.z.toFixed(1)}`
    );

    // Find nearby blocks - start with closer range to avoid pathfinding timeouts
    // Try progressively larger distances if nothing found nearby
    let blocks = [];
    const distances = [16, 32, 48, 64];

    for (const maxDist of distances) {
      console.log(`[Collect] Searching within ${maxDist} blocks...`);
      blocks = bot.findBlocks({
        matching: blockType.id,
        maxDistance: maxDist,
        count: count,
      });

      if (blocks.length > 0) {
        console.log(
          `[Collect] Found ${blocks.length} ${target} within ${maxDist} blocks`
        );
        break;
      } else {
        console.log(`[Collect] No ${target} found within ${maxDist} blocks`);
      }
    }

    if (blocks.length === 0) {
      console.log(
        `[Collect] ERROR: No ${target} found within any search distance`
      );
      failTask(`I can't find any ${target} nearby.`);
      return;
    }

    // Sort blocks by distance (closest first) to reduce pathfinding issues
    blocks.sort((a, b) => {
      const distA = botPos.distanceTo(a);
      const distB = botPos.distanceTo(b);
      return distA - distB;
    });

    // Log closest block info
    const closestBlock = blocks[0];
    const closestDist = botPos.distanceTo(closestBlock);
    console.log(
      `[Collect] Closest ${target} at: x=${closestBlock.x}, y=${
        closestBlock.y
      }, z=${closestBlock.z} (distance: ${closestDist.toFixed(1)})`
    );

    bot.chat(`Found ${blocks.length} ${target}. Collecting...`);

    // Get the actual block objects
    const targetBlocks = blocks.map((pos) => bot.blockAt(pos)).filter(Boolean);
    console.log(`[Collect] Valid block objects: ${targetBlocks.length}`);

    if (targetBlocks.length === 0) {
      console.log(
        `[Collect] ERROR: All block positions returned null from bot.blockAt()`
      );
      failTask(`Found ${target} but couldn't access them.`);
      return;
    }

    // Collect blocks one at a time to handle pathfinding failures gracefully
    let collected = 0;
    let attempted = 0;
    for (const block of targetBlocks) {
      attempted++;
      console.log(
        `[Collect] Attempting block ${attempted}/${targetBlocks.length}: ${block.name} at (${block.position.x}, ${block.position.y}, ${block.position.z})`
      );

      try {
        console.log(`[Collect] Calling collectBlock.collect()...`);
        await bot.collectBlock.collect(block, {
          ignoreNoPath: false,
          timeout: 10000, // 30 second timeout per block
        });
        collected++;
        console.log(`[Collect] Successfully collected! (${collected} total)`);
      } catch (collectError) {
        console.log(`[Collect] Collection failed: ${collectError.message}`);
        console.log(
          `[Collect] Error stack:`,
          collectError.stack?.split("\n").slice(0, 3).join("\n")
        );

        // If pathfinding fails for this block, skip it and try the next
        if (
          collectError.message.includes("path") ||
          collectError.message.includes("goal") ||
          collectError.message.includes("Took to long")
        ) {
          console.log(
            `[Collect] Pathfinding issue - skipping to next block...`
          );
          continue;
        }
        // For other errors, log but continue
        console.log(`[Collect] Non-pathfinding error - continuing...`);
      }
    }

    console.log(
      `[Collect] === Collection complete: ${collected}/${attempted} blocks ===`
    );

    if (collected > 0) {
      completeCurrentTask(`Collected ${collected} ${target}!`);
    } else {
      console.log(`[Collect] ERROR: Failed to collect any blocks`);
      failTask(`Couldn't reach any ${target}. They might be blocked.`);
    }
  } catch (error) {
    console.error("[Collect] FATAL ERROR:", error.message);
    console.error("[Collect] Error stack:", error.stack);

    // If it's a pathfinding timeout, give a helpful message
    if (
      error.message.includes("path") ||
      error.message.includes("goal") ||
      error.message.includes("Took to long")
    ) {
      failTask(
        `Can't find a path to ${target}. Try moving closer or to open ground.`
      );
    } else {
      failTask(`Failed to collect ${target}: ${error.message}`);
    }
  }
}

/**
 * Maps crafted items to their raw collectable materials
 * Used when we need to gather resources for crafting
 */
const ITEM_TO_RAW_MATERIAL = {
  // Planks come from logs
  oak_planks: { collect: "oak_log", ratio: 4 }, // 1 log = 4 planks
  birch_planks: { collect: "birch_log", ratio: 4 },
  spruce_planks: { collect: "spruce_log", ratio: 4 },
  jungle_planks: { collect: "jungle_log", ratio: 4 },
  acacia_planks: { collect: "acacia_log", ratio: 4 },
  dark_oak_planks: { collect: "dark_oak_log", ratio: 4 },
  // Sticks require planks (which require logs)
  stick: { craft: "oak_planks", craftCount: 2, ratio: 4 }, // 2 planks = 4 sticks
  // Direct collectables
  cobblestone: { collect: "cobblestone", ratio: 1 }, // handleCollect maps this to "stone"
  diamond: { collect: "diamond_ore", ratio: 1 },
  iron_ingot: { smelt: "raw_iron", collect: "iron_ore", ratio: 1 },
  coal: { collect: "coal_ore", ratio: 1 },
  // Crafting table requires planks
  crafting_table: { craft: "oak_planks", craftCount: 4, ratio: 1 },
};

/**
 * Gets the count of an item in the bot's inventory
 * @param {string} itemName - Name of the item to count
 * @returns {number} - Count of items in inventory
 */
function getInventoryCount(itemName) {
  return bot.inventory
    .items()
    .filter((item) => item.name === itemName)
    .reduce((sum, item) => sum + item.count, 0);
}

/**
 * Analyzes a recipe and returns missing ingredients
 * @param {Object} recipe - The mineflayer recipe object
 * @param {number} count - How many items to craft
 * @returns {Array} - Array of { item: string, needed: number, have: number, missing: number }
 */
function analyzeMissingIngredients(recipe, count) {
  const ingredientCounts = {};

  // Count required ingredients from recipe
  // Recipe delta contains negative values for consumed items
  if (recipe.delta) {
    for (const delta of recipe.delta) {
      if (delta.count < 0) {
        const item = mcData.items[delta.id];
        if (item) {
          const needed = Math.abs(delta.count) * count;
          ingredientCounts[item.name] =
            (ingredientCounts[item.name] || 0) + needed;
        }
      }
    }
  }

  // Also check inShape for shaped recipes
  if (recipe.inShape) {
    for (const row of recipe.inShape) {
      for (const ingredient of row) {
        if (ingredient && ingredient.id !== -1) {
          const item = mcData.items[ingredient.id];
          if (item) {
            ingredientCounts[item.name] =
              (ingredientCounts[item.name] || 0) +
              (ingredient.count || 1) * count;
          }
        }
      }
    }
  }

  // Check ingredients array for shapeless recipes
  if (recipe.ingredients) {
    for (const ingredient of recipe.ingredients) {
      if (ingredient && ingredient.id !== -1) {
        const item = mcData.items[ingredient.id];
        if (item) {
          ingredientCounts[item.name] =
            (ingredientCounts[item.name] || 0) +
            (ingredient.count || 1) * count;
        }
      }
    }
  }

  // Calculate missing amounts
  const missing = [];
  for (const [itemName, needed] of Object.entries(ingredientCounts)) {
    const have = getInventoryCount(itemName);
    if (have < needed) {
      missing.push({
        item: itemName,
        needed,
        have,
        missing: needed - have,
      });
    }
  }

  return missing;
}

/**
 * Creates prerequisite tasks to gather missing materials
 * @param {Array} missingItems - Array from analyzeMissingIngredients
 * @returns {Array} - Array of task objects to add to queue
 */
function createGatherTasks(missingItems) {
  const tasks = [];

  for (const { item, missing } of missingItems) {
    const rawMaterial = ITEM_TO_RAW_MATERIAL[item];

    if (rawMaterial) {
      if (rawMaterial.collect) {
        // Direct collection (e.g., logs, cobblestone, ores)
        const collectCount = Math.ceil(missing / rawMaterial.ratio);
        tasks.push({
          type: "collect",
          target: rawMaterial.collect,
          count: collectCount,
        });

        // If it's a log, we need to craft planks too
        if (rawMaterial.collect.includes("_log") && item.includes("_planks")) {
          tasks.push({ type: "craft", target: item, count: missing });
        }
      } else if (rawMaterial.craft) {
        // Need to craft an intermediate item (e.g., sticks from planks)
        // First, ensure we have the materials for the intermediate craft
        const intermediateMissing =
          Math.ceil(missing / rawMaterial.ratio) * rawMaterial.craftCount;
        const intermediateHave = getInventoryCount(rawMaterial.craft);

        if (intermediateHave < intermediateMissing) {
          // Recursively get materials for intermediate
          const intermediateRaw = ITEM_TO_RAW_MATERIAL[rawMaterial.craft];
          if (intermediateRaw && intermediateRaw.collect) {
            const collectCount = Math.ceil(
              (intermediateMissing - intermediateHave) / intermediateRaw.ratio
            );
            tasks.push({
              type: "collect",
              target: intermediateRaw.collect,
              count: collectCount,
            });
            tasks.push({
              type: "craft",
              target: rawMaterial.craft,
              count: intermediateMissing - intermediateHave,
            });
          }
        }

        // Now craft the needed intermediate item
        tasks.push({ type: "craft", target: item, count: missing });
      }
    } else {
      // Unknown item, try to collect it directly as a block
      const block = mcData.blocksByName[item];
      if (block) {
        tasks.push({ type: "collect", target: item, count: missing });
      } else {
        console.log(`[Craft] Don't know how to obtain ${item}`);
      }
    }
  }

  return tasks;
}

/**
 * Handles the 'craft' task - crafts items using recipes
 * Automatically handles crafting table requirement and missing materials
 * @param {Object} task - { type: 'craft', target: string, count: number }
 */
async function handleCraft(task) {
  const { target, count = 1 } = task;

  try {
    // Find the item in minecraft-data
    const item = mcData.itemsByName[target];
    if (!item) {
      failTask(`I don't know how to craft "${target}".`);
      return;
    }

    // Check if we need a crafting table for this recipe
    // First try without table, then with table
    let recipes = bot.recipesFor(item.id, null, 1, null);
    let needsCraftingTable = false;
    let craftingTable = null;

    // Look for a nearby crafting table (within 4 blocks)
    const craftingTableBlock = mcData.blocksByName["crafting_table"];
    const nearbyTable = bot.findBlock({
      matching: craftingTableBlock.id,
      maxDistance: 4,
    });

    if (nearbyTable) {
      craftingTable = nearbyTable;
      // Get recipes that work with the crafting table
      recipes = bot.recipesFor(item.id, null, 1, craftingTable);
    }

    if (!recipes || recipes.length === 0) {
      // No recipes available - might need a crafting table
      if (!nearbyTable) {
        // Check if we have a crafting table in inventory
        const tableInInventory = bot.inventory
          .items()
          .find((i) => i.name === "crafting_table");

        if (tableInInventory) {
          // Insert place task before this craft task
          bot.chat(`I need to place my crafting table first...`);
          taskQueue.unshift({ type: "place", target: "crafting_table" });
          return; // Will retry craft after placing
        } else {
          // Need to make a crafting table first
          bot.chat(`I need a crafting table. Let me make one first...`);
          // Insert tasks to make and place a crafting table
          const planksHave = getInventoryCount("oak_planks");
          const prerequisiteTasks = [];

          if (planksHave < 4) {
            const logsNeeded = Math.ceil((4 - planksHave) / 4);
            prerequisiteTasks.push({
              type: "collect",
              target: "oak_log",
              count: logsNeeded,
            });
            prerequisiteTasks.push({
              type: "craft",
              target: "oak_planks",
              count: 4 - planksHave,
            });
          }
          prerequisiteTasks.push({
            type: "craft",
            target: "crafting_table",
            count: 1,
          });
          prerequisiteTasks.push({ type: "place", target: "crafting_table" });

          // Insert prerequisite tasks at the front (after current task which stays)
          for (let i = prerequisiteTasks.length - 1; i >= 0; i--) {
            taskQueue.unshift(prerequisiteTasks[i]);
          }
          return; // Will process prerequisites then retry
        }
      }
      failTask(`I don't have a recipe for ${target}.`);
      return;
    }

    const recipe = recipes[0];
    needsCraftingTable = recipe.requiresTable;

    // Analyze what ingredients we're missing
    const missingIngredients = analyzeMissingIngredients(recipe, count);

    if (missingIngredients.length > 0) {
      // We're missing materials - create gather tasks
      const missingNames = missingIngredients
        .map((m) => `${m.missing} ${m.item}`)
        .join(", ");
      bot.chat(`I need more materials: ${missingNames}. Gathering...`);

      const gatherTasks = createGatherTasks(missingIngredients);

      if (gatherTasks.length > 0) {
        // Insert gather tasks at the front of the queue
        // The current craft task stays at [0], gather tasks go before it
        for (let i = gatherTasks.length - 1; i >= 0; i--) {
          taskQueue.unshift(gatherTasks[i]);
        }
        console.log(`[Craft] Added ${gatherTasks.length} prerequisite tasks`);
        return; // Exit to let gather tasks execute first
      } else {
        failTask(`I don't know how to get the materials for ${target}.`);
        return;
      }
    }

    // Handle crafting table requirement
    if (needsCraftingTable && !craftingTable) {
      if (nearbyTable) {
        craftingTable = nearbyTable;
        bot.chat(`Using nearby crafting table...`);
      } else {
        // This shouldn't happen if recipe analysis worked, but handle it
        const tableInInventory = bot.inventory
          .items()
          .find((i) => i.name === "crafting_table");
        if (tableInInventory) {
          bot.chat(`I need to place my crafting table first...`);
          taskQueue.unshift({ type: "place", target: "crafting_table" });
          return;
        } else {
          failTask(
            `I need a crafting table to craft ${target}, but I don't have one.`
          );
          return;
        }
      }
    }

    bot.chat(`Crafting ${count} ${target}...`);

    // Perform the crafting
    await bot.craft(recipe, count, craftingTable);

    completeCurrentTask(`Crafted ${count} ${target}!`);
  } catch (error) {
    console.error("[Body] Craft error:", error.message);

    // Check if error is about missing materials (try to recover)
    if (
      error.message.includes("missing") ||
      error.message.includes("ingredient")
    ) {
      bot.chat(`Hmm, crafting failed. Let me check what I need...`);
      // The task stays in queue, will be retried
      // But we should probably fail here to avoid infinite loops
    }

    failTask(`Failed to craft ${target}: ${error.message}`);
  }
}

/**
 * Handles the 'place' task - places a block from inventory
 * @param {Object} task - { type: 'place', target: string }
 */
async function handlePlace(task) {
  const { target } = task;

  try {
    // Find the item in inventory
    const item = bot.inventory.items().find((i) => i.name === target);

    if (!item) {
      failTask(`I don't have any ${target} in my inventory.`);
      return;
    }

    // Equip the block
    await bot.equip(item, "hand");

    // Find a suitable reference block nearby to place against
    // Look for solid blocks at the bot's feet level
    const botPos = bot.entity.position.floored();
    const searchOffsets = [
      new Vec3(1, -1, 0),
      new Vec3(-1, -1, 0),
      new Vec3(0, -1, 1),
      new Vec3(0, -1, -1),
      new Vec3(1, 0, 0),
      new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1),
      new Vec3(0, 0, -1),
    ];

    let referenceBlock = null;
    let faceVector = null;

    for (const offset of searchOffsets) {
      const checkPos = botPos.plus(offset);
      const block = bot.blockAt(checkPos);

      if (block && block.boundingBox === "block") {
        referenceBlock = block;
        // Calculate the face vector (opposite of offset, pointing up for ground blocks)
        if (offset.y === -1) {
          faceVector = new Vec3(0, 1, 0); // Place on top
        } else {
          faceVector = offset.scaled(-1); // Place against the side
        }
        break;
      }
    }

    if (!referenceBlock) {
      failTask(`I can't find a good spot to place ${target}.`);
      return;
    }

    bot.chat(`Placing ${target}...`);

    // Place the block
    await bot.placeBlock(referenceBlock, faceVector);

    completeCurrentTask(`Placed ${target}!`);
  } catch (error) {
    console.error("[Body] Place error:", error.message);
    failTask(`Failed to place ${target}: ${error.message}`);
  }
}

/**
 * Handles the 'move' task - navigates to coordinates or a player
 * @param {Object} task - { type: 'move', x?, y?, z?, player? }
 */
async function handleMove(task) {
  try {
    let goal;

    if (task.player) {
      // Move to a player
      const targetPlayer = bot.players[task.player];
      if (!targetPlayer || !targetPlayer.entity) {
        failTask(`I can't see player "${task.player}".`);
        return;
      }
      const pos = targetPlayer.entity.position;
      goal = new GoalNear(pos.x, pos.y, pos.z, 2);
      bot.chat(`Moving to ${task.player}...`);
    } else if (
      task.x !== undefined &&
      task.y !== undefined &&
      task.z !== undefined
    ) {
      // Move to coordinates
      goal = new GoalNear(task.x, task.y, task.z, 2);
      bot.chat(`Moving to (${task.x}, ${task.y}, ${task.z})...`);
    } else {
      failTask("Invalid move command - need coordinates or player name.");
      return;
    }

    // Start pathfinding
    await bot.pathfinder.goto(goal);

    completeCurrentTask("I've arrived!");
  } catch (error) {
    // Check if it was interrupted (not a real error)
    if (error.message && error.message.includes("interrupted")) {
      console.log("[Body] Move was interrupted");
      // Don't fail task on interrupt, queue was already cleared
    } else {
      console.error("[Body] Move error:", error.message);
      failTask(`I couldn't get there: ${error.message}`);
    }
  }
}

/**
 * Handles the 'follow' task - continuously follows a player
 * Note: This task remains active until interrupted by a new command
 * @param {Object} task - { type: 'follow', player: string }
 */
async function handleFollow(task) {
  try {
    const targetPlayer = bot.players[task.player];
    if (!targetPlayer || !targetPlayer.entity) {
      failTask(`I can't see player "${task.player}".`);
      return;
    }

    // Set up continuous following using GoalFollow
    const goal = new GoalFollow(targetPlayer.entity, 3); // Stay 3 blocks away
    bot.pathfinder.setGoal(goal, true); // dynamic = true for continuous following
    bot.chat(`Following ${task.player}!`);

    // Note: Follow task stays in queue - it's continuous until interrupted
    // We don't call completeCurrentTask() here
  } catch (error) {
    console.error("[Body] Follow error:", error.message);
    failTask(`I couldn't follow: ${error.message}`);
  }
}

/**
 * Handles the 'stop' task - immediately stops all movement and clears the queue
 */
function handleStop() {
  bot.pathfinder.stop();
  bot.chat("Stopping!");
  taskQueue = []; // Clear entire queue on stop
}

/**
 * Handles unknown commands from the LLM
 * @param {Object} task - { type: 'unknown', reason: string }
 */
function handleUnknown(task) {
  bot.chat(task.reason || "I don't understand that command.");
  taskQueue = []; // Clear queue on unknown command
}

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
          await handleCollect(currentTask);
          break;
        case "craft":
          await handleCraft(currentTask);
          break;
        case "place":
          await handlePlace(currentTask);
          break;
        case "move":
          await handleMove(currentTask);
          break;
        case "follow":
          // Follow is continuous, handled differently
          await handleFollow(currentTask);
          // Don't complete - follow stays active until interrupted
          break;
        case "stop":
          handleStop();
          break;
        case "unknown":
          handleUnknown(currentTask);
          break;
        default:
          console.log(`[Supervisor] Unknown task type: ${currentTask.type}`);
          taskQueue.shift(); // Remove unknown task
      }
    } catch (error) {
      console.error("[Supervisor] Execution error:", error.message);
      failTask(`Task failed: ${error.message}`);
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
  defaultMove.allowSprinting = true;
  defaultMove.canDig = true;
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

  console.log(`[Chat] ${username}: ${message}`);

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
  const newTasks = await processUserRequest(message);

  if (newTasks && newTasks.length > 0) {
    console.log(
      `[Chat] New task queue (${newTasks.length} tasks):`,
      JSON.stringify(newTasks)
    );
    taskQueue = newTasks;

    if (newTasks.length > 1) {
      bot.chat(`Got it! I have ${newTasks.length} steps to complete.`);
    }
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

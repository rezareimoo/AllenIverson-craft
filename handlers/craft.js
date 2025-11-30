/**
 * Crafting task handler
 */

const { ITEM_TO_RAW_MATERIAL } = require("../config/constants");
const { completeCurrentTask, failTask } = require("../utils/queue");
const { getInventoryCount } = require("../utils/inventory");
const {
  validateAndCorrectName,
  getSuggestions,
} = require("../utils/blockNames");
const { validateCraftRequest } = require("../utils/recipes");

/**
 * Analyzes a recipe and returns missing ingredients
 * @param {Object} mcData - Minecraft data instance
 * @param {Object} bot - The mineflayer bot instance
 * @param {Object} recipe - The mineflayer recipe object
 * @param {number} count - How many items to craft
 * @returns {Array} - Array of { item: string, needed: number, have: number, missing: number }
 */
function analyzeMissingIngredients(mcData, bot, recipe, count) {
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
    const have = getInventoryCount(bot, itemName);
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
 * @param {Object} mcData - Minecraft data instance
 * @param {Object} bot - The mineflayer bot instance
 * @param {Array} missingItems - Array from analyzeMissingIngredients
 * @returns {Array} - Array of task objects to add to queue
 */
function createGatherTasks(mcData, bot, missingItems) {
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
        const intermediateHave = getInventoryCount(bot, rawMaterial.craft);

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
 * @param {Object} bot - The mineflayer bot instance
 * @param {Object} mcData - Minecraft data instance
 * @param {Array} taskQueue - The task queue array
 * @param {Object} task - { type: 'craft', target: string, count: number }
 */
async function handleCraft(bot, mcData, taskQueue, task) {
  let { target, count = 1 } = task;

  try {
    // Validate and correct the target name using minecraft-data
    const nameValidation = validateAndCorrectName(target, mcData);
    if (!nameValidation.valid) {
      const suggestions = getSuggestions(target, mcData);
      const suggestionMsg =
        suggestions.length > 0
          ? ` Did you mean: ${suggestions.join(", ")}?`
          : "";
      failTask(
        bot,
        taskQueue,
        `I don't know what "${target}" is.${suggestionMsg}`
      );
      return;
    }
    if (nameValidation.corrected !== target) {
      console.log(
        `[Craft] Auto-corrected "${target}" to "${nameValidation.corrected}"`
      );
      target = nameValidation.corrected;
    }

    // Validate that this item can be crafted
    const craftValidation = validateCraftRequest(target, mcData);
    if (!craftValidation.valid) {
      failTask(bot, taskQueue, craftValidation.message);
      return;
    }

    // Find the item in minecraft-data
    const item = mcData.itemsByName[target];
    if (!item) {
      failTask(bot, taskQueue, `I don't know how to craft "${target}".`);
      return;
    }

    // Check if we need a crafting table for this recipe
    // First try without table (inventory crafting), then with table
    let recipes = bot.recipesFor(item.id, null, 1, null);
    let needsCraftingTable = false;
    let craftingTable = null;

    // Look for a nearby crafting table (within 16 blocks - increased from 4)
    const craftingTableBlock = mcData.blocksByName["crafting_table"];
    const nearbyTable = bot.findBlock({
      matching: craftingTableBlock.id,
      maxDistance: 16, // Increased search radius
    });

    // First, try to find recipes that work in inventory (2x2 grid)
    if (!recipes || recipes.length === 0) {
      // No inventory recipes, try with crafting table if available
      if (nearbyTable) {
        recipes = bot.recipesFor(item.id, null, 1, nearbyTable);
        if (recipes && recipes.length > 0) {
          craftingTable = nearbyTable;
        }
      }
    } else {
      // We have inventory recipes, check if they require a table
      const recipe = recipes[0];
      if (recipe.requiresTable) {
        // Recipe requires table, need to use crafting table
        if (nearbyTable) {
          recipes = bot.recipesFor(item.id, null, 1, nearbyTable);
          craftingTable = nearbyTable;
        } else {
          // Need crafting table but don't have one nearby
          recipes = null; // Will trigger the table placement logic below
        }
      }
      // If recipe doesn't require table, keep recipes and craftingTable stays null
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
          const planksHave = getInventoryCount(bot, "oak_planks");
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
      failTask(bot, taskQueue, `I don't have a recipe for ${target}.`);
      return;
    }

    const recipe = recipes[0];
    needsCraftingTable = recipe.requiresTable;

    // Ensure craftingTable is set correctly based on recipe requirements
    if (needsCraftingTable) {
      if (!nearbyTable) {
        // Need to place a crafting table
        const tableInInventory = bot.inventory
          .items()
          .find((i) => i.name === "crafting_table");
        if (tableInInventory) {
          bot.chat(`I need to place my crafting table first...`);
          taskQueue.unshift({ type: "place", target: "crafting_table" });
          return;
        } else {
          failTask(
            bot,
            taskQueue,
            `I need a crafting table to craft ${target}, but I don't have one.`
          );
          return;
        }
      }

      // Set craftingTable for use in bot.craft() later
      craftingTable = nearbyTable;

      // Check if we're already close enough to the crafting table (within 4 blocks)
      const distToTable = bot.entity.position.distanceTo(nearbyTable.position);
      if (distToTable > 4) {
        // Only move if actually far away - prevents infinite loop
        bot.chat(`Moving closer to crafting table...`);
        taskQueue.unshift({
          type: "move",
          block: "crafting_table",
          radius: 3,
        });
        return; // Will retry craft after moving
      }
      // Otherwise continue with crafting - we're close enough
    } else {
      // Recipe doesn't require table - ensure craftingTable is null for inventory crafting
      craftingTable = null;
    }

    // Analyze what ingredients we're missing
    const missingIngredients = analyzeMissingIngredients(
      mcData,
      bot,
      recipe,
      count
    );

    if (missingIngredients.length > 0) {
      // We're missing materials - create gather tasks
      const missingNames = missingIngredients
        .map((m) => `${m.missing} ${m.item}`)
        .join(", ");
      bot.chat(`I need more materials: ${missingNames}. Gathering...`);

      const gatherTasks = createGatherTasks(mcData, bot, missingIngredients);

      if (gatherTasks.length > 0) {
        // Insert gather tasks at the front of the queue
        // The current craft task stays at [0], gather tasks go before it
        for (let i = gatherTasks.length - 1; i >= 0; i--) {
          taskQueue.unshift(gatherTasks[i]);
        }
        console.log(`[Craft] Added ${gatherTasks.length} prerequisite tasks`);
        return; // Exit to let gather tasks execute first
      } else {
        failTask(
          bot,
          taskQueue,
          `I don't know how to get the materials for ${target}.`
        );
        return;
      }
    }

    // Log what type of crafting we're doing
    if (craftingTable) {
      bot.chat(`Crafting ${count} ${target} at crafting table...`);
    } else {
      bot.chat(`Crafting ${count} ${target} in inventory...`);
    }

    // Perform the crafting
    // For inventory crafting, pass null. For table crafting, pass the block.
    await bot.craft(recipe, count, craftingTable);

    completeCurrentTask(bot, taskQueue, `Crafted ${count} ${target}!`);
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

    failTask(bot, taskQueue, `Failed to craft ${target}: ${error.message}`);
  }
}

module.exports = {
  handleCraft,
};

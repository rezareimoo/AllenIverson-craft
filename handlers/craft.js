/**
 * Crafting task handler
 */

const { completeCurrentTask, failTask, syncQueue } = require("../utils/queue");
const { getInventoryCount } = require("../utils/inventory");
const {
  validateAndCorrectName,
  getSuggestions,
} = require("../utils/blockNames");
const {
  validateCraftRequest,
  resolveAllDependencies,
} = require("../utils/recipes");

/**
 * Builds an inventory map from the bot's current inventory
 * @param {Object} bot - The mineflayer bot instance
 * @returns {Object} - Map of itemName -> count
 */
function buildInventoryMap(bot) {
  const map = {};
  for (const item of bot.inventory.items()) {
    map[item.name] = (map[item.name] || 0) + item.count;
  }
  return map;
}

/**
 * Handles the 'craft' task - crafts items using recipes
 * Automatically handles crafting table requirement and missing materials
 * Uses recursive dependency resolution for complex recipes
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

    // Build current inventory map
    const inventoryMap = buildInventoryMap(bot);

    // Check if we already have enough of the target item
    // count = TOTAL amount we want (not additional needed)
    const currentCount = inventoryMap[target] || 0;
    console.log(
      `[Craft] Checking ${target}: have ${currentCount}, want ${count} total`
    );
    if (currentCount >= count) {
      console.log(
        `[Craft] Already have enough ${target} (${currentCount} >= ${count})`
      );
      completeCurrentTask(
        bot,
        taskQueue,
        `I already have ${currentCount} ${target}!`
      );
      return;
    }
    console.log(
      `[Craft] Need to craft more ${target} (${currentCount} < ${count})`
    );

    // Use recursive dependency resolver to get all prerequisite tasks
    console.log(`[Craft] Resolving dependencies for ${count} ${target}...`);
    const resolution = resolveAllDependencies(
      target,
      count,
      mcData,
      inventoryMap
    );

    if (!resolution.feasible) {
      failTask(bot, taskQueue, `Can't craft ${target}: ${resolution.reason}`);
      return;
    }

    // Check if there are prerequisite tasks (collect or intermediate crafts)
    // The last task should be the craft for the target item
    const prerequisiteTasks = resolution.tasks.slice(0, -1);

    if (prerequisiteTasks.length > 0) {
      // We have prerequisites to complete first
      console.log(
        `[Craft] ${prerequisiteTasks.length} prerequisite tasks needed for ${target}`
      );
      const collectTasks = prerequisiteTasks.filter(
        (t) => t.type === "collect"
      );
      const craftTasks = prerequisiteTasks.filter((t) => t.type === "craft");

      let message = "I need to prepare first: ";
      if (collectTasks.length > 0) {
        message += `collect ${collectTasks
          .map((t) => `${t.count} ${t.target}`)
          .join(", ")}`;
      }
      if (craftTasks.length > 0) {
        if (collectTasks.length > 0) message += ", then ";
        message += `craft ${craftTasks
          .map((t) => `${t.count} ${t.target}`)
          .join(", ")}`;
      }
      bot.chat(message);

      // Remove current task from queue (it's at position 0)
      taskQueue.shift();

      // Insert all prerequisite tasks plus the original craft task
      // The original task goes at the end (after prerequisites)
      const allTasks = [...prerequisiteTasks, { type: "craft", target, count }];
      for (let i = allTasks.length - 1; i >= 0; i--) {
        taskQueue.unshift(allTasks[i]);
      }

      // Sync the queue
      syncQueue(taskQueue);

      console.log(
        `[Craft] Added ${prerequisiteTasks.length} prerequisite tasks for ${target}`
      );
      return; // Exit to let prerequisite tasks execute first
    }

    // No prerequisites needed - we have all ingredients
    // Now handle crafting table requirements

    // Check if we need a crafting table for this recipe
    let recipes = bot.recipesFor(item.id, null, 1, null);
    let craftingTable = null;

    // Look for a nearby crafting table (within 16 blocks)
    const craftingTableBlock = mcData.blocksByName["crafting_table"];
    const nearbyTable = bot.findBlock({
      matching: craftingTableBlock.id,
      maxDistance: 16,
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
          recipes = null; // Will trigger the table placement logic below
        }
      }
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
          syncQueue(taskQueue);
          return; // Will retry craft after placing
        } else {
          // Need to make a crafting table first - use the resolver
          bot.chat(`I need a crafting table. Let me make one first...`);

          const tableResolution = resolveAllDependencies(
            "crafting_table",
            1,
            mcData,
            inventoryMap
          );
          if (tableResolution.feasible && tableResolution.tasks.length > 0) {
            // Insert crafting table tasks plus place task
            const tableTasks = [
              ...tableResolution.tasks,
              { type: "place", target: "crafting_table" },
            ];
            for (let i = tableTasks.length - 1; i >= 0; i--) {
              taskQueue.unshift(tableTasks[i]);
            }
            syncQueue(taskQueue);
            return;
          } else {
            failTask(
              bot,
              taskQueue,
              `Can't make a crafting table: ${
                tableResolution.reason || "unknown error"
              }`
            );
            return;
          }
        }
      }
      failTask(bot, taskQueue, `I don't have a recipe for ${target}.`);
      return;
    }

    const recipe = recipes[0];
    const needsCraftingTable = recipe.requiresTable;

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
          syncQueue(taskQueue);
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
        syncQueue(taskQueue);
        return; // Will retry craft after moving
      }
    } else {
      // Recipe doesn't require table - ensure craftingTable is null for inventory crafting
      craftingTable = null;
    }

    // count is the TARGET AMOUNT of items we want (not recipe executions)
    // Calculate how many recipe executions we need based on current inventory
    const outputPerRecipe = recipe.result?.count || 1;

    // Check current inventory again (may have changed from previous tasks)
    const finalInventoryCount = getInventoryCount(bot, target);
    const stillNeeded = count - finalInventoryCount;

    if (stillNeeded <= 0) {
      console.log(
        `[Craft] Already have ${finalInventoryCount} ${target} (needed ${count}), skipping`
      );
      completeCurrentTask(bot, taskQueue, `Already have enough ${target}!`);
      return;
    }

    // Calculate recipe executions needed to get at least stillNeeded items
    const recipeExecutions = Math.ceil(stillNeeded / outputPerRecipe);

    console.log(
      `[Craft] Need ${stillNeeded} more ${target}, crafting ${recipeExecutions}x (${outputPerRecipe} per recipe)`
    );

    // Log what type of crafting we're doing
    if (craftingTable) {
      bot.chat(`Crafting ${target} at crafting table...`);
    } else {
      bot.chat(`Crafting ${target} in inventory...`);
    }

    // Perform the crafting
    // recipeExecutions = number of times to run the recipe
    await bot.craft(recipe, recipeExecutions, craftingTable);

    const actualOutput = recipeExecutions * outputPerRecipe;
    completeCurrentTask(bot, taskQueue, `Crafted ${actualOutput} ${target}!`);
  } catch (error) {
    console.error("[Craft] Craft error:", error.message);

    // Check if error is about missing materials (try to recover)
    if (
      error.message.includes("missing") ||
      error.message.includes("ingredient")
    ) {
      bot.chat(`Hmm, crafting failed. Let me check what I need...`);
    }

    failTask(bot, taskQueue, `Failed to craft ${target}: ${error.message}`);
  }
}

module.exports = {
  handleCraft,
};

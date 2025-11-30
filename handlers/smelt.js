/**
 * Smelting task handler
 * Handles finding/placing furnaces and smelting items
 */

const { SMELTABLE_ITEMS, FUEL_ITEMS } = require("../config/constants");
const { completeCurrentTask, failTask, syncQueue } = require("../utils/queue");
const { getInventoryCount } = require("../utils/inventory");

/**
 * Gets the best available fuel from inventory
 * @param {Object} bot - The mineflayer bot instance
 * @returns {Object|null} - { name, count, burnTime } or null if no fuel
 */
function getBestFuel(bot) {
  for (const fuel of FUEL_ITEMS) {
    const count = getInventoryCount(bot, fuel.name);
    if (count > 0) {
      return { name: fuel.name, count, burnTime: fuel.burnTime };
    }
  }
  return null;
}

/**
 * Calculates how much fuel is needed for smelting
 * @param {number} itemCount - Number of items to smelt
 * @param {number} fuelBurnTime - How many items one fuel can smelt
 * @returns {number} - Fuel units needed
 */
function calculateFuelNeeded(itemCount, fuelBurnTime) {
  return Math.ceil(itemCount / fuelBurnTime);
}

/**
 * Waits for smelting to complete by monitoring the furnace
 * @param {Object} furnaceBlock - The furnace window
 * @param {number} expectedOutput - Number of items expected
 * @param {number} timeout - Max time to wait in ms
 * @returns {Promise<boolean>} - True if smelting completed
 */
async function waitForSmelting(furnaceBlock, expectedOutput, timeout = 60000) {
  const startTime = Date.now();
  
  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      // Check if we have output items
      const outputSlot = furnaceBlock.outputItem();
      if (outputSlot && outputSlot.count >= expectedOutput) {
        clearInterval(checkInterval);
        resolve(true);
        return;
      }
      
      // Check for timeout
      if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        resolve(false);
        return;
      }
      
      // Check if furnace stopped (no fuel, no input)
      const fuelSlot = furnaceBlock.fuelItem();
      const inputSlot = furnaceBlock.inputItem();
      if (!fuelSlot && !inputSlot && furnaceBlock.fuel === 0) {
        // Smelting stopped, check what we got
        clearInterval(checkInterval);
        resolve(outputSlot && outputSlot.count > 0);
        return;
      }
    }, 500);
  });
}

/**
 * Handles the 'smelt' task - smelts items in a furnace
 * Task format: { type: 'smelt', input: string, output: string, count: number }
 * 
 * @param {Object} bot - The mineflayer bot instance
 * @param {Object} mcData - Minecraft data instance
 * @param {Array} taskQueue - The task queue array
 * @param {Object} task - The smelt task
 */
async function handleSmelt(bot, mcData, taskQueue, task) {
  const { input, output, count = 1 } = task;

  try {
    console.log(`[Smelt] Starting smelt task: ${count} ${input} -> ${output}`);

    // Validate the smelt recipe
    const smeltInfo = SMELTABLE_ITEMS[output];
    if (!smeltInfo || smeltInfo.input !== input) {
      failTask(bot, taskQueue, `I don't know how to smelt ${input} into ${output}.`);
      return;
    }

    // Check if we have the input items
    const inputCount = getInventoryCount(bot, input);
    if (inputCount < count) {
      // Need to collect more input items - queue prerequisite tasks
      bot.chat(`I need more ${input}. Let me get some first...`);
      taskQueue.unshift({ type: "collect", target: input, count: count });
      syncQueue(taskQueue);
      return;
    }

    // Check if we have fuel
    const fuel = getBestFuel(bot);
    const fuelNeeded = calculateFuelNeeded(count, fuel ? fuel.burnTime : 8);
    
    if (!fuel || fuel.count < fuelNeeded) {
      // Need to get fuel - prefer coal
      const coalNeeded = calculateFuelNeeded(count, 8);
      bot.chat(`I need fuel for smelting. Let me get some coal...`);
      taskQueue.unshift({ type: "collect", target: "coal_ore", count: coalNeeded });
      syncQueue(taskQueue);
      return;
    }

    // Find a furnace nearby
    const furnaceBlock = mcData.blocksByName["furnace"];
    let nearbyFurnace = bot.findBlock({
      matching: [furnaceBlock.id, mcData.blocksByName["lit_furnace"]?.id].filter(Boolean),
      maxDistance: 32,
    });

    // Also check for blast furnace if smelting ores
    if (!nearbyFurnace) {
      const blastFurnace = mcData.blocksByName["blast_furnace"];
      if (blastFurnace) {
        nearbyFurnace = bot.findBlock({
          matching: blastFurnace.id,
          maxDistance: 32,
        });
      }
    }

    if (!nearbyFurnace) {
      // No furnace found - need to craft and place one
      const furnaceInInventory = bot.inventory.items().find(i => i.name === "furnace");
      
      if (furnaceInInventory) {
        bot.chat("I need to place my furnace first...");
        taskQueue.unshift({ type: "place", target: "furnace" });
        syncQueue(taskQueue);
        return;
      } else {
        // Need to craft a furnace first
        bot.chat("I need a furnace. Let me make one first...");
        taskQueue.unshift(
          { type: "craft", target: "furnace", count: 1 },
          { type: "place", target: "furnace" }
        );
        syncQueue(taskQueue);
        return;
      }
    }

    // Move to furnace if too far
    const distToFurnace = bot.entity.position.distanceTo(nearbyFurnace.position);
    if (distToFurnace > 4) {
      bot.chat("Moving to furnace...");
      taskQueue.unshift({ type: "move", block: "furnace", radius: 3 });
      syncQueue(taskQueue);
      return;
    }

    // Open the furnace
    bot.chat(`Smelting ${count} ${input}...`);
    const furnace = await bot.openFurnace(nearbyFurnace);

    try {
      // Put fuel in furnace
      const fuelItem = bot.inventory.items().find(i => i.name === fuel.name);
      if (fuelItem) {
        const fuelToUse = Math.min(fuelNeeded, fuelItem.count);
        await furnace.putFuel(fuelItem.type, null, fuelToUse);
        console.log(`[Smelt] Added ${fuelToUse} ${fuel.name} as fuel`);
      }

      // Put input items in furnace
      const inputItem = bot.inventory.items().find(i => i.name === input);
      if (inputItem) {
        const inputToUse = Math.min(count, inputItem.count);
        await furnace.putInput(inputItem.type, null, inputToUse);
        console.log(`[Smelt] Added ${inputToUse} ${input} to smelt`);
      }

      // Wait for smelting to complete
      console.log(`[Smelt] Waiting for smelting to complete...`);
      const smeltTime = count * 10000; // 10 seconds per item
      const success = await waitForSmelting(furnace, count, smeltTime + 10000);

      if (success) {
        // Take output
        const outputItem = furnace.outputItem();
        if (outputItem) {
          await furnace.takeOutput();
          console.log(`[Smelt] Collected ${outputItem.count} ${output}`);
        }

        // Take any remaining fuel
        const remainingFuel = furnace.fuelItem();
        if (remainingFuel) {
          await furnace.takeFuel();
        }

        furnace.close();
        completeCurrentTask(bot, taskQueue, `Smelted ${count} ${output}!`);
      } else {
        // Partial success - take what we got
        const outputItem = furnace.outputItem();
        if (outputItem && outputItem.count > 0) {
          await furnace.takeOutput();
          furnace.close();
          completeCurrentTask(bot, taskQueue, `Smelted ${outputItem.count} ${output} (partial).`);
        } else {
          furnace.close();
          failTask(bot, taskQueue, `Smelting timed out. Check furnace manually.`);
        }
      }
    } catch (furnaceError) {
      console.error("[Smelt] Furnace operation error:", furnaceError.message);
      try { furnace.close(); } catch (e) {}
      failTask(bot, taskQueue, `Furnace error: ${furnaceError.message}`);
    }
  } catch (error) {
    console.error("[Smelt] Error:", error.message);
    failTask(bot, taskQueue, `Failed to smelt: ${error.message}`);
  }
}

/**
 * Checks if an item is obtained through smelting
 * @param {string} itemName - The item to check
 * @returns {Object|null} - Smelt info { input, fuelPerItem } or null
 */
function getSmeltInfo(itemName) {
  return SMELTABLE_ITEMS[itemName] || null;
}

module.exports = {
  handleSmelt,
  getSmeltInfo,
  getBestFuel,
  calculateFuelNeeded,
  SMELTABLE_ITEMS,
};


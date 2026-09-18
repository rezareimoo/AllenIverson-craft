/**
 * Smelting task handler
 */

const { SMELTABLE_ITEMS, FUEL_ITEMS } = require("../config/constants");
const {
  completeCurrentTask,
  failTask,
  syncQueue,
  assertNotCancelled,
} = require("../utils/queue");
const { getInventoryCount } = require("../utils/inventory");
const { botState } = require("../state/botState");

function isFuelItem(name) {
  if (FUEL_ITEMS.some((f) => f.name === name)) return true;
  if (name.endsWith("_log") || name.endsWith("_stem")) return true;
  if (name.endsWith("_planks")) return true;
  return false;
}

function fuelBurnTime(name) {
  const known = FUEL_ITEMS.find((f) => f.name === name);
  if (known) return known.burnTime;
  if (name.endsWith("_log") || name.endsWith("_stem") || name.endsWith("_planks")) {
    return 1.5;
  }
  if (name === "stick") return 0.5;
  return 0;
}

/**
 * Gets the best available fuel from inventory (any log/planks/coal/etc.)
 */
function getBestFuel(bot) {
  // Prefer configured fuels first
  for (const fuel of FUEL_ITEMS) {
    const count = getInventoryCount(bot, fuel.name);
    if (count > 0) {
      return { name: fuel.name, count, burnTime: fuel.burnTime };
    }
  }

  // Any log / planks
  for (const item of bot.inventory.items()) {
    if (isFuelItem(item.name)) {
      return {
        name: item.name,
        count: item.count,
        burnTime: fuelBurnTime(item.name),
      };
    }
  }
  return null;
}

function calculateFuelNeeded(itemCount, fuelBurnTime) {
  return Math.ceil(itemCount / fuelBurnTime);
}

async function waitForSmelting(furnaceBlock, expectedOutput, timeout = 60000) {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      const outputSlot = furnaceBlock.outputItem();
      if (outputSlot && outputSlot.count >= expectedOutput) {
        clearInterval(checkInterval);
        resolve(true);
        return;
      }

      if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        resolve(false);
        return;
      }

      const fuelSlot = furnaceBlock.fuelItem();
      const inputSlot = furnaceBlock.inputItem();
      if (!fuelSlot && !inputSlot && furnaceBlock.fuel === 0) {
        clearInterval(checkInterval);
        resolve(outputSlot && outputSlot.count > 0);
      }
    }, 500);
  });
}

/**
 * @param {Object} bot
 * @param {Object} mcData
 * @param {Array} taskQueue
 * @param {Object} task
 * @param {number} [cancelGen]
 */
async function handleSmelt(bot, mcData, taskQueue, task, cancelGen) {
  const { input, output, count = 1 } = task;
  const gen = cancelGen ?? botState.getCancelGeneration();

  try {
    assertNotCancelled(gen);
    console.log(`[Smelt] Starting: ${count} ${input} -> ${output}`);

    const smeltInfo = SMELTABLE_ITEMS[output];
    if (!smeltInfo || smeltInfo.input !== input) {
      failTask(
        bot,
        taskQueue,
        `I don't know how to smelt ${input} into ${output}.`
      );
      return;
    }

    const inputCount = getInventoryCount(bot, input);
    if (inputCount < count) {
      bot.chat(`I need more ${input}. Let me get some first...`);
      taskQueue.unshift({ type: "collect", target: input, count });
      syncQueue(taskQueue);
      return;
    }

    const fuel = getBestFuel(bot);
    const fuelNeeded = calculateFuelNeeded(count, fuel ? fuel.burnTime : 8);

    if (!fuel || fuel.count < 1) {
      // Collect coal ITEM (mining coal_ore drops coal)
      const coalNeeded = calculateFuelNeeded(count, 8);
      bot.chat(`I need fuel for smelting. Getting coal...`);
      taskQueue.unshift({
        type: "collect",
        target: "coal",
        count: coalNeeded,
      });
      syncQueue(taskQueue);
      return;
    }

    // Find furnace / lit furnace / blast furnace — remember which
    const furnaceIds = [
      mcData.blocksByName["furnace"]?.id,
      mcData.blocksByName["lit_furnace"]?.id,
      mcData.blocksByName["blast_furnace"]?.id,
      mcData.blocksByName["lit_blast_furnace"]?.id,
    ].filter(Boolean);

    let nearbyFurnace = bot.findBlock({
      matching: furnaceIds,
      maxDistance: 32,
    });

    if (!nearbyFurnace) {
      const furnaceInInventory = bot.inventory
        .items()
        .find((i) => i.name === "furnace");

      if (furnaceInInventory) {
        bot.chat("I need to place my furnace first...");
        taskQueue.unshift({ type: "place", target: "furnace" });
        syncQueue(taskQueue);
        return;
      }

      bot.chat("I need a furnace. Let me make one first...");
      taskQueue.unshift(
        { type: "craft", target: "furnace", count: 1 },
        { type: "place", target: "furnace" }
      );
      syncQueue(taskQueue);
      return;
    }

    const furnaceBlockName = nearbyFurnace.name;
    const distToFurnace = bot.entity.position.distanceTo(
      nearbyFurnace.position
    );
    if (distToFurnace > 4) {
      bot.chat("Moving to furnace...");
      // Move to the specific furnace type we found
      taskQueue.unshift({
        type: "move",
        block: furnaceBlockName.replace(/^lit_/, ""),
        radius: 3,
      });
      syncQueue(taskQueue);
      return;
    }

    assertNotCancelled(gen);
    bot.chat(`Smelting ${count} ${input}...`);
    const furnace = await bot.openFurnace(nearbyFurnace);

    try {
      const fuelItem = bot.inventory.items().find((i) => i.name === fuel.name);
      if (fuelItem) {
        const fuelToUse = Math.min(Math.max(fuelNeeded, 1), fuelItem.count);
        await furnace.putFuel(fuelItem.type, null, fuelToUse);
      }

      const inputItem = bot.inventory.items().find((i) => i.name === input);
      if (inputItem) {
        const inputToUse = Math.min(count, inputItem.count);
        await furnace.putInput(inputItem.type, null, inputToUse);
      }

      const smeltTime = count * 10000;
      const success = await waitForSmelting(furnace, count, smeltTime + 10000);
      assertNotCancelled(gen);

      if (success) {
        const outputItem = furnace.outputItem();
        if (outputItem) await furnace.takeOutput();
        const remainingFuel = furnace.fuelItem();
        if (remainingFuel) await furnace.takeFuel();
        furnace.close();
        completeCurrentTask(bot, taskQueue, `Smelted ${count} ${output}!`);
      } else {
        const outputItem = furnace.outputItem();
        if (outputItem && outputItem.count > 0) {
          await furnace.takeOutput();
          furnace.close();
          completeCurrentTask(
            bot,
            taskQueue,
            `Smelted ${outputItem.count} ${output} (partial).`
          );
        } else {
          furnace.close();
          failTask(bot, taskQueue, `Smelting timed out.`);
        }
      }
    } catch (furnaceError) {
      if (furnaceError.cancelled) throw furnaceError;
      try {
        furnace.close();
      } catch (e) {}
      failTask(bot, taskQueue, `Furnace error: ${furnaceError.message}`);
    }
  } catch (error) {
    if (error.cancelled) {
      console.log("[Smelt] Cancelled");
      return;
    }
    console.error("[Smelt] Error:", error.message);
    failTask(bot, taskQueue, `Failed to smelt: ${error.message}`);
  }
}

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

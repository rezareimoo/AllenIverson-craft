/**
 * Idle farm scheduler — rotates farms every ~3 minutes when the bot is free.
 */

const { botState } = require("../state/botState");
const { farmRegistry } = require("./farmRegistry");
const { TEND_INTERVAL_MS } = require("./crops");
const { tendFarm } = require("./tend");
const { findHoe, planEquipmentTasks } = require("./actions");

let tending = false;
let lastSchedulerLog = 0;

function canRunStandby(taskQueue) {
  if (tending) return false;
  if (!farmRegistry.isEnabled()) return false;
  if (!farmRegistry.getActiveFarms().length) return false;
  if (taskQueue.length > 0) return false;
  if (botState.isExecuting()) return false;
  const mode = botState.getMode();
  if (mode === "follow" || mode === "working" || mode === "farming") return false;
  return mode === "idle";
}

/**
 * Called from supervision loop when idle.
 * @returns {Promise<boolean>} true if a tend cycle was started
 */
async function tickFarmScheduler(bot, mcData, taskQueue) {
  if (!canRunStandby(taskQueue)) return false;

  const farm = farmRegistry.pickNextFarm(TEND_INTERVAL_MS);
  if (!farm) {
    const now = Date.now();
    if (now - lastSchedulerLog > 60000) {
      console.log("[FarmScheduler] No farm due yet");
      lastSchedulerLog = now;
    }
    return false;
  }

  // If no hoe, try to queue craft once then wait for player loop
  if (!findHoe(bot)) {
    const { tasks } = planEquipmentTasks(bot, mcData, {
      needHoe: true,
      needChest: false,
      needBucket: false,
    });
    if (tasks.length > 0 && taskQueue.length === 0) {
      bot.chat("Crafting a hoe so I can tend farms...");
      botState.replaceQueue(tasks);
      botState.setMode("working");
      return false;
    }
    return false;
  }

  const cancelGen = botState.getCancelGeneration();
  tending = true;
  farmRegistry.setCurrentFarmId(farm.id);
  botState.setMode("farming");
  botState.setExecuting(true);

  console.log(`[FarmScheduler] Tending farm #${farm.id} (${farm.crop})`);
  bot.chat(`Tending farm #${farm.id} (${farm.crop})...`);

  try {
    const result = await tendFarm(bot, mcData, farm, cancelGen);
    if (!botState.isCancelled(cancelGen)) {
      bot.chat(
        `Farm #${farm.id}: harvested ${result.harvested}, planted ${result.planted}, stored ${result.deposited}.`
      );
    }
  } catch (error) {
    if (error.cancelled || error.message === "CANCELLED") {
      console.log("[FarmScheduler] Tend cancelled");
    } else if (error.message === "NO_HOE") {
      bot.chat("I need a hoe to tend farms.");
    } else {
      console.error("[FarmScheduler] Tend error:", error.message);
      bot.chat(`Couldn't finish tending farm #${farm.id}.`);
    }
  } finally {
    tending = false;
    farmRegistry.setCurrentFarmId(null);
    if (!botState.isCancelled(cancelGen)) {
      botState.setExecuting(false);
      if (botState.getMode() === "farming") {
        botState.setMode("idle");
      }
    }
  }

  return true;
}

function isTending() {
  return tending;
}

module.exports = {
  tickFarmScheduler,
  isTending,
  canRunStandby,
};

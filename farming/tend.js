/**
 * Tend a registered farm: harvest mature crops, replant, deposit yields.
 */

const { Vec3 } = require("vec3");
const { GoalNear } = require("mineflayer-pathfinder").goals;
const { botState } = require("../state/botState");
const { farmRegistry } = require("./farmRegistry");
const { getCropMeta, isMatureCrop, TEND_INTERVAL_MS } = require("./crops");
const {
  equipHoe,
  findHoe,
  tillBlock,
  plantOnFarmland,
  harvestCrop,
  depositYields,
  iterFarmTiles,
  ensureNear,
  placeBlockAt,
  planEquipmentTasks,
  sleep,
} = require("./actions");
const { assertNotCancelled } = require("../utils/queue");
const { getInventoryCount } = require("../utils/inventory");
const { gotoRobust } = require("../utils/pathing");

/**
 * Run one tend cycle for a farm. Throws on cancel.
 */
async function tendFarm(bot, mcData, farm, cancelGen) {
  const meta = getCropMeta(farm.crop);
  if (!meta) throw new Error(`Unknown crop ${farm.crop}`);

  if (!findHoe(bot)) {
    throw new Error("NO_HOE");
  }

  const origin = new Vec3(farm.origin.x, farm.origin.y, farm.origin.z);
  await gotoRobust(bot, new GoalNear(origin.x, origin.y, origin.z, 3), {
    mcData,
    taskQueue: [],
    assertNotCancelled: () => assertNotCancelled(cancelGen),
    preferNoBuild: false,
    maxAttempts: 3,
  });

  await equipHoe(bot);

  // Ensure chest exists
  if (farm.chestPos) {
    const cpos = new Vec3(farm.chestPos.x, farm.chestPos.y, farm.chestPos.z);
    const chestBlock = bot.blockAt(cpos);
    if (
      (!chestBlock ||
        (chestBlock.name !== "chest" && chestBlock.name !== "trapped_chest")) &&
      getInventoryCount(bot, "chest") > 0
    ) {
      try {
        await placeBlockAt(bot, "chest", cpos, cancelGen);
      } catch (e) {
        if (e.cancelled) throw e;
      }
    }
  }

  let harvested = 0;
  let planted = 0;
  const tiles = iterFarmTiles(farm.bounds);

  for (const t of tiles) {
    assertNotCancelled(cancelGen);
    // Skip center water typically
    if (
      t.x === Math.floor(farm.origin.x) &&
      t.z === Math.floor(farm.origin.z)
    ) {
      const b = bot.blockAt(new Vec3(t.x, t.y, t.z));
      if (b && b.name === "water") continue;
    }

    const ground = bot.blockAt(new Vec3(t.x, t.y, t.z));
    if (!ground) continue;

    // Re-till if farmland dried to dirt
    if (ground.name === "dirt" || ground.name === "grass_block") {
      try {
        await tillBlock(bot, ground, cancelGen);
      } catch (e) {
        if (e.cancelled || e.message === "NO_HOE") throw e;
      }
    }

    const farmland = bot.blockAt(new Vec3(t.x, t.y, t.z));
    if (!farmland || farmland.name !== "farmland") continue;

    const cropBlock = bot.blockAt(new Vec3(t.x, t.y + 1, t.z));

    if (isMatureCrop(cropBlock, farm.crop)) {
      try {
        await harvestCrop(bot, cropBlock, cancelGen);
        harvested++;
        await sleep(80);
      } catch (e) {
        if (e.cancelled) throw e;
      }
    }

    // Replant if empty air above farmland
    const above = bot.blockAt(new Vec3(t.x, t.y + 1, t.z));
    if (
      above &&
      (above.name === "air" || above.name === "cave_air") &&
      getInventoryCount(bot, meta.seedItem) > 0
    ) {
      try {
        const ok = await plantOnFarmland(
          bot,
          bot.blockAt(new Vec3(t.x, t.y, t.z)),
          meta.seedItem,
          cancelGen
        );
        if (ok) planted++;
      } catch (e) {
        if (e.cancelled) throw e;
      }
    }
  }

  let deposited = 0;
  if (farm.chestPos) {
    try {
      deposited = await depositYields(bot, farm.chestPos, farm.crop, cancelGen);
    } catch (e) {
      if (e.cancelled) throw e;
      console.log("[Tend] Deposit skipped:", e.message);
    }
  }

  farmRegistry.updateFarm(farm.id, { lastTendedAt: Date.now() });

  return { harvested, planted, deposited };
}

module.exports = {
  tendFarm,
  TEND_INTERVAL_MS,
};

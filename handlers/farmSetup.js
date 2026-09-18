/**
 * Create a new 9x9 farm (center water) with chest and initial planting.
 */

const { Vec3 } = require("vec3");
const {
  completeCurrentTask,
  failTask,
  syncQueue,
  assertNotCancelled,
} = require("../utils/queue");
const { botState } = require("../state/botState");
const { farmRegistry } = require("../farming/farmRegistry");
const {
  FARM_RADIUS,
  normalizeCrop,
  getCropMeta,
  TILLABLE,
} = require("../farming/crops");
const {
  planEquipmentTasks,
  equipHoe,
  tillBlock,
  plantOnFarmland,
  fillBucketFromWater,
  placeWaterAt,
  placeBlockAt,
  boundsFromCenter,
  ensureNear,
  findHoe,
  sleep,
} = require("../farming/actions");
const { getInventoryCount } = require("../utils/inventory");

/**
 * Task: { type: 'farm_create', crop: 'wheat'|'carrot'|'potato' }
 */
async function handleFarmCreate(bot, mcData, taskQueue, task, cancelGen) {
  const gen = cancelGen ?? botState.getCancelGeneration();
  const crop = normalizeCrop(task.crop) || "wheat";
  const meta = getCropMeta(crop);

  try {
    assertNotCancelled(gen);

    // Need water source nearby OR water_bucket / ability to get bucket
    const hasWaterBucket = getInventoryCount(bot, "water_bucket") > 0;
    const nearbyWater = bot.findBlock({
      matching: mcData.blocksByName.water?.id,
      maxDistance: 48,
    });
    const needBucket = !hasWaterBucket;

    const { tasks: equipTasks, missing } = planEquipmentTasks(bot, mcData, {
      needHoe: true,
      needChest: true,
      needBucket: needBucket && !nearbyWater ? true : needBucket,
    });

    // If we need equipment crafted first, inject and retry
    if (equipTasks.length > 0) {
      bot.chat(`Gathering farm gear first...`);
      for (let i = equipTasks.length - 1; i >= 0; i--) {
        taskQueue.unshift(equipTasks[i]);
      }
      // Keep farm_create at front after gear — shift current, unshift gear, unshift create
      // Current task is farm_create at [0]. We unshifted gear in front of it. Good — gear runs first, then create retries.
      syncQueue(taskQueue);
      return;
    }

    if (missing.includes("hoe")) {
      failTask(bot, taskQueue, "I need a hoe to make a farm, but can't craft one.");
      return;
    }
    if (missing.includes("chest")) {
      failTask(bot, taskQueue, "I need a chest for farm storage, but can't craft one.");
      return;
    }

    if (!hasWaterBucket && nearbyWater) {
      bot.chat("Getting water for the farm...");
      const filled = await fillBucketFromWater(bot, gen, mcData);
      if (!filled && missing.includes("bucket")) {
        failTask(
          bot,
          taskQueue,
          "I need a bucket (and iron) to water the farm, or place water nearby."
        );
        return;
      }
      if (!filled) {
        failTask(bot, taskQueue, "Couldn't fill a water bucket.");
        return;
      }
    } else if (!hasWaterBucket && !nearbyWater) {
      if (getInventoryCount(bot, "bucket") > 0) {
        failTask(bot, taskQueue, "I have a bucket but no water nearby to fill it.");
        return;
      }
      failTask(
        bot,
        taskQueue,
        "I need water nearby (or a water bucket) to set up the farm."
      );
      return;
    }

    // Seeds check — collect by seed ITEM name (wheat_seeds → short_grass/tall_grass)
    if (getInventoryCount(bot, meta.seedItem) < 1) {
      const canForageSeeds = meta.seedCollectBlocks?.some((b) =>
        /grass/i.test(b)
      );
      if (canForageSeeds) {
        bot.chat(
          `I need ${meta.seedItem.replace(/_/g, " ")} — gathering some...`
        );
        taskQueue.unshift({
          type: "collect",
          target: meta.seedItem,
          count: Math.max(16, meta.seedReserve || 16),
        });
        syncQueue(taskQueue);
        return;
      }
      failTask(
        bot,
        taskQueue,
        `I need ${meta.seedItem} to plant the farm. Give me some or collect them first.`
      );
      return;
    }

    if (!findHoe(bot)) {
      failTask(bot, taskQueue, "I still don't have a hoe.");
      return;
    }

    const center = bot.entity.position.floored();
    // Prefer standing on dirt — use block under feet as y-1 for farmland layer
    const groundY = center.y - 1;
    const cx = center.x;
    const cz = center.z;
    const bounds = boundsFromCenter(cx, groundY, cz, FARM_RADIUS);

    bot.chat(`Building a ${crop} farm...`);
    farmRegistry.setEnabled(true);

    // Dig center hole for water if needed
    const waterPos = new Vec3(cx, groundY, cz);
    const centerBlock = bot.blockAt(waterPos);
    if (centerBlock && centerBlock.name !== "air" && centerBlock.name !== "water") {
      await ensureNear(bot, waterPos, 3, taskQueue, gen, mcData);
      assertNotCancelled(gen);
      try {
        await bot.dig(centerBlock);
        await sleep(200);
      } catch (e) {
        console.log("[FarmCreate] Dig center:", e.message);
      }
    }

    // Place water in center
    if (getInventoryCount(bot, "water_bucket") > 0) {
      await placeWaterAt(bot, waterPos, gen);
    }

    // Till all tiles except water center
    await equipHoe(bot);
    let tilled = 0;
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
        if (x === cx && z === cz) continue; // water
        assertNotCancelled(gen);
        const pos = new Vec3(x, groundY, z);
        let block = bot.blockAt(pos);
        if (!block) continue;

        // If air, skip; if grass/dirt, till
        if (block.name === "water") continue;
        if (!TILLABLE.has(block.name) && block.name !== "farmland") {
          continue;
        }
        try {
          await tillBlock(bot, block, gen);
          tilled++;
        } catch (e) {
          if (e.message === "NO_HOE" || e.cancelled) throw e;
        }
      }
    }

    // Plant
    let planted = 0;
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
        if (x === cx && z === cz) continue;
        assertNotCancelled(gen);
        const farmland = bot.blockAt(new Vec3(x, groundY, z));
        if (!farmland || farmland.name !== "farmland") continue;
        try {
          const ok = await plantOnFarmland(bot, farmland, meta.seedItem, gen);
          if (ok) planted++;
        } catch (e) {
          if (e.cancelled) throw e;
        }
        if (getInventoryCount(bot, meta.seedItem) < 1) break;
      }
      if (getInventoryCount(bot, meta.seedItem) < 1) break;
    }

    // Place chest adjacent to farm (east of edge)
    let chestPos = null;
    const chestCandidates = [
      new Vec3(bounds.maxX + 1, groundY + 1, cz),
      new Vec3(bounds.minX - 1, groundY + 1, cz),
      new Vec3(cx, groundY + 1, bounds.maxZ + 1),
      new Vec3(cx, groundY + 1, bounds.minZ - 1),
    ];

    if (getInventoryCount(bot, "chest") > 0) {
      for (const dest of chestCandidates) {
        assertNotCancelled(gen);
        // Ensure solid ground under chest
        const below = bot.blockAt(dest.offset(0, -1, 0));
        const at = bot.blockAt(dest);
        if (at && at.name !== "air") continue;
        if (!below || below.boundingBox !== "block") continue;
        try {
          const placed = await placeBlockAt(bot, "chest", dest, gen);
          if (placed) {
            chestPos = { x: dest.x, y: dest.y, z: dest.z };
            break;
          }
        } catch (e) {
          if (e.cancelled) throw e;
        }
      }
    }

    if (!chestPos) {
      // Record intended chest spot even if place failed — tend may place later
      const dest = chestCandidates[0];
      chestPos = { x: dest.x, y: dest.y, z: dest.z };
      bot.chat("Couldn't place the chest cleanly — I'll retry when tending.");
    }

    const farm = farmRegistry.addFarm({
      crop,
      origin: { x: cx, y: groundY, z: cz },
      bounds,
      chestPos,
      lastTendedAt: 0,
      status: "active",
    });

    completeCurrentTask(
      bot,
      taskQueue,
      `Farm #${farm.id} ${crop} ready (${tilled} tilled, ${planted} planted). I'll tend it when idle.`
    );
  } catch (error) {
    if (error.cancelled) {
      console.log("[FarmCreate] Cancelled");
      return;
    }
    console.error("[FarmCreate]", error.message);
    failTask(bot, taskQueue, `Farm setup failed: ${error.message}`);
  }
}

module.exports = {
  handleFarmCreate,
};

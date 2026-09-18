/**
 * Adopt an existing farmland plot near the bot.
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
  normalizeCrop,
  inferCropFromBlock,
} = require("../farming/crops");
const {
  planEquipmentTasks,
  placeBlockAt,
  findHoe,
} = require("../farming/actions");
const { getInventoryCount } = require("../utils/inventory");

/**
 * Flood-fill contiguous farmland around a start position.
 */
function floodFarmland(bot, start, maxTiles = 200) {
  const key = (p) => `${p.x},${p.y},${p.z}`;
  const visited = new Set();
  const queue = [start];
  const tiles = [];

  while (queue.length && tiles.length < maxTiles) {
    const pos = queue.shift();
    const k = key(pos);
    if (visited.has(k)) continue;
    visited.add(k);

    const block = bot.blockAt(pos);
    if (!block || block.name !== "farmland") continue;
    tiles.push(pos.clone());

    for (const off of [
      new Vec3(1, 0, 0),
      new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1),
      new Vec3(0, 0, -1),
    ]) {
      queue.push(pos.plus(off));
    }
  }
  return tiles;
}

function boundsFromTiles(tiles) {
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity,
    y = tiles[0].y;
  for (const t of tiles) {
    minX = Math.min(minX, t.x);
    maxX = Math.max(maxX, t.x);
    minZ = Math.min(minZ, t.z);
    maxZ = Math.max(maxZ, t.z);
  }
  return { minX, maxX, minZ, maxZ, y };
}

/**
 * Task: { type: 'farm_adopt', crop?: string }
 */
async function handleFarmAdopt(bot, mcData, taskQueue, task, cancelGen) {
  const gen = cancelGen ?? botState.getCancelGeneration();

  try {
    assertNotCancelled(gen);

    const { tasks: equipTasks, missing } = planEquipmentTasks(bot, mcData, {
      needHoe: true,
      needChest: true,
      needBucket: false,
    });

    if (equipTasks.length > 0) {
      bot.chat("Getting a hoe/chest before adopting the farm...");
      for (let i = equipTasks.length - 1; i >= 0; i--) {
        taskQueue.unshift(equipTasks[i]);
      }
      syncQueue(taskQueue);
      return;
    }

    if (missing.includes("hoe") && !findHoe(bot)) {
      failTask(bot, taskQueue, "I need a hoe to tend farms.");
      return;
    }

    const farmlandId = mcData.blocksByName.farmland?.id;
    if (!farmlandId) {
      failTask(bot, taskQueue, "Farmland not available in this version.");
      return;
    }

    const startFarmland = bot.findBlock({
      matching: farmlandId,
      maxDistance: 16,
    });

    if (!startFarmland) {
      failTask(
        bot,
        taskQueue,
        "I don't see any farmland nearby. Stand closer or say 'make a wheat farm here'."
      );
      return;
    }

    const tiles = floodFarmland(bot, startFarmland.position);
    if (!tiles.length) {
      failTask(bot, taskQueue, "Couldn't map the farmland plot.");
      return;
    }

    const bounds = boundsFromTiles(tiles);

    // Infer crop from plants above farmland
    let crop = normalizeCrop(task.crop);
    if (!crop) {
      for (const t of tiles) {
        const above = bot.blockAt(t.offset(0, 1, 0));
        const inferred = inferCropFromBlock(above);
        if (inferred) {
          crop = inferred;
          break;
        }
      }
    }
    crop = crop || "wheat";

    // Find nearby chest or place one
    let chestPos = null;
    const chestId = mcData.blocksByName.chest?.id;
    const nearbyChest = bot.findBlock({
      matching: chestId,
      maxDistance: 16,
      useExtraInfo: false,
    });

    // Prefer chest close to farm bounds
    if (nearbyChest) {
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cz = (bounds.minZ + bounds.maxZ) / 2;
      const dist = nearbyChest.position.distanceTo(new Vec3(cx, bounds.y, cz));
      if (dist <= 12) {
        chestPos = {
          x: nearbyChest.position.x,
          y: nearbyChest.position.y,
          z: nearbyChest.position.z,
        };
      }
    }

    if (!chestPos && getInventoryCount(bot, "chest") > 0) {
      const dest = new Vec3(bounds.maxX + 1, bounds.y + 1, Math.floor((bounds.minZ + bounds.maxZ) / 2));
      try {
        const placed = await placeBlockAt(bot, "chest", dest, gen);
        if (placed) {
          chestPos = { x: dest.x, y: dest.y, z: dest.z };
        }
      } catch (e) {
        if (e.cancelled) throw e;
      }
    }

    if (!chestPos) {
      chestPos = {
        x: bounds.maxX + 1,
        y: bounds.y + 1,
        z: Math.floor((bounds.minZ + bounds.maxZ) / 2),
      };
      bot.chat("No chest nearby — I'll use a spot beside the farm when I can place one.");
    }

    const origin = {
      x: Math.floor((bounds.minX + bounds.maxX) / 2),
      y: bounds.y,
      z: Math.floor((bounds.minZ + bounds.maxZ) / 2),
    };

    farmRegistry.setEnabled(true);
    const farm = farmRegistry.addFarm({
      crop,
      origin,
      bounds,
      chestPos,
      lastTendedAt: 0,
      status: "active",
    });

    completeCurrentTask(
      bot,
      taskQueue,
      `Adopted farm #${farm.id} (${crop}, ${tiles.length} plots). I'll tend it when idle.`
    );
  } catch (error) {
    if (error.cancelled) {
      console.log("[FarmAdopt] Cancelled");
      return;
    }
    console.error("[FarmAdopt]", error.message);
    failTask(bot, taskQueue, `Couldn't adopt farm: ${error.message}`);
  }
}

module.exports = {
  handleFarmAdopt,
  floodFarmland,
};

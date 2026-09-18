/**
 * Low-level farming actions: till, plant, harvest, water, chest deposit, tools.
 */

const { Vec3 } = require("vec3");
const { GoalNear } = require("mineflayer-pathfinder").goals;
const {
  HOE_PRIORITY,
  TILLABLE,
  getCropMeta,
  isMatureCrop,
  resolveSeedItem,
} = require("./crops");
const { getInventoryCount } = require("../utils/inventory");
const { resolveAllDependencies } = require("../utils/recipes");
const { gotoRobust } = require("../utils/pathing");
const { assertNotCancelled } = require("../utils/queue");
const { botState } = require("../state/botState");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function findHoe(bot) {
  for (const name of HOE_PRIORITY) {
    const item = bot.inventory.items().find((i) => i.name === name);
    if (item) return item;
  }
  return null;
}

async function equipHoe(bot) {
  const hoe = findHoe(bot);
  if (!hoe) return false;
  await bot.equip(hoe, "hand");
  return true;
}

/**
 * Build craft/collect tasks to acquire missing farm equipment.
 * @returns {Array} tasks to prepend, or [] if ready / empty if impossible notes via reason
 */
function planEquipmentTasks(bot, mcData, { needHoe = true, needChest = true, needBucket = false } = {}) {
  const inventoryMap = {};
  for (const item of bot.inventory.items()) {
    inventoryMap[item.name] = (inventoryMap[item.name] || 0) + item.count;
  }

  const tasks = [];
  const missing = [];

  if (needHoe && !findHoe(bot)) {
    // Prefer stone_hoe, fall back to wooden_hoe
    let resolved = resolveAllDependencies("stone_hoe", 1, mcData, inventoryMap);
    if (!resolved.feasible) {
      resolved = resolveAllDependencies("wooden_hoe", 1, mcData, inventoryMap);
    }
    if (resolved.feasible && resolved.tasks.length) {
      tasks.push(...resolved.tasks);
      // Optimistic: mark as pending so later deps don't re-request
      inventoryMap["stone_hoe"] = (inventoryMap["stone_hoe"] || 0) + 1;
    } else {
      missing.push("hoe");
    }
  }

  if (needChest && getInventoryCount(bot, "chest") < 1) {
    const resolved = resolveAllDependencies("chest", 1, mcData, inventoryMap);
    if (resolved.feasible && resolved.tasks.length) {
      tasks.push(...resolved.tasks);
      inventoryMap["chest"] = (inventoryMap["chest"] || 0) + 1;
    } else if (!resolved.feasible) {
      missing.push("chest");
    }
  }

  if (needBucket) {
    const hasBucket =
      getInventoryCount(bot, "bucket") > 0 ||
      getInventoryCount(bot, "water_bucket") > 0;
    if (!hasBucket) {
      const resolved = resolveAllDependencies("bucket", 1, mcData, inventoryMap);
      if (resolved.feasible && resolved.tasks.length) {
        tasks.push(...resolved.tasks);
      } else {
        missing.push("bucket");
      }
    }
  }

  return { tasks, missing };
}

async function ensureNear(bot, pos, range, taskQueue, cancelGen, mcData) {
  const dist = bot.entity.position.distanceTo(pos);
  if (dist <= range) return;
  await gotoRobust(bot, new GoalNear(pos.x, pos.y, pos.z, range), {
    mcData: mcData || botState.getMcData(),
    taskQueue: taskQueue || [],
    assertNotCancelled: () => assertNotCancelled(cancelGen),
    preferNoBuild: false,
    maxAttempts: 3,
  });
}

/**
 * Place a block from inventory at an absolute position (against a reference face).
 */
async function placeBlockAt(bot, itemName, destPos, cancelGen) {
  assertNotCancelled(cancelGen);
  const item = bot.inventory.items().find((i) => i.name === itemName);
  if (!item) throw new Error(`No ${itemName} to place`);

  await bot.equip(item, "hand");

  // Find a solid neighbor to place against
  const offsets = [
    new Vec3(0, -1, 0),
    new Vec3(1, 0, 0),
    new Vec3(-1, 0, 0),
    new Vec3(0, 0, 1),
    new Vec3(0, 0, -1),
    new Vec3(0, 1, 0),
  ];

  for (const off of offsets) {
    const refPos = destPos.plus(off);
    const ref = bot.blockAt(refPos);
    if (!ref || ref.boundingBox !== "block") continue;
    const face = off.scaled(-1);
    const dest = bot.blockAt(destPos);
    if (dest && dest.name !== "air" && dest.boundingBox !== "empty") {
      // already something there
      if (itemName === "water_bucket") continue;
      return false;
    }
    try {
      await ensureNear(bot, destPos, 3, [], cancelGen);
      assertNotCancelled(cancelGen);
      await bot.placeBlock(ref, face);
      return true;
    } catch (e) {
      // try next face
    }
  }
  return false;
}

async function tillBlock(bot, block, cancelGen) {
  assertNotCancelled(cancelGen);
  if (!block || !TILLABLE.has(block.name)) return false;
  if (block.name === "farmland") return true;

  const ok = await equipHoe(bot);
  if (!ok) throw new Error("NO_HOE");

  await ensureNear(bot, block.position, 3, [], cancelGen);
  assertNotCancelled(cancelGen);
  await bot.activateBlock(block);
  await sleep(150);
  return true;
}

async function plantOnFarmland(bot, farmlandBlock, seedItem, cancelGen) {
  assertNotCancelled(cancelGen);
  const above = bot.blockAt(farmlandBlock.position.offset(0, 1, 0));
  if (above && above.name !== "air" && above.boundingBox !== "empty") {
    return false;
  }

  // Accept crop key, plant block, or seed item — always equip the inventory seed item
  const seedName = resolveSeedItem(seedItem) || seedItem;
  const seed = bot.inventory.items().find((i) => i.name === seedName);
  if (!seed) return false;

  await bot.equip(seed, "hand");
  await ensureNear(bot, farmlandBlock.position, 3, [], cancelGen);
  assertNotCancelled(cancelGen);
  await bot.activateBlock(farmlandBlock);
  await sleep(150);
  return true;
}

async function harvestCrop(bot, block, cancelGen) {
  assertNotCancelled(cancelGen);
  await ensureNear(bot, block.position, 3, [], cancelGen);
  assertNotCancelled(cancelGen);
  await bot.dig(block);
  await sleep(100);
}

/**
 * Water source level (0 = still source).
 */
function getWaterLevel(block) {
  if (!block || block.name !== "water") return null;
  try {
    return Number(block.getProperties?.()?.level ?? block._properties?.level ?? 0);
  } catch (e) {
    return 0;
  }
}

function isWaterSource(block) {
  const level = getWaterLevel(block);
  return level === 0;
}

/**
 * Pick the best water block to scoop: prefer source under/at feet, else nearest source.
 */
function findScoopableWater(bot, mcData, preferredPos = null) {
  const waterId = mcData.blocksByName.water?.id;
  if (!waterId) return null;

  // If already standing in / on water, use that block (aim is relative to feet)
  const samples = [
    bot.blockAt(bot.entity.position),
    bot.blockAt(bot.entity.position.offset(0, -0.4, 0)),
    bot.blockAt(bot.entity.position.offset(0, -1, 0)),
  ];
  for (const b of samples) {
    if (isWaterSource(b)) return b;
  }
  for (const b of samples) {
    if (b && b.name === "water") return b;
  }

  if (preferredPos) {
    const b = bot.blockAt(preferredPos);
    if (b && b.name === "water") return b;
  }

  const candidates = bot.findBlocks({
    matching: waterId,
    maxDistance: 48,
    count: 32,
  });
  if (!candidates.length) return null;

  const botPos = bot.entity.position;
  candidates.sort((a, b) => botPos.distanceTo(a) - botPos.distanceTo(b));

  for (const pos of candidates) {
    const b = bot.blockAt(pos);
    if (isWaterSource(b)) return b;
  }
  return bot.blockAt(candidates[0]);
}

/**
 * Force look at a point and wait until yaw/pitch settle.
 */
async function forceLookAt(bot, point) {
  await bot.lookAt(point, true);
  // Extra tick so client head state matches before use_item
  await sleep(200);
}

/**
 * Aim at water and use the empty bucket. Tries multiple aim heights
 * (critical when standing inside the water block).
 */
async function scoopWaterWithAim(bot, waterBlock) {
  const base = waterBlock.position;
  // When inside water, looking at block center often aims past it —
  // look slightly down into the volume of the source block.
  const aimPoints = [
    base.offset(0.5, 0.15, 0.5),
    base.offset(0.5, 0.35, 0.5),
    base.offset(0.5, 0.55, 0.5),
    base.offset(0.5, 0.05, 0.5),
  ];

  for (const aim of aimPoints) {
    await forceLookAt(bot, aim);

    if (typeof bot.blockAtCursor === "function") {
      const hit = bot.blockAtCursor(5);
      console.log(
        `[Water] Aim ${aim.x.toFixed(1)},${aim.y.toFixed(1)},${aim.z.toFixed(1)} → cursor=${hit?.name || "none"}`
      );
    }

    // use_item relies on current look direction from entity state
    bot.activateItem();
    await sleep(450);

    if (getInventoryCount(bot, "water_bucket") > 0) return true;

    // Fallback: block_place targeting the water block with a low cursor hit
    try {
      await forceLookAt(bot, aim);
      await bot.activateBlock(
        waterBlock,
        new Vec3(0, 1, 0),
        new Vec3(0.5, 0.2, 0.5)
      );
      await sleep(450);
    } catch (e) {
      console.log("[Water] activateBlock failed:", e.message);
    }

    if (getInventoryCount(bot, "water_bucket") > 0) return true;
  }

  return false;
}

/**
 * Fill empty bucket from a water source block.
 * Must be next to or in the water, and looking at the water volume.
 */
async function fillBucketFromWater(bot, cancelGen, mcData) {
  assertNotCancelled(cancelGen);
  if (getInventoryCount(bot, "water_bucket") > 0) return true;

  const bucket = bot.inventory.items().find((i) => i.name === "bucket");
  if (!bucket) return false;

  let waterBlock = findScoopableWater(bot, mcData);
  if (!waterBlock) return false;

  await bot.equip(bucket, "hand");
  await sleep(100);

  const target = waterBlock.position;

  // Get within 1 block (may end up standing in the water — that's OK)
  await ensureNear(bot, target, 1, [], cancelGen, mcData);
  assertNotCancelled(cancelGen);

  // Re-resolve water at feet after pathing — that's what we should aim at
  waterBlock = findScoopableWater(bot, mcData, target) || waterBlock;
  if (!waterBlock || waterBlock.name !== "water") {
    console.log("[Water] Lost water block after pathing");
    return false;
  }

  const dist = bot.entity.position.distanceTo(
    waterBlock.position.offset(0.5, 0.5, 0.5)
  );
  console.log(
    `[Water] Scooping at ${waterBlock.position} dist=${dist.toFixed(2)} standingIn=${bot.blockAt(bot.entity.position)?.name}`
  );

  if (dist > 2.2) {
    await ensureNear(bot, waterBlock.position, 0, [], cancelGen, mcData);
    assertNotCancelled(cancelGen);
    waterBlock = findScoopableWater(bot, mcData, waterBlock.position) || waterBlock;
  }

  const ok = await scoopWaterWithAim(bot, waterBlock);
  if (ok) return true;

  // Last resort: look straight down and use item (common when fully submerged)
  await forceLookAt(
    bot,
    bot.entity.position.offset(0, -1, 0)
  );
  bot.activateItem();
  await sleep(500);

  return getInventoryCount(bot, "water_bucket") > 0;
}

/**
 * Place water from water_bucket into a hole (air block above solid).
 * Stand within 1 block and force aim into the hole.
 */
async function placeWaterAt(bot, destPos, cancelGen) {
  assertNotCancelled(cancelGen);
  const wb = bot.inventory.items().find((i) => i.name === "water_bucket");
  if (!wb) return false;

  await bot.equip(wb, "hand");
  await ensureNear(bot, destPos, 1, [], cancelGen);
  assertNotCancelled(cancelGen);

  const below = bot.blockAt(destPos.offset(0, -1, 0));
  const aim = destPos.offset(0.5, 0.15, 0.5);
  await forceLookAt(bot, aim);

  if (below && below.boundingBox === "block") {
    try {
      await bot.activateBlock(below, new Vec3(0, 1, 0), new Vec3(0.5, 0.9, 0.5));
    } catch (e) {
      bot.activateItem();
    }
  } else {
    bot.activateItem();
  }
  await sleep(450);

  return (
    getInventoryCount(bot, "water_bucket") === 0 ||
    bot.blockAt(destPos)?.name === "water"
  );
}

/**
 * Deposit excess crop yields into chest, keeping seed reserve.
 */
async function depositYields(bot, chestPos, crop, cancelGen) {
  assertNotCancelled(cancelGen);
  const meta = getCropMeta(crop);
  if (!meta || !chestPos) return 0;

  const pos = new Vec3(chestPos.x, chestPos.y, chestPos.z);
  await ensureNear(bot, pos, 3, [], cancelGen);
  assertNotCancelled(cancelGen);

  const chestBlock = bot.blockAt(pos);
  if (
    !chestBlock ||
    (chestBlock.name !== "chest" && chestBlock.name !== "trapped_chest")
  ) {
    throw new Error("Chest missing");
  }

  const chest = await bot.openChest(chestBlock);
  let deposited = 0;

  try {
    for (const yieldName of meta.yieldItems) {
      assertNotCancelled(cancelGen);
      let toDeposit = getInventoryCount(bot, yieldName);

      if (yieldName === meta.seedItem) {
        toDeposit = Math.max(0, toDeposit - meta.seedReserve);
      }

      while (toDeposit > 0) {
        const item = bot.inventory.items().find((i) => i.name === yieldName);
        if (!item) break;
        const n = Math.min(item.count, toDeposit);
        try {
          await chest.deposit(item.type, null, n);
          deposited += n;
          toDeposit -= n;
        } catch (e) {
          toDeposit = 0;
          break;
        }
      }
    }
  } finally {
    try {
      chest.close();
    } catch (e) {}
  }

  return deposited;
}

/**
 * Iterate all farmland positions in bounds.
 */
function iterFarmTiles(bounds) {
  const tiles = [];
  for (let x = bounds.minX; x <= bounds.maxX; x++) {
    for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
      tiles.push({ x, y: bounds.y, z });
    }
  }
  return tiles;
}

function boundsFromCenter(cx, cy, cz, radius) {
  return {
    minX: Math.floor(cx) - radius,
    maxX: Math.floor(cx) + radius,
    minZ: Math.floor(cz) - radius,
    maxZ: Math.floor(cz) + radius,
    y: Math.floor(cy),
  };
}

module.exports = {
  findHoe,
  equipHoe,
  planEquipmentTasks,
  ensureNear,
  placeBlockAt,
  tillBlock,
  plantOnFarmland,
  harvestCrop,
  fillBucketFromWater,
  placeWaterAt,
  depositYields,
  iterFarmTiles,
  boundsFromCenter,
  sleep,
};

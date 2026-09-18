/**
 * Crop metadata for wheat / carrot / potato farming.
 * Keeps item names (inventory) and block names (world) distinct.
 */

const CROPS = {
  wheat: {
    name: "wheat",
    /** Inventory item used to plant */
    seedItem: "wheat_seeds",
    /** Block that grows on farmland */
    plantBlock: "wheat",
    /** Harvested items (inventory names) */
    yieldItems: ["wheat", "wheat_seeds"],
    /**
     * Blocks to break when gathering seedItem from the wild.
     * Order: prefer modern short_grass, then tall_grass, then legacy "grass" (≤1.20.2).
     */
    seedCollectBlocks: ["short_grass", "tall_grass", "grass"],
    matureAge: 7,
    seedReserve: 16,
    aliases: [
      "wheat",
      "wheat farm",
      "wheat_seeds",
      "wheat seeds",
      "seeds",
    ],
  },
  carrot: {
    name: "carrot",
    seedItem: "carrot",
    plantBlock: "carrots",
    yieldItems: ["carrot"],
    seedCollectBlocks: ["carrots"],
    matureAge: 7,
    seedReserve: 8,
    aliases: ["carrot", "carrots", "carrot farm"],
  },
  potato: {
    name: "potato",
    seedItem: "potato",
    plantBlock: "potatoes",
    yieldItems: ["potato", "poisonous_potato"],
    seedCollectBlocks: ["potatoes"],
    matureAge: 7,
    seedReserve: 8,
    aliases: ["potato", "potatoes", "potato farm"],
  },
};

const TILLABLE = new Set([
  "dirt",
  "grass_block",
  "dirt_path",
  "coarse_dirt",
  "rooted_dirt",
  "farmland",
]);

const HOE_PRIORITY = [
  "netherite_hoe",
  "diamond_hoe",
  "iron_hoe",
  "stone_hoe",
  "golden_hoe",
  "wooden_hoe",
];

/** Default create plot: 9x9 with center water */
const FARM_RADIUS = 4; // farmland from -4..4 inclusive = 9x9
const TEND_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes between tends per farm

function toSnake(input) {
  return String(input)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_");
}

/**
 * Normalize any farm-related phrase/item/block name to a crop key.
 * Accepts: wheat, wheat_seeds, seeds, carrots, potatoes, etc.
 */
function normalizeCrop(input) {
  if (!input) return null;
  const raw = toSnake(input);

  if (CROPS[raw]) return raw;

  for (const [key, meta] of Object.entries(CROPS)) {
    if (raw === meta.seedItem || raw === meta.plantBlock || raw === meta.name) {
      return key;
    }
    if (meta.yieldItems.includes(raw)) return key;
    if (meta.seedCollectBlocks?.includes(raw)) return key;

    for (const alias of meta.aliases) {
      const a = toSnake(alias);
      if (raw === a || raw.includes(a) || a.includes(raw)) return key;
    }

    if (raw.includes(key)) return key;
  }
  return null;
}

function getCropMeta(crop) {
  const key = normalizeCrop(crop) || crop;
  return CROPS[key] || null;
}

/**
 * Resolve a farming-related name to item/block roles for collect/plant.
 * @returns {{ crop: string, seedItem: string, plantBlock: string, itemToCount: string, blocksToMine: string[] }|null}
 */
function resolveFarmingTerm(input) {
  const crop = normalizeCrop(input);
  if (!crop) return null;
  const meta = CROPS[crop];
  const raw = toSnake(input);

  // Default: treat as needing seeds (most farm ops)
  let itemToCount = meta.seedItem;
  let blocksToMine = [...(meta.seedCollectBlocks || [meta.plantBlock])];

  // Explicit crop harvest item (wheat, and not "wheat_seeds")
  if (raw === meta.name && raw !== meta.seedItem) {
    itemToCount = meta.name;
    blocksToMine = [meta.plantBlock];
  }

  // Explicit seed item / "seeds"
  if (raw === meta.seedItem || raw === "seeds" || raw.endsWith("_seeds")) {
    itemToCount = meta.seedItem;
    blocksToMine = [...(meta.seedCollectBlocks || [meta.plantBlock])];
  }

  // Plant block name (carrots / potatoes / wheat) → harvest that crop's main yield
  if (raw === meta.plantBlock) {
    itemToCount = meta.name;
    blocksToMine = [meta.plantBlock];
  }

  // Other yield items (e.g. poisonous_potato)
  if (meta.yieldItems.includes(raw) && raw !== meta.seedItem) {
    itemToCount = raw;
    blocksToMine = [meta.plantBlock];
  }

  return {
    crop,
    seedItem: meta.seedItem,
    plantBlock: meta.plantBlock,
    itemToCount,
    blocksToMine,
  };
}

/**
 * Canonical seed item name for planting (never a plant block name).
 */
function resolveSeedItem(input) {
  const meta = getCropMeta(input);
  if (meta) return meta.seedItem;
  const raw = toSnake(input || "");
  // Already an item name used as seed
  for (const m of Object.values(CROPS)) {
    if (raw === m.seedItem) return m.seedItem;
  }
  return raw || null;
}

function isMatureCrop(block, crop) {
  const meta = getCropMeta(crop);
  if (!meta || !block) return false;
  if (block.name !== meta.plantBlock) return false;

  let age = 0;
  try {
    if (typeof block.getProperties === "function") {
      age = Number(block.getProperties().age ?? 0);
    } else if (block._properties?.age != null) {
      age = Number(block._properties.age);
    } else if (block.metadata != null) {
      age = Number(block.metadata);
    }
  } catch (e) {
    age = Number(block.metadata ?? 0);
  }
  return age >= meta.matureAge;
}

function isCropPlant(block) {
  if (!block) return false;
  return Object.values(CROPS).some((c) => c.plantBlock === block.name);
}

function inferCropFromBlock(block) {
  if (!block) return null;
  for (const [key, meta] of Object.entries(CROPS)) {
    if (block.name === meta.plantBlock) return key;
  }
  return null;
}

module.exports = {
  CROPS,
  TILLABLE,
  HOE_PRIORITY,
  FARM_RADIUS,
  TEND_INTERVAL_MS,
  normalizeCrop,
  getCropMeta,
  resolveFarmingTerm,
  resolveSeedItem,
  isMatureCrop,
  isCropPlant,
  inferCropFromBlock,
};

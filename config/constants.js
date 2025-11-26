/**
 * Configuration constants for the Minecraft bot
 */

/**
 * Maps items to the blocks that need to be mined to obtain them.
 * Some items (like cobblestone) don't exist as blocks - you get them by mining other blocks.
 */
const ITEM_TO_BLOCK_SOURCE = {
  // Stone drops cobblestone when mined (without silk touch)
  cobblestone: "stone",
  // Ores drop items
  diamond: "diamond_ore",
  coal: "coal_ore",
  emerald: "emerald_ore",
  lapis_lazuli: "lapis_ore",
  redstone: "redstone_ore",
  raw_iron: "iron_ore",
  raw_gold: "gold_ore",
  raw_copper: "copper_ore",
  // Deepslate variants
  deepslate_cobblestone: "deepslate",
  // Nether
  quartz: "nether_quartz_ore",
  gold_nugget: "nether_gold_ore",
  // Gravel drops flint sometimes
  flint: "gravel",
  // Glowstone drops dust
  glowstone_dust: "glowstone",
};

/**
 * Maps crafted items to their raw collectable materials
 * Used when we need to gather resources for crafting
 */
const ITEM_TO_RAW_MATERIAL = {
  // Planks come from logs
  oak_planks: { collect: "oak_log", ratio: 4 }, // 1 log = 4 planks
  birch_planks: { collect: "birch_log", ratio: 4 },
  spruce_planks: { collect: "spruce_log", ratio: 4 },
  jungle_planks: { collect: "jungle_log", ratio: 4 },
  acacia_planks: { collect: "acacia_log", ratio: 4 },
  dark_oak_planks: { collect: "dark_oak_log", ratio: 4 },
  // Sticks require planks (which require logs)
  stick: { craft: "oak_planks", craftCount: 2, ratio: 4 }, // 2 planks = 4 sticks
  // Direct collectables
  cobblestone: { collect: "cobblestone", ratio: 1 }, // handleCollect maps this to "stone"
  diamond: { collect: "diamond_ore", ratio: 1 },
  iron_ingot: { smelt: "raw_iron", collect: "iron_ore", ratio: 1 },
  coal: { collect: "coal_ore", ratio: 1 },
  // Crafting table requires planks
  crafting_table: { craft: "oak_planks", craftCount: 4, ratio: 1 },
};

module.exports = {
  ITEM_TO_BLOCK_SOURCE,
  ITEM_TO_RAW_MATERIAL,
};

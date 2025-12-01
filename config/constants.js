/**
 * Configuration constants for the Minecraft bot
 */

/**
 * Maps items to the blocks that need to be mined to obtain them.
 * Some items (like cobblestone) don't exist as blocks - you get them by mining other blocks.
 * This is used by the dependency resolver to determine what block to collect for a given item.
 */
const ITEM_TO_BLOCK_SOURCE = {
  // Stone drops cobblestone when mined (without silk touch)
  cobblestone: "stone",
  
  // Overworld ores drop items (fortune affects some)
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
  
  // Deepslate ores (same drops as regular ores)
  // diamond: "deepslate_diamond_ore", // already mapped above, would need special handling
  
  // Nether blocks and ores
  quartz: "nether_quartz_ore",
  gold_nugget: "nether_gold_ore",
  
  // Gravel drops flint sometimes (10% base chance)
  flint: "gravel",
  
  // Glowstone drops dust (2-4 dust per block)
  glowstone_dust: "glowstone",
  
  // Amethyst
  amethyst_shard: "amethyst_cluster",
  
  // Crops and plants
  wheat: "wheat", // Breaking mature wheat gives wheat item
  wheat_seeds: "grass", // Also from breaking wheat
  beetroot: "beetroots",
  beetroot_seeds: "beetroots",
  carrot: "carrots",
  potato: "potatoes",
  
  // String from cobwebs (shears give cobweb block, sword gives string)
  string: "cobweb",
  
  // Sea stuff
  prismarine_crystals: "sea_lantern",
  prismarine_shard: "prismarine", // Also from guardians
  
  // Ice variants
  ice: "packed_ice", // Mining packed ice with silk touch logic varies
  
  // Leaves drop sticks and saplings but that's random
  // apple: "oak_leaves", // Random drop, not reliable
  
  // Clay
  clay_ball: "clay",
  
  // Snow
  snowball: "snow", // Snow layer
  snow_block: "snow_block", // Requires silk touch otherwise drops snowballs
  
  // Sculk
  sculk_catalyst: "sculk_catalyst", // Drops XP, no item without silk touch
};

/**
 * Maps crafted items to their raw collectable materials
 * NOTE: This mapping is now largely superseded by the recursive dependency resolver
 * in utils/recipes.js which uses minecraft-data recipes directly.
 * Kept for backwards compatibility and edge cases.
 * @deprecated Use resolveAllDependencies() from utils/recipes.js instead
 */
const ITEM_TO_RAW_MATERIAL = {
  // Planks come from logs
  oak_planks: { collect: "oak_log", ratio: 4 }, // 1 log = 4 planks
  birch_planks: { collect: "birch_log", ratio: 4 },
  spruce_planks: { collect: "spruce_log", ratio: 4 },
  jungle_planks: { collect: "jungle_log", ratio: 4 },
  acacia_planks: { collect: "acacia_log", ratio: 4 },
  dark_oak_planks: { collect: "dark_oak_log", ratio: 4 },
  mangrove_planks: { collect: "mangrove_log", ratio: 4 },
  cherry_planks: { collect: "cherry_log", ratio: 4 },
  bamboo_planks: { collect: "bamboo_block", ratio: 2 }, // 1 bamboo block = 2 planks
  crimson_planks: { collect: "crimson_stem", ratio: 4 },
  warped_planks: { collect: "warped_stem", ratio: 4 },
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

/**
 * Maps smelted items to their input items and default fuel.
 * Used by the dependency resolver to queue smelting tasks.
 * 
 * Format: outputItem -> { input: inputItem, fuelPerItem: fuelNeeded }
 * fuelPerItem is how many items one piece of coal can smelt (coal smelts 8 items)
 */
const SMELTABLE_ITEMS = {
  // Ingots from raw ores
  iron_ingot: { input: "raw_iron", fuelPerItem: 1/8 },
  gold_ingot: { input: "raw_gold", fuelPerItem: 1/8 },
  copper_ingot: { input: "raw_copper", fuelPerItem: 1/8 },
  
  // Ingots from ore blocks (silk touch)
  // iron_ingot: { input: "iron_ore", fuelPerItem: 1/8 }, // raw_iron is more common
  
  // Netherite
  netherite_scrap: { input: "ancient_debris", fuelPerItem: 1/8 },
  
  // Glass and terracotta
  glass: { input: "sand", fuelPerItem: 1/8 },
  terracotta: { input: "clay", fuelPerItem: 1/8 }, // Actually clay_ball makes brick
  brick: { input: "clay_ball", fuelPerItem: 1/8 },
  nether_brick: { input: "netherrack", fuelPerItem: 1/8 },
  
  // Stone variants
  stone: { input: "cobblestone", fuelPerItem: 1/8 },
  smooth_stone: { input: "stone", fuelPerItem: 1/8 },
  smooth_sandstone: { input: "sandstone", fuelPerItem: 1/8 },
  smooth_red_sandstone: { input: "red_sandstone", fuelPerItem: 1/8 },
  smooth_quartz: { input: "quartz_block", fuelPerItem: 1/8 },
  smooth_basalt: { input: "basalt", fuelPerItem: 1/8 },
  cracked_stone_bricks: { input: "stone_bricks", fuelPerItem: 1/8 },
  cracked_deepslate_bricks: { input: "deepslate_bricks", fuelPerItem: 1/8 },
  cracked_deepslate_tiles: { input: "deepslate_tiles", fuelPerItem: 1/8 },
  cracked_nether_bricks: { input: "nether_bricks", fuelPerItem: 1/8 },
  cracked_polished_blackstone_bricks: { input: "polished_blackstone_bricks", fuelPerItem: 1/8 },
  deepslate: { input: "cobbled_deepslate", fuelPerItem: 1/8 },
  
  // Food
  cooked_beef: { input: "beef", fuelPerItem: 1/8 },
  cooked_porkchop: { input: "porkchop", fuelPerItem: 1/8 },
  cooked_chicken: { input: "chicken", fuelPerItem: 1/8 },
  cooked_mutton: { input: "mutton", fuelPerItem: 1/8 },
  cooked_rabbit: { input: "rabbit", fuelPerItem: 1/8 },
  cooked_cod: { input: "cod", fuelPerItem: 1/8 },
  cooked_salmon: { input: "salmon", fuelPerItem: 1/8 },
  baked_potato: { input: "potato", fuelPerItem: 1/8 },
  dried_kelp: { input: "kelp", fuelPerItem: 1/8 },
  
  // Charcoal (alternative fuel source)
  charcoal: { input: "oak_log", fuelPerItem: 1/8 }, // Any log works
  
  // Dyes
  green_dye: { input: "cactus", fuelPerItem: 1/8 },
  lime_dye: { input: "sea_pickle", fuelPerItem: 1/8 },
  
  // Misc
  sponge: { input: "wet_sponge", fuelPerItem: 1/8 },
  popped_chorus_fruit: { input: "chorus_fruit", fuelPerItem: 1/8 },
};

/**
 * Default fuel items in order of preference (most common/efficient first)
 */
const FUEL_ITEMS = [
  { name: "coal", burnTime: 8 },        // Smelts 8 items
  { name: "charcoal", burnTime: 8 },    // Smelts 8 items
  { name: "oak_log", burnTime: 1.5 },   // Smelts 1.5 items (any log)
  { name: "oak_planks", burnTime: 1.5 },// Smelts 1.5 items (any planks)
  { name: "stick", burnTime: 0.5 },     // Smelts 0.5 items
  { name: "coal_block", burnTime: 80 }, // Smelts 80 items
  { name: "lava_bucket", burnTime: 100 },// Smelts 100 items
  { name: "blaze_rod", burnTime: 12 },  // Smelts 12 items
];

module.exports = {
  ITEM_TO_BLOCK_SOURCE,
  ITEM_TO_RAW_MATERIAL,
  SMELTABLE_ITEMS,
  FUEL_ITEMS,
};

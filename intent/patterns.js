/**
 * Alias map and regex helpers for gathering-buddy intent parsing.
 */

/** Common spoken names → exact minecraft-data names */
const ITEM_ALIASES = {
  // Logs / wood
  "oak log": "oak_log",
  "oak logs": "oak_log",
  log: "oak_log",
  logs: "oak_log",
  wood: "oak_log",
  "birch log": "birch_log",
  "spruce log": "spruce_log",
  "jungle log": "jungle_log",
  "acacia log": "acacia_log",
  "dark oak log": "dark_oak_log",
  "cherry log": "cherry_log",
  "mangrove log": "mangrove_log",

  // Planks
  planks: "oak_planks",
  "oak planks": "oak_planks",
  "wooden planks": "oak_planks",

  // Tools / gear
  "wooden pickaxe": "wooden_pickaxe",
  "wood pickaxe": "wooden_pickaxe",
  "wooden pick": "wooden_pickaxe",
  "stone pickaxe": "stone_pickaxe",
  "stone pick": "stone_pickaxe",
  "iron pickaxe": "iron_pickaxe",
  "iron pick": "iron_pickaxe",
  "diamond pickaxe": "diamond_pickaxe",
  "diamond pick": "diamond_pickaxe",
  "wooden axe": "wooden_axe",
  "stone axe": "stone_axe",
  "iron axe": "iron_axe",
  "wooden sword": "wooden_sword",
  "stone sword": "stone_sword",
  "iron sword": "iron_sword",
  "wooden shovel": "wooden_shovel",
  "stone shovel": "stone_shovel",
  "iron shovel": "iron_shovel",
  "wooden hoe": "wooden_hoe",
  "crafting table": "crafting_table",
  workbench: "crafting_table",
  furnace: "furnace",
  chest: "chest",
  torch: "torch",
  torches: "torch",
  stick: "stick",
  sticks: "stick",

  // Ores / metals
  iron: "iron_ingot",
  "iron ingot": "iron_ingot",
  "iron ingots": "iron_ingot",
  "raw iron": "raw_iron",
  "iron ore": "iron_ore",
  gold: "gold_ingot",
  "gold ingot": "gold_ingot",
  "raw gold": "raw_gold",
  "gold ore": "gold_ore",
  copper: "copper_ingot",
  "copper ingot": "copper_ingot",
  "raw copper": "raw_copper",
  coal: "coal",
  "coal ore": "coal_ore",
  diamond: "diamond",
  diamonds: "diamond",
  "diamond ore": "diamond_ore",
  cobble: "cobblestone",
  cobblestone: "cobblestone",
  stone: "stone",
  dirt: "dirt",
  sand: "sand",
  gravel: "gravel",
  glass: "glass",
  charcoal: "charcoal",

  // Food
  beef: "beef",
  steak: "cooked_beef",
  "cooked beef": "cooked_beef",
  pork: "porkchop",
  "porkchop": "porkchop",
  "cooked pork": "cooked_porkchop",
  "cooked porkchop": "cooked_porkchop",
};

/**
 * Normalize free text into a candidate minecraft name (underscored).
 */
function toSnakeCandidate(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s_]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Resolve a spoken item phrase to an exact name using aliases + mcData.
 * @returns {string|null}
 */
function resolveItemName(phrase, mcData) {
  if (!phrase) return null;
  const cleaned = phrase
    .toLowerCase()
    .trim()
    .replace(/^(some|a|an|the|my)\s+/i, "")
    .replace(/[?.!,]+$/g, "")
    .trim();

  if (ITEM_ALIASES[cleaned]) {
    return ITEM_ALIASES[cleaned];
  }

  const snake = toSnakeCandidate(cleaned);
  if (ITEM_ALIASES[snake.replace(/_/g, " ")]) {
    return ITEM_ALIASES[snake.replace(/_/g, " ")];
  }

  if (mcData) {
    if (mcData.itemsByName[snake] || mcData.blocksByName[snake]) {
      return snake;
    }
    // Plural strip
    if (snake.endsWith("s")) {
      const singular = snake.slice(0, -1);
      if (mcData.itemsByName[singular] || mcData.blocksByName[singular]) {
        return singular;
      }
    }
    if (snake.endsWith("es")) {
      const singular = snake.slice(0, -2);
      if (mcData.itemsByName[singular] || mcData.blocksByName[singular]) {
        return singular;
      }
    }
  }

  return snake || null;
}

/**
 * Try each gathering pattern. Returns a Goal or null.
 * Goal: { intent, item?, count?, player?, block?, input?, output? }
 */
function matchPatterns(message, context = {}) {
  const { speaker = null, mcData = null } = context;
  const text = message.toLowerCase().trim().replace(/[?.!]+$/g, "");

  // stop
  if (/^(stop|halt|cancel|nevermind|never mind)$/i.test(text)) {
    return { intent: "stop" };
  }

  // inventory
  if (
    /^(inventory|inv|what('s| is) in your inventory|what do you have|show inventory)$/i.test(
      text
    ) ||
    /what.*(have|carrying|inventory)/i.test(text)
  ) {
    return { intent: "inventory" };
  }

  // come to me / come here
  if (/^(come( to me)?|come here|here|come)$/i.test(text)) {
    return { intent: "move", player: speaker };
  }

  // follow [me|player]
  let m = text.match(/^follow(?:\s+(me|[\w]+))?$/i);
  if (m) {
    const who = !m[1] || m[1] === "me" ? speaker : m[1];
    return { intent: "follow", player: who };
  }

  // go to / find <block>
  m = text.match(/^(?:go to|find|navigate to)(?:\s+the)?\s+(.+)$/i);
  if (m) {
    const block = resolveItemName(m[1], mcData);
    return { intent: "move", block };
  }

  // bring / give / drop me [N] <item>
  m = text.match(
    /^(?:bring|give|drop|hand|deliver)(?:\s+(?:me|us))?\s+(?:(\d+)\s+)?(.+)$/i
  );
  if (m) {
    const count = m[1] ? parseInt(m[1], 10) : 1;
    const item = resolveItemName(m[2], mcData);
    return { intent: "give", item, count, player: speaker };
  }

  // make / craft / build [me] [N] <item>
  m = text.match(
    /^(?:make|craft|build|create)(?:\s+(?:me|us))?\s+(?:(?:a|an)\s+)?(?:(\d+)\s+)?(.+)$/i
  );
  if (m) {
    const count = m[1] ? parseInt(m[1], 10) : 1;
    const item = resolveItemName(m[2], mcData);
    return { intent: "craft", item, count };
  }

  // smelt [N] <item>
  m = text.match(/^smelt\s+(?:(\d+)\s+)?(.+)$/i);
  if (m) {
    const count = m[1] ? parseInt(m[1], 10) : 1;
    const item = resolveItemName(m[2], mcData);
    return { intent: "smelt", item, count };
  }

  // collect / get / mine / gather / dig [N] <item>
  m = text.match(
    /^(?:collect|get|mine|gather|dig|grab|fetch)(?:\s+(?:me|us))?\s+(?:(\d+)\s+)?(.+)$/i
  );
  if (m) {
    const count = m[1] ? parseInt(m[1], 10) : 1;
    const item = resolveItemName(m[2], mcData);
    return { intent: "collect", item, count };
  }

  // "<N> <item>" shorthand → collect
  m = text.match(/^(\d+)\s+(.+)$/i);
  if (m) {
    const item = resolveItemName(m[2], mcData);
    if (item) {
      return { intent: "collect", item, count: parseInt(m[1], 10) };
    }
  }

  return null;
}

module.exports = {
  ITEM_ALIASES,
  resolveItemName,
  matchPatterns,
  toSnakeCandidate,
};

/**
 * Robust pathfinding helpers.
 * - Bridge/pillar with safe surplus filler instead of failed parkour jumps
 * - Never scaffold with blocks reserved for upcoming craft/smelt/place/give steps
 * - Enable 1x1 towers when scaffolding is available (avoids jump-in-place spam)
 */

const { Movements } = require("mineflayer-pathfinder");
const {
  getRecipes,
  getRecipeIngredients,
  selectBestRecipe,
} = require("./recipes");
const { getInventoryCount } = require("./inventory");

/** Blocks the bot should never dig while pathing */
const PROTECTED_BLOCKS = [
  "crafting_table",
  "furnace",
  "lit_furnace",
  "blast_furnace",
  "lit_blast_furnace",
  "smoker",
  "chest",
  "trapped_chest",
  "barrel",
  "ender_chest",
  "hopper",
  "dropper",
  "dispenser",
];

/** Never use these as scaffolding even with surplus */
const NEVER_SCAFFOLD = new Set([
  "crafting_table",
  "furnace",
  "blast_furnace",
  "smoker",
  "chest",
  "barrel",
  "torch",
  "stick",
  "coal",
  "charcoal",
  "ladder",
]);

/**
 * Preferred pathing filler — dirt-likes first so craft mats stay untouched.
 */
const PREFERRED_SCAFFOLD = [
  "dirt",
  "coarse_dirt",
  "rooted_dirt",
  "grass_block",
  "podzol",
  "mycelium",
  "mud",
  "packed_mud",
  "netherrack",
  "cobbled_deepslate",
  "tuff",
  "calcite",
  "andesite",
  "diorite",
  "granite",
  "basalt",
  "smooth_basalt",
  "blackstone",
  "end_stone",
  "terracotta",
  "sandstone",
  "red_sandstone",
  "soul_sand",
  "soul_soil",
];

/** Only if surplus after reserved craft ingredients */
const FALLBACK_SCAFFOLD = [
  "cobblestone",
  "mossy_cobblestone",
  "stone",
  "deepslate",
];

/**
 * How many of each item the remaining queue still needs.
 */
function getReservedItemCounts(taskQueue, mcData) {
  const reserved = {};

  const add = (name, count) => {
    if (!name || !count || count <= 0) return;
    reserved[name] = (reserved[name] || 0) + count;
  };

  if (!taskQueue) return reserved;

  for (const task of taskQueue) {
    if (!task || !task.type) continue;

    switch (task.type) {
      case "craft": {
        if (!mcData || !task.target) break;
        const recipes = getRecipes(task.target, mcData);
        if (!recipes.length) break;
        const recipe = selectBestRecipe
          ? selectBestRecipe(recipes, mcData)
          : recipes[0];
        const ingredients = getRecipeIngredients(recipe, mcData);
        const outputPer = recipe.result?.count || 1;
        const times = Math.ceil((task.count || 1) / outputPer);
        for (const ing of ingredients) {
          add(ing.name, ing.count * times);
        }
        break;
      }
      case "smelt":
        add(task.input, task.count || 1);
        add("coal", Math.ceil((task.count || 1) / 8));
        add("charcoal", Math.ceil((task.count || 1) / 8));
        break;
      case "place":
        add(task.target, task.count || 1);
        break;
      case "give":
        add(task.target, task.count || 1);
        break;
      default:
        break;
    }
  }

  return reserved;
}

/**
 * Item IDs safe to use as scaffolding given inventory + reserved counts.
 * Dirt-like fillers are never treated as "reserved" for pathing purposes
 * unless an explicit place/give task needs them.
 */
function getSafeScaffoldingIds(bot, mcData, reserved) {
  const ids = [];
  const seen = new Set();

  const tryAdd = (name, { ignoreReserved = false } = {}) => {
    if (!name || seen.has(name) || NEVER_SCAFFOLD.has(name)) return;
    const item = mcData.itemsByName[name];
    if (!item) return;

    const have = getInventoryCount(bot, name);
    if (have <= 0) return;

    const need = ignoreReserved ? 0 : reserved[name] || 0;
    const surplus = have - need;
    if (surplus <= 0) return;

    seen.add(name);
    ids.push(item.id);
  };

  // Dirt-family: always usable as pathing fuel (almost never a craft ingredient)
  for (const name of [
    "dirt",
    "coarse_dirt",
    "rooted_dirt",
    "grass_block",
    "podzol",
    "mycelium",
    "mud",
    "packed_mud",
    "netherrack",
  ]) {
    tryAdd(name, { ignoreReserved: true });
  }

  for (const name of PREFERRED_SCAFFOLD) tryAdd(name);
  for (const name of FALLBACK_SCAFFOLD) tryAdd(name);

  return ids;
}

function clearMovementControls(bot) {
  try {
    bot.clearControlStates();
  } catch (e) {
    try {
      bot.setControlState("jump", false);
      bot.setControlState("forward", false);
      bot.setControlState("sprint", false);
      bot.setControlState("sneak", false);
    } catch (e2) {}
  }
}

/**
 * Build and apply Movements tuned for reliable traversal.
 *
 * @param {Object} options
 * @param {boolean} [options.allowBuild=true]
 * @param {boolean} [options.canDig=true]
 * @param {number} [options.thinkTimeout=15000]
 * @param {boolean} [options.strictNoBuild=false]
 * @param {boolean} [options.allowParkour=false]
 * @param {boolean} [options.allowTowers=true] - pillar up when scaffolding available
 */
function applyPathingMovements(bot, mcData, taskQueue, options = {}) {
  const {
    allowBuild = true,
    canDig = true,
    thinkTimeout = 15000,
    strictNoBuild = false,
    allowParkour = false,
    allowTowers = true,
  } = options;

  const reserved = getReservedItemCounts(taskQueue, mcData);
  const moves = new Movements(bot);

  const scaffoldIds = getSafeScaffoldingIds(bot, mcData, reserved);
  const canActuallyBuild =
    !strictNoBuild && allowBuild && scaffoldIds.length > 0;

  moves.canDig = canDig;
  moves.canBuild = canActuallyBuild;
  moves.scafoldingBlocks = canActuallyBuild ? scaffoldIds : [];

  // Pillar when we have blocks — prevents jump-spam trying to climb
  moves.allow1by1towers = canActuallyBuild && allowTowers;

  // Parkour causes jump-in-place loops; only as last-resort escape
  moves.allowParkour = !!allowParkour && !canActuallyBuild;
  moves.allowSprinting = true;
  moves.allowFreeMotion = false;

  // Mild preference for dig/walk, but bridging must stay cheap enough to beat jumps
  moves.digCost = 1;
  moves.placeCost = canActuallyBuild ? 2 : 100;
  moves.scafoldingCost = canActuallyBuild ? 3 : 100;
  moves.maxDropDown = 4;

  for (const name of PROTECTED_BLOCKS) {
    const block = mcData.blocksByName[name];
    if (block) moves.blocksCantBreak.add(block.id);
  }

  bot.pathfinder.setMovements(moves);
  bot.pathfinder.thinkTimeout = thinkTimeout;

  console.log(
    `[Pathing] canBuild=${moves.canBuild} towers=${moves.allow1by1towers} parkour=${moves.allowParkour} scaffolds=${scaffoldIds.length} reserved=${JSON.stringify(reserved)}`
  );

  return moves;
}

/**
 * Path to a goal with escalating strategies.
 * Default: scaffold+tower first (reliable). Parkour only as last resort.
 */
async function gotoRobust(bot, goal, context = {}) {
  const {
    mcData,
    taskQueue = [],
    assertNotCancelled = () => {},
    preferNoBuild = false,
    maxAttempts = 3,
  } = context;

  // Workstation approach: try dig-only briefly, then scaffold (don't jump forever)
  // General navigation: scaffold+tower first so gaps/height changes work
  const strategies = preferNoBuild
    ? [
        {
          strictNoBuild: true,
          canDig: true,
          allowParkour: false,
          thinkTimeout: 10000,
          label: "workstation-dig",
        },
        {
          strictNoBuild: false,
          canDig: true,
          allowParkour: false,
          allowTowers: true,
          thinkTimeout: 18000,
          label: "workstation-scaffold",
        },
        {
          strictNoBuild: false,
          canDig: true,
          allowParkour: true,
          allowTowers: true,
          thinkTimeout: 22000,
          label: "workstation-last-resort",
        },
      ]
    : [
        {
          strictNoBuild: false,
          canDig: true,
          allowParkour: false,
          allowTowers: true,
          thinkTimeout: 15000,
          label: "scaffold-tower",
        },
        {
          strictNoBuild: false,
          canDig: true,
          allowParkour: false,
          allowTowers: true,
          thinkTimeout: 25000,
          label: "scaffold-tower-long",
        },
        {
          strictNoBuild: true,
          canDig: true,
          allowParkour: true,
          allowTowers: false,
          thinkTimeout: 20000,
          label: "dig-parkour-fallback",
        },
      ];

  let lastError;
  const attempts = Math.min(maxAttempts, strategies.length);

  for (let i = 0; i < attempts; i++) {
    const strategy = strategies[i];
    assertNotCancelled();
    clearMovementControls(bot);

    console.log(`[Pathing] Attempt ${i + 1}/${attempts} (${strategy.label})`);
    applyPathingMovements(bot, mcData, taskQueue, {
      strictNoBuild: strategy.strictNoBuild,
      canDig: strategy.canDig,
      thinkTimeout: strategy.thinkTimeout,
      allowParkour: strategy.allowParkour,
      allowTowers: strategy.allowTowers !== false,
    });

    try {
      await bot.pathfinder.goto(goal);
      clearMovementControls(bot);
      return;
    } catch (err) {
      lastError = err;
      if (err.cancelled) throw err;
      console.log(
        `[Pathing] Strategy "${strategy.label}" failed: ${err.message}`
      );

      clearMovementControls(bot);
      try {
        bot.pathfinder.setGoal(null);
        bot.pathfinder.stop();
      } catch (e) {}

      // Brief pause so physics settles before repath (reduces jump lock)
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  clearMovementControls(bot);
  throw lastError || new Error("Pathfinding failed");
}

function shouldPreferNoBuild(task) {
  if (!task) return false;
  if (task.noBuild) return true;
  const block =
    typeof task.block === "string" ? task.block : task.block?.name;
  if (!block) return false;
  return (
    block.includes("crafting_table") ||
    block.includes("furnace") ||
    block.includes("smoker") ||
    block.includes("chest") ||
    block.includes("barrel")
  );
}

module.exports = {
  getReservedItemCounts,
  getSafeScaffoldingIds,
  applyPathingMovements,
  gotoRobust,
  shouldPreferNoBuild,
  clearMovementControls,
  PROTECTED_BLOCKS,
  PREFERRED_SCAFFOLD,
};

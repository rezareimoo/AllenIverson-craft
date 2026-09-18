/**
 * Collection task handler
 */

const {
  BLOCK_TO_ITEM_DROP,
  DEEPSLATE_ORE_VARIANTS,
  blockSourcesForItem,
} = require("../config/constants");
const {
  completeCurrentTask,
  failTask,
  assertNotCancelled,
} = require("../utils/queue");
const { getInventoryCount } = require("../utils/inventory");
const {
  validateAndCorrectName,
  getSuggestions,
} = require("../utils/blockNames");
const { botState } = require("../state/botState");
const { applyPathingMovements } = require("../utils/pathing");
const { resolveFarmingTerm } = require("../farming/crops");

/** Pickaxe preference for ore/stone (best first) */
const PICKAXES = [
  "netherite_pickaxe",
  "diamond_pickaxe",
  "iron_pickaxe",
  "stone_pickaxe",
  "golden_pickaxe",
  "wooden_pickaxe",
];

const AXES = [
  "netherite_axe",
  "diamond_axe",
  "iron_axe",
  "stone_axe",
  "golden_axe",
  "wooden_axe",
];

const SHOVELS = [
  "netherite_shovel",
  "diamond_shovel",
  "iron_shovel",
  "stone_shovel",
  "golden_shovel",
  "wooden_shovel",
];

/**
 * Resolve what block(s) to mine and which inventory item to count.
 * @returns {{ blocksToMine: string[], itemToCount: string }}
 */
function resolveCollectTargets(target) {
  // Item → block source(s) (coal→coal_ore, wheat_seeds→short_grass/tall_grass/grass)
  const sources = blockSourcesForItem(target);
  if (sources) {
    return {
      blocksToMine: sources,
      itemToCount: target,
    };
  }

  // Asked for an ore/plant block name but mining drops an item (coal_ore → coal)
  if (BLOCK_TO_ITEM_DROP[target]) {
    return {
      blocksToMine: [target],
      itemToCount: BLOCK_TO_ITEM_DROP[target],
    };
  }

  // Farming aliases: "seeds", plant-block synonyms not in constants
  const farm = resolveFarmingTerm(target);
  if (farm) {
    const raw = String(target).toLowerCase();
    if (
      raw === "seeds" ||
      raw.endsWith("_seeds") ||
      raw === farm.seedItem ||
      raw === farm.plantBlock
    ) {
      return {
        blocksToMine: farm.blocksToMine,
        itemToCount: farm.itemToCount,
      };
    }
  }

  return { blocksToMine: [target], itemToCount: target };
}

function getBlockIdsToSearch(blocksToMine, mcData) {
  const names = Array.isArray(blocksToMine) ? blocksToMine : [blocksToMine];
  const ids = [];

  for (const blockToMine of names) {
    const primary = mcData.blocksByName[blockToMine];
    if (primary) ids.push(primary.id);

    if (DEEPSLATE_ORE_VARIANTS.includes(blockToMine)) {
      const deep = mcData.blocksByName[`deepslate_${blockToMine}`];
      if (deep) ids.push(deep.id);
    }

    // If mining stone for cobble, also allow cobblestone blocks
    if (blockToMine === "stone") {
      const cobble = mcData.blocksByName["cobblestone"];
      if (cobble) ids.push(cobble.id);
    }
  }

  return [...new Set(ids)];
}

async function equipBestTool(bot, block) {
  if (!block) return;

  const name = block.name || "";
  let tools = PICKAXES;

  if (
    name.includes("log") ||
    name.includes("stem") ||
    name.includes("planks") ||
    name.includes("wood")
  ) {
    tools = AXES;
  } else if (
    name.includes("dirt") ||
    name.includes("sand") ||
    name.includes("gravel") ||
    name.includes("clay") ||
    name.includes("snow")
  ) {
    tools = SHOVELS;
  }

  for (const toolName of tools) {
    const tool = bot.inventory.items().find((i) => i.name === toolName);
    if (tool) {
      try {
        await bot.equip(tool, "hand");
        return toolName;
      } catch (e) {
        // try next
      }
    }
  }

  // Soft blocks don't need tools
  const soft = [
    "dirt",
    "sand",
    "gravel",
    "clay",
    "grass_block",
    "short_grass",
    "tall_grass",
    "grass",
    "snow",
    "wheat",
    "carrots",
    "potatoes",
  ];
  if (soft.some((s) => name === s || name.includes(s))) return null;

  // Logs can be punched slowly
  if (name.includes("log") || name.includes("stem")) return null;

  // Ores / stone without a pickaxe will fail
  if (
    name.includes("ore") ||
    name === "stone" ||
    name === "cobblestone" ||
    name.includes("deepslate")
  ) {
    const err = new Error("NO_TOOL");
    err.noTool = true;
    throw err;
  }

  return null;
}

/**
 * @param {Object} bot
 * @param {Object} mcData
 * @param {Array} taskQueue
 * @param {Object} task
 * @param {number} [cancelGen]
 */
async function handleCollect(bot, mcData, taskQueue, task, cancelGen) {
  let { target, count = 1 } = task;
  const gen = cancelGen ?? botState.getCancelGeneration();

  console.log(`[Collect] === Starting collect task ===`);
  console.log(`[Collect] Target: ${target}, Count: ${count}`);

  try {
    assertNotCancelled(gen);

    const validation = validateAndCorrectName(target, mcData);
    if (!validation.valid) {
      const suggestions = getSuggestions(target, mcData);
      const suggestionMsg =
        suggestions.length > 0
          ? ` Did you mean: ${suggestions.join(", ")}?`
          : "";
      failTask(
        bot,
        taskQueue,
        `I don't know what "${target}" is.${suggestionMsg}`
      );
      return;
    }
    if (validation.corrected !== target) {
      console.log(
        `[Collect] Auto-corrected "${target}" to "${validation.corrected}"`
      );
      target = validation.corrected;
    }

    const { blocksToMine, itemToCount } = resolveCollectTargets(target);
    console.log(
      `[Collect] Mine [${blocksToMine.join(", ")}], count inventory item "${itemToCount}"`
    );

    const currentCount = getInventoryCount(bot, itemToCount);
    if (currentCount >= count) {
      completeCurrentTask(
        bot,
        taskQueue,
        `I already have ${currentCount} ${itemToCount}!`
      );
      return;
    }

    const needed = count - currentCount;
    const blockIds = getBlockIdsToSearch(blocksToMine, mcData);
    if (blockIds.length === 0) {
      failTask(bot, taskQueue, `I don't know what "${target}" is.`);
      return;
    }

    const botPos = bot.entity.position;
    let blocks = [];
    const distances = [16, 32, 48, 64];

    for (const maxDist of distances) {
      assertNotCancelled(gen);
      blocks = bot.findBlocks({
        matching: blockIds,
        maxDistance: maxDist,
        count: Math.max(needed * 2, needed),
      });
      if (blocks.length > 0) break;
    }

    if (blocks.length === 0) {
      failTask(
        bot,
        taskQueue,
        `I can't find any ${blocksToMine.join("/")} nearby.`
      );
      return;
    }

    blocks.sort(
      (a, b) => botPos.distanceTo(a) - botPos.distanceTo(b)
    );

    bot.chat(`Found ${blocks.length} ${blocksToMine[0]}. Collecting...`);

    // Don't spend reserved craft materials while pathing to ores
    applyPathingMovements(bot, mcData, taskQueue, {
      allowBuild: true,
      allowParkour: false,
      allowTowers: true,
      thinkTimeout: 12000,
    });

    const targetBlocks = blocks.map((pos) => bot.blockAt(pos)).filter(Boolean);
    let collected = 0;
    let attempted = 0;
    let toolError = false;

    for (const block of targetBlocks) {
      assertNotCancelled(gen);

      const currentHave = getInventoryCount(bot, itemToCount);
      if (currentHave >= count) break;

      attempted++;
      try {
        await equipBestTool(bot, block);
        await bot.collectBlock.collect(block, {
          ignoreNoPath: false,
          timeout: 10000,
        });
        collected++;
      } catch (collectError) {
        if (collectError.noTool || collectError.message === "NO_TOOL") {
          toolError = true;
          break;
        }
        console.log(`[Collect] Collection failed: ${collectError.message}`);
        if (
          collectError.message.includes("path") ||
          collectError.message.includes("goal") ||
          collectError.message.includes("Took to long")
        ) {
          continue;
        }
        // Wrong tool / harvest harvestable errors
        if (
          collectError.message.includes("dig") ||
          collectError.message.includes("tool") ||
          collectError.message.includes("harvest")
        ) {
          toolError = true;
          break;
        }
      }
    }

    assertNotCancelled(gen);

    const finalCount = getInventoryCount(bot, itemToCount);

    if (toolError && finalCount < count) {
      failTask(
        bot,
        taskQueue,
        `I need a better tool to mine ${blockToMine}.`,
        { fatal: false }
      );
      return;
    }

    if (finalCount >= count) {
      completeCurrentTask(
        bot,
        taskQueue,
        `Collected ${itemToCount}! Now have ${finalCount} total.`
      );
    } else if (finalCount > currentCount) {
      // Partial progress — still fail so retry/replan can finish the rest
      failTask(
        bot,
        taskQueue,
        `Only got ${finalCount}/${count} ${itemToCount}. Retrying...`
      );
    } else {
      failTask(
        bot,
        taskQueue,
        `Couldn't reach any ${blockToMine}. They might be blocked.`
      );
    }
  } catch (error) {
    if (error.cancelled) {
      console.log("[Collect] Cancelled");
      return;
    }
    console.error("[Collect] FATAL ERROR:", error.message);
    if (
      error.message.includes("path") ||
      error.message.includes("goal") ||
      error.message.includes("Took to long")
    ) {
      failTask(
        bot,
        taskQueue,
        `Can't find a path to ${target}. Try moving closer.`
      );
    } else {
      failTask(bot, taskQueue, `Failed to collect ${target}: ${error.message}`);
    }
  }
}

module.exports = {
  handleCollect,
  resolveCollectTargets,
};

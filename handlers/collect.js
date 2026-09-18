/**
 * Collection task handler
 */

const {
  ITEM_TO_BLOCK_SOURCE,
  BLOCK_TO_ITEM_DROP,
  DEEPSLATE_ORE_VARIANTS,
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
 * Resolve what block to mine and which inventory item to count.
 */
function resolveCollectTargets(target) {
  // Item that drops from a different block (coal → coal_ore)
  if (ITEM_TO_BLOCK_SOURCE[target]) {
    return {
      blockToMine: ITEM_TO_BLOCK_SOURCE[target],
      itemToCount: target,
    };
  }

  // Asked for an ore block name but mining drops an item (coal_ore → coal)
  if (BLOCK_TO_ITEM_DROP[target]) {
    return {
      blockToMine: target,
      itemToCount: BLOCK_TO_ITEM_DROP[target],
    };
  }

  return { blockToMine: target, itemToCount: target };
}

function getBlockIdsToSearch(blockToMine, mcData) {
  const ids = [];
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

  return ids;
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
  const soft = ["dirt", "sand", "gravel", "clay", "grass_block", "snow"];
  if (soft.some((s) => name.includes(s))) return null;

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

    const { blockToMine, itemToCount } = resolveCollectTargets(target);
    console.log(
      `[Collect] Mine "${blockToMine}", count inventory item "${itemToCount}"`
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
    const blockIds = getBlockIdsToSearch(blockToMine, mcData);
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
      failTask(bot, taskQueue, `I can't find any ${blockToMine} nearby.`);
      return;
    }

    blocks.sort(
      (a, b) => botPos.distanceTo(a) - botPos.distanceTo(b)
    );

    bot.chat(`Found ${blocks.length} ${blockToMine}. Collecting...`);

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

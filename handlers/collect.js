/**
 * Collection task handler
 */

const { ITEM_TO_BLOCK_SOURCE } = require("../config/constants");
const { completeCurrentTask, failTask } = require("../utils/queue");
const { getInventoryCount } = require("../utils/inventory");

/**
 * Handles the 'collect' task - finds and gathers blocks
 * Uses progressive distance search and collects one block at a time to avoid pathfinding timeouts
 * @param {Object} bot - The mineflayer bot instance
 * @param {Object} mcData - Minecraft data instance
 * @param {Array} taskQueue - The task queue array
 * @param {Object} task - { type: 'collect', target: string, count: number }
 */
async function handleCollect(bot, mcData, taskQueue, task) {
  const { target, count = 1 } = task;

  console.log(`[Collect] === Starting collect task ===`);
  console.log(`[Collect] Target: ${target}, Count: ${count}`);

  try {
    // Check if bot already has enough items in inventory
    const currentCount = getInventoryCount(bot, target);
    if (currentCount >= count) {
      console.log(
        `[Collect] Already have ${currentCount} ${target}, need ${count}. Skipping collection.`
      );
      completeCurrentTask(
        bot,
        taskQueue,
        `I already have ${currentCount} ${target}!`
      );
      return;
    }

    const needed = count - currentCount;
    console.log(
      `[Collect] Have ${currentCount}, need ${count}, collecting ${needed} more`
    );

    // Check if this item needs to be obtained by mining a different block
    const actualBlockToMine = ITEM_TO_BLOCK_SOURCE[target] || target;
    if (actualBlockToMine !== target) {
      console.log(
        `[Collect] Item "${target}" is obtained by mining "${actualBlockToMine}"`
      );
    }

    // Find the block type in minecraft-data
    const blockType = mcData.blocksByName[actualBlockToMine];
    if (!blockType) {
      console.log(
        `[Collect] ERROR: Block type "${actualBlockToMine}" not found in mcData`
      );
      console.log(
        `[Collect] Available similar blocks:`,
        Object.keys(mcData.blocksByName)
          .filter((name) => name.includes(actualBlockToMine.split("_")[0]))
          .slice(0, 10)
      );
      failTask(bot, taskQueue, `I don't know what "${target}" is.`);
      return;
    }
    console.log(
      `[Collect] Block type found: ${blockType.name} (ID: ${blockType.id})`
    );

    // Log bot position
    const botPos = bot.entity.position;
    console.log(
      `[Collect] Bot position: x=${botPos.x.toFixed(1)}, y=${botPos.y.toFixed(
        1
      )}, z=${botPos.z.toFixed(1)}`
    );

    // Find nearby blocks - start with closer range to avoid pathfinding timeouts
    // Try progressively larger distances if nothing found nearby
    let blocks = [];
    const distances = [16, 32, 48, 64];

    for (const maxDist of distances) {
      console.log(`[Collect] Searching within ${maxDist} blocks...`);
      blocks = bot.findBlocks({
        matching: blockType.id,
        maxDistance: maxDist,
        count: needed, // Only collect what we need
      });

      if (blocks.length > 0) {
        console.log(
          `[Collect] Found ${blocks.length} ${target} within ${maxDist} blocks`
        );
        break;
      } else {
        console.log(`[Collect] No ${target} found within ${maxDist} blocks`);
      }
    }

    if (blocks.length === 0) {
      console.log(
        `[Collect] ERROR: No ${target} found within any search distance`
      );
      failTask(bot, taskQueue, `I can't find any ${target} nearby.`);
      return;
    }

    // Sort blocks by distance (closest first) to reduce pathfinding issues
    blocks.sort((a, b) => {
      const distA = botPos.distanceTo(a);
      const distB = botPos.distanceTo(b);
      return distA - distB;
    });

    // Log closest block info
    const closestBlock = blocks[0];
    const closestDist = botPos.distanceTo(closestBlock);
    console.log(
      `[Collect] Closest ${target} at: x=${closestBlock.x}, y=${
        closestBlock.y
      }, z=${closestBlock.z} (distance: ${closestDist.toFixed(1)})`
    );

    bot.chat(`Found ${blocks.length} ${target}. Collecting...`);

    // Get the actual block objects
    const targetBlocks = blocks.map((pos) => bot.blockAt(pos)).filter(Boolean);
    console.log(`[Collect] Valid block objects: ${targetBlocks.length}`);

    if (targetBlocks.length === 0) {
      console.log(
        `[Collect] ERROR: All block positions returned null from bot.blockAt()`
      );
      failTask(bot, taskQueue, `Found ${target} but couldn't access them.`);
      return;
    }

    // Collect blocks one at a time to handle pathfinding failures gracefully
    let collected = 0;
    let attempted = 0;
    for (const block of targetBlocks) {
      // Check if we have enough now
      const currentHave = getInventoryCount(bot, target);
      if (currentHave >= count) {
        console.log(
          `[Collect] Have enough now (${currentHave} >= ${count}), stopping collection`
        );
        break;
      }

      attempted++;
      console.log(
        `[Collect] Attempting block ${attempted}/${targetBlocks.length}: ${block.name} at (${block.position.x}, ${block.position.y}, ${block.position.z})`
      );

      try {
        console.log(`[Collect] Calling collectBlock.collect()...`);
        await bot.collectBlock.collect(block, {
          ignoreNoPath: false,
          timeout: 10000, // 10 second timeout per block
        });
        collected++;
        console.log(`[Collect] Successfully collected! (${collected} total)`);
      } catch (collectError) {
        console.log(`[Collect] Collection failed: ${collectError.message}`);
        console.log(
          `[Collect] Error stack:`,
          collectError.stack?.split("\n").slice(0, 3).join("\n")
        );

        // If pathfinding fails for this block, skip it and try the next
        if (
          collectError.message.includes("path") ||
          collectError.message.includes("goal") ||
          collectError.message.includes("Took to long")
        ) {
          console.log(
            `[Collect] Pathfinding issue - skipping to next block...`
          );
          continue;
        }
        // For other errors, log but continue
        console.log(`[Collect] Non-pathfinding error - continuing...`);
      }
    }

    const finalCount = getInventoryCount(bot, target);
    console.log(
      `[Collect] === Collection complete: ${collected}/${attempted} blocks, now have ${finalCount} total ===`
    );

    if (collected > 0 || finalCount >= count) {
      completeCurrentTask(
        bot,
        taskQueue,
        `Collected ${collected} ${target}! Now have ${finalCount} total.`
      );
    } else {
      console.log(`[Collect] ERROR: Failed to collect any blocks`);
      failTask(
        bot,
        taskQueue,
        `Couldn't reach any ${target}. They might be blocked.`
      );
    }
  } catch (error) {
    console.error("[Collect] FATAL ERROR:", error.message);
    console.error("[Collect] Error stack:", error.stack);

    // If it's a pathfinding timeout, give a helpful message
    if (
      error.message.includes("path") ||
      error.message.includes("goal") ||
      error.message.includes("Took to long")
    ) {
      failTask(
        bot,
        taskQueue,
        `Can't find a path to ${target}. Try moving closer or to open ground.`
      );
    } else {
      failTask(bot, taskQueue, `Failed to collect ${target}: ${error.message}`);
    }
  }
}

module.exports = {
  handleCollect,
};

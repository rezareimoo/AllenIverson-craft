/**
 * Movement task handler
 */

const { GoalNear } = require("mineflayer-pathfinder").goals;
const { completeCurrentTask, failTask } = require("../utils/queue");
const mcData = require("minecraft-data");
const {
  validateAndCorrectName,
  getSuggestions,
} = require("../utils/blockNames");

/**
 * Finds a player target and returns movement info
 * @param {Object} bot - The mineflayer bot instance
 * @param {string} playerName - Name of the player to find
 * @returns {{ pos: Object, range: number, successMessage: string }}
 * @throws {Error} If player cannot be found
 */
function findPlayerTarget(bot, playerName) {
  const targetPlayer = bot.players[playerName];
  if (!targetPlayer || !targetPlayer.entity) {
    throw new Error(`I can't see player "${playerName}".`);
  }

  bot.chat(`Moving to ${playerName}...`);

  return {
    pos: targetPlayer.entity.position,
    range: 2,
    successMessage: "I've arrived!",
  };
}

/**
 * Finds a block target and returns movement info
 * @param {Object} bot - The mineflayer bot instance
 * @param {string|Object} blockSpec - Block name string or object with name property
 * @param {number} radius - How close to get to the block (default 3)
 * @returns {{ pos: Object, range: number, successMessage: string }}
 * @throws {Error} If block cannot be found
 */
function findBlockTarget(bot, blockSpec, radius = 2) {
  // Extract block name - support both string and object formats
  let blockName;
  if (typeof blockSpec === "string") {
    blockName = blockSpec;
  } else if (blockSpec.name) {
    blockName = blockSpec.name;
  } else {
    throw new Error(
      "Invalid block specification - need block name string or block object with name property."
    );
  }

  // Get minecraft-data for this version
  const data = mcData(bot.version);

  // Validate and correct the block name
  const validation = validateAndCorrectName(blockName, data);
  if (!validation.valid) {
    const suggestions = getSuggestions(blockName, data);
    const suggestionMsg =
      suggestions.length > 0
        ? ` Did you mean: ${suggestions.join(", ")}?`
        : "";
    throw new Error(`Unknown block type: ${blockName}.${suggestionMsg}`);
  }
  if (validation.corrected !== blockName) {
    console.log(
      `[Move] Auto-corrected "${blockName}" to "${validation.corrected}"`
    );
    blockName = validation.corrected;
  }

  bot.chat(`Searching for the nearest ${blockName}...`);

  const blockData = data.blocksByName[blockName];

  if (!blockData) {
    throw new Error(`Unknown block type: ${blockName}`);
  }

  // Find the nearest block
  const targetBlock = bot.findBlock({
    matching: blockData.id,
    maxDistance: 64,
    count: 1,
  });

  if (!targetBlock) {
    throw new Error(`Couldn't find any ${blockName} nearby!`);
  }

  const pos = targetBlock.position;
  bot.chat(
    `Found a ${blockName} at ${pos.x.toFixed(1)}, ${pos.y.toFixed(
      1
    )}, ${pos.z.toFixed(1)}. Pathfinding...`
  );

  return {
    pos,
    range: radius,
    successMessage: `I have arrived at the ${blockName}! Ready to interact.`,
  };
}

/**
 * Handles the 'move' task - navigates to a block or a player
 * @param {Object} bot - The mineflayer bot instance
 * @param {Array} taskQueue - The task queue array
 * @param {Object} task - { type: 'move', block?: string|object, player? }
 */
async function handleMove(bot, taskQueue, task) {
  const MAX_RETRIES = 2;

  try {
    let target;

    if (task.player) {
      target = findPlayerTarget(bot, task.player);
    } else if (task.block) {
      target = findBlockTarget(bot, task.block, task.radius);
    } else {
      failTask(
        bot,
        taskQueue,
        "Invalid move command - need block name or player name."
      );
      return;
    }

    const { pos, range, successMessage } = target;

    // Use GoalNear to get close to the target without breaking it
    const goal = new GoalNear(pos.x, pos.y, pos.z, range);

    // Retry pathfinding up to MAX_RETRIES times
    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await bot.pathfinder.goto(goal);
        completeCurrentTask(bot, taskQueue, successMessage);
        return; // Success - exit the function
      } catch (pathError) {
        lastError = pathError;
        console.log(
          `[Move] Pathfinding attempt ${attempt}/${MAX_RETRIES} failed: ${pathError.message}`
        );

        if (attempt < MAX_RETRIES) {
          bot.chat(`Retrying pathfinding... (attempt ${attempt + 1})`);
          // Small delay before retry
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }

    // All retries exhausted - fail the task
    throw lastError;
  } catch (error) {
    console.error("[Body] Move error:", error.message);

    // Provide more specific error messages for pathfinding failures
    let errorMessage = error.message;
    if (
      error.message.includes("path") ||
      error.message.includes("goal") ||
      error.message.includes("Timeout")
    ) {
      if (task.block) {
        const blockName =
          typeof task.block === "string"
            ? task.block
            : task.block.name || "block";
        errorMessage = `Pathfinding failed after ${MAX_RETRIES} attempts, maybe the ${blockName} is unreachable.`;
      } else {
        errorMessage = `Pathfinding failed after ${MAX_RETRIES} attempts, maybe the target is unreachable.`;
      }
    }

    failTask(bot, taskQueue, errorMessage);
  }
}

module.exports = {
  handleMove,
};

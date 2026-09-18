/**
 * Movement task handler — robust pathing that won't spend craft materials
 */

const { GoalNear } = require("mineflayer-pathfinder").goals;
const {
  completeCurrentTask,
  failTask,
  assertNotCancelled,
} = require("../utils/queue");
const mcDataLib = require("minecraft-data");
const {
  validateAndCorrectName,
  getSuggestions,
} = require("../utils/blockNames");
const { botState } = require("../state/botState");
const {
  gotoRobust,
  shouldPreferNoBuild,
  applyPathingMovements,
} = require("../utils/pathing");

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

function findBlockTarget(bot, blockSpec, radius = 2) {
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

  const data = mcDataLib(bot.version);

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

  // Prefer closest reachable-looking candidate among several nearby matches
  const positions = bot.findBlocks({
    matching: blockData.id,
    maxDistance: 64,
    count: 8,
  });

  if (!positions.length) {
    throw new Error(`Couldn't find any ${blockName} nearby!`);
  }

  const botPos = bot.entity.position;
  positions.sort((a, b) => botPos.distanceTo(a) - botPos.distanceTo(b));

  const pos = positions[0];
  bot.chat(
    `Found a ${blockName} at ${pos.x.toFixed(1)}, ${pos.y.toFixed(
      1
    )}, ${pos.z.toFixed(1)}. Pathfinding...`
  );

  return {
    pos,
    range: radius,
    successMessage: `I have arrived at the ${blockName}! Ready to interact.`,
    candidates: positions,
  };
}

async function handleMove(bot, taskQueue, task, cancelGen) {
  const gen = cancelGen ?? botState.getCancelGeneration();
  const mcData = botState.getMcData() || mcDataLib(bot.version);

  try {
    assertNotCancelled(gen);
    let target;

    if (task.player) {
      let targetPlayer = bot.players[task.player];
      if (!targetPlayer?.entity) {
        for (let i = 0; i < 4; i++) {
          assertNotCancelled(gen);
          await new Promise((r) => setTimeout(r, 400));
          targetPlayer = bot.players[task.player];
          if (targetPlayer?.entity) break;
        }
      }
      target = findPlayerTarget(bot, task.player);
    } else if (task.block) {
      target = findBlockTarget(bot, task.block, task.radius ?? 3);
    } else {
      failTask(
        bot,
        taskQueue,
        "Invalid move command - need block name or player name."
      );
      return;
    }

    let { pos, range, successMessage, candidates } = target;

    if (task.player && bot.players[task.player]?.entity) {
      pos = bot.players[task.player].entity.position;
    }

    const preferNoBuild = shouldPreferNoBuild(task);
    const assertFn = () => assertNotCancelled(gen);

    // Try primary target, then alternate nearby candidates if block move fails
    const positionsToTry = candidates?.length
      ? candidates
      : [pos];

    let lastError;
    for (let c = 0; c < positionsToTry.length; c++) {
      const tryPos = positionsToTry[c];
      // Slightly larger reach for workstations on later candidates
      const tryRange = preferNoBuild ? Math.max(range, 3) : range;
      const goal = new GoalNear(tryPos.x, tryPos.y, tryPos.z, tryRange);

      try {
        await gotoRobust(bot, goal, {
          mcData,
          taskQueue,
          assertNotCancelled: assertFn,
          preferNoBuild,
          maxAttempts: preferNoBuild ? 3 : 3,
        });
        assertNotCancelled(gen);
        completeCurrentTask(bot, taskQueue, successMessage);
        return;
      } catch (pathError) {
        if (pathError.cancelled) throw pathError;
        lastError = pathError;
        console.log(
          `[Move] Candidate ${c + 1}/${positionsToTry.length} failed: ${pathError.message}`
        );
        if (c < positionsToTry.length - 1) {
          bot.chat(`Trying another path...`);
        }
      }
    }

    throw lastError;
  } catch (error) {
    if (error.cancelled) {
      console.log("[Move] Cancelled");
      return;
    }
    console.error("[Move] Error:", error.message);

    // Restore reliable default movements after failure
    try {
      applyPathingMovements(bot, mcData, taskQueue, {
        allowBuild: true,
        allowParkour: false,
        allowTowers: true,
      });
    } catch (e) {}

    let errorMessage = error.message;
    if (
      error.message.includes("path") ||
      error.message.includes("goal") ||
      error.message.includes("Timeout") ||
      error.message.includes("Pathfinding")
    ) {
      if (task.block) {
        const blockName =
          typeof task.block === "string"
            ? task.block
            : task.block.name || "block";
        errorMessage = `Couldn't reach the ${blockName} — path blocked or too far.`;
      } else {
        errorMessage = `Couldn't reach the target — path blocked or too far.`;
      }
    }

    failTask(bot, taskQueue, errorMessage);
  }
}

module.exports = {
  handleMove,
};

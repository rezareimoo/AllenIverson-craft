/**
 * Place block task handler — prefers placing on solid ground near the bot
 */

const { Vec3 } = require("vec3");
const {
  completeCurrentTask,
  failTask,
  assertNotCancelled,
} = require("../utils/queue");
const {
  validateAndCorrectName,
  getSuggestions,
} = require("../utils/blockNames");
const { botState } = require("../state/botState");

function isEmpty(block) {
  return (
    !block ||
    block.name === "air" ||
    block.name === "cave_air" ||
    block.name === "void_air" ||
    block.boundingBox === "empty"
  );
}

async function handlePlace(bot, taskQueue, task, mcData, cancelGen) {
  let { target } = task;
  const gen = cancelGen ?? botState.getCancelGeneration();

  try {
    assertNotCancelled(gen);

    if (mcData) {
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
        target = validation.corrected;
      }
    }

    const item = bot.inventory.items().find((i) => i.name === target);
    if (!item) {
      failTask(bot, taskQueue, `I don't have any ${target} in my inventory.`);
      return;
    }

    await bot.equip(item, "hand");
    assertNotCancelled(gen);

    const botPos = bot.entity.position.floored();
    // Candidate ground blocks to place on top of (near feet)
    const groundOffsets = [
      new Vec3(1, -1, 0),
      new Vec3(-1, -1, 0),
      new Vec3(0, -1, 1),
      new Vec3(0, -1, -1),
      new Vec3(1, -1, 1),
      new Vec3(-1, -1, -1),
      new Vec3(1, -1, -1),
      new Vec3(-1, -1, 1),
      new Vec3(2, -1, 0),
      new Vec3(-2, -1, 0),
      new Vec3(0, -1, 2),
      new Vec3(0, -1, -2),
    ];

    let referenceBlock = null;
    let faceVector = null;

    for (const offset of groundOffsets) {
      const ground = bot.blockAt(botPos.plus(offset));
      if (!ground || ground.boundingBox !== "block") continue;
      const above = bot.blockAt(ground.position.offset(0, 1, 0));
      if (!isEmpty(above)) continue;
      referenceBlock = ground;
      faceVector = new Vec3(0, 1, 0);
      break;
    }

    // Side-place fallback against nearby solid blocks
    if (!referenceBlock) {
      const sideOffsets = [
        new Vec3(1, 0, 0),
        new Vec3(-1, 0, 0),
        new Vec3(0, 0, 1),
        new Vec3(0, 0, -1),
      ];
      for (const offset of sideOffsets) {
        const side = bot.blockAt(botPos.plus(offset));
        if (!side || side.boundingBox !== "block") continue;
        const dest = bot.blockAt(side.position.minus(offset));
        // Place against the face toward the bot / empty
        const face = offset.scaled(-1);
        const placeAt = side.position.plus(face);
        const destBlock = bot.blockAt(placeAt);
        if (!isEmpty(destBlock)) continue;
        referenceBlock = side;
        faceVector = face;
        break;
      }
    }

    if (!referenceBlock || !faceVector) {
      failTask(bot, taskQueue, `I can't find a good spot to place ${target}.`);
      return;
    }

    bot.chat(`Placing ${target}...`);
    await bot.placeBlock(referenceBlock, faceVector);
    assertNotCancelled(gen);

    completeCurrentTask(bot, taskQueue, `Placed ${target}!`);
  } catch (error) {
    if (error.cancelled) {
      console.log("[Place] Cancelled");
      return;
    }
    console.error("[Place] Error:", error.message);
    failTask(bot, taskQueue, `Failed to place ${target}: ${error.message}`);
  }
}

module.exports = {
  handlePlace,
};

const mineflayer = require("mineflayer");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
const { GoalNear, GoalLookAtBlock } = goals;
const mcData = require("minecraft-data"); // Used to get the block ID

const bot = mineflayer.createBot({
  host: "localhost",
  port: 50491,
  username: "CrafterBot",
});

bot.loadPlugin(pathfinder);

// --- Initialization ---
bot.once("spawn", () => {
  // 1. Get block ID for 'crafting_table'
  const blockID = mcData(bot.version).blocksByName.crafting_table.id;

  // 2. Initialize movements for pathfinding
  const defaultMove = new Movements(bot, mcData(bot.version));
  // Allows the bot to break blocks that are in the way of its path
  defaultMove.canDig = true;
  bot.pathfinder.setMovements(defaultMove);

  bot.chat('Ready to craft! Send "table" in chat to find one.');
});

// --- Chat Listener ---
bot.on("chat", (username, message) => {
  if (username === bot.username) return;
  if (message === "table") {
    findAndGoToBlock("crafting_table", 3); // Find table and stay 3 blocks away
  }
});

// --- Core Function: Find and Go to Block ---
async function findAndGoToBlock(blockName, range = 1) {
  bot.chat(`Searching for the nearest ${blockName}...`);

  const data = mcData(bot.version);
  const blockID = data.blocksByName[blockName].id;

  // Use bot.findBlock to locate the nearest instance of the block
  const targetBlock = bot.findBlock({
    matching: blockID,
    maxDistance: 64, // Search within 64 blocks
    count: 1, // Only need the nearest one
  });

  if (!targetBlock) {
    bot.chat(`Couldn't find any ${blockName} nearby!`);
    return;
  }

  const pos = targetBlock.position;
  bot.chat(
    `Found a ${blockName} at ${pos.x}, ${pos.y}, ${pos.z}. Pathfinding...`
  );

  // Set the pathfinding goal
  try {
    // GoalNear makes the bot pathfind to any spot within 'range' blocks of the position.
    // We use range 1-4 for crafting table so the bot is next to it, not inside it.
    const goal = new GoalNear(pos.x, pos.y, pos.z, range);
    console.log(goal);

    await bot.pathfinder.goto(goal);

    bot.chat("I have arrived at the crafting table! Ready to craft.");
  } catch (err) {
    bot.chat("Pathfinding failed, maybe the block is unreachable.");
    console.error(err);
  }
}

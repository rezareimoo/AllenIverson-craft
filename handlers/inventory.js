/**
 * Inventory task handler
 */

const { completeCurrentTask } = require("../utils/queue");

function formatInventory(bot) {
  const items = bot.inventory.items();

  if (items.length === 0) {
    return "My inventory is empty.";
  }

  const itemCounts = {};
  for (const item of items) {
    itemCounts[item.name] = (itemCounts[item.name] || 0) + item.count;
  }

  const itemList = Object.entries(itemCounts)
    .map(([name, count]) => {
      const displayName = name
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
      return `${count}x ${displayName}`;
    })
    .join(", ");

  const totalItems = Object.values(itemCounts).reduce(
    (sum, count) => sum + count,
    0
  );

  return `I have: ${itemList} (${totalItems} items total)`;
}

function handleInventory(bot, taskQueue, task) {
  try {
    const inventoryMessage = formatInventory(bot);
    // completeCurrentTask already chats the message — don't double-chat
    completeCurrentTask(bot, taskQueue, inventoryMessage);
  } catch (error) {
    console.error("[Inventory] Error:", error.message);
    completeCurrentTask(bot, taskQueue, "Sorry, I couldn't check my inventory.");
  }
}

module.exports = {
  handleInventory,
  formatInventory,
};

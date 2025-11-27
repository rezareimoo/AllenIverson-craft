/**
 * Inventory task handler
 */

const { completeCurrentTask } = require("../utils/queue");

/**
 * Formats inventory items into a readable string
 * Groups items by name and shows counts
 * @param {Object} bot - The mineflayer bot instance
 * @returns {string} - Formatted inventory string
 */
function formatInventory(bot) {
  const items = bot.inventory.items();
  
  if (items.length === 0) {
    return "My inventory is empty.";
  }

  // Group items by name and sum counts
  const itemCounts = {};
  for (const item of items) {
    const name = item.name;
    itemCounts[name] = (itemCounts[name] || 0) + item.count;
  }

  // Format as readable list
  const itemList = Object.entries(itemCounts)
    .map(([name, count]) => {
      // Format item name: replace underscores with spaces and capitalize
      const displayName = name
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
      return `${count}x ${displayName}`;
    })
    .join(", ");

  const totalItems = Object.values(itemCounts).reduce((sum, count) => sum + count, 0);
  
  return `I have: ${itemList} (${totalItems} items total)`;
}

/**
 * Handles the 'inventory' task - reports what's in the bot's inventory
 * @param {Object} bot - The mineflayer bot instance
 * @param {Array} taskQueue - The task queue array
 * @param {Object} task - { type: 'inventory' }
 */
function handleInventory(bot, taskQueue, task) {
  try {
    const inventoryMessage = formatInventory(bot);
    bot.chat(inventoryMessage);
    completeCurrentTask(bot, taskQueue, inventoryMessage);
  } catch (error) {
    console.error("[Inventory] Error:", error.message);
    bot.chat("Sorry, I couldn't check my inventory.");
    completeCurrentTask(bot, taskQueue, "Inventory check completed with error");
  }
}

module.exports = {
  handleInventory,
  formatInventory,
};


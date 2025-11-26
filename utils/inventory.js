/**
 * Inventory utility functions
 */

/**
 * Gets the count of an item in the bot's inventory
 * @param {Object} bot - The mineflayer bot instance
 * @param {string} itemName - Name of the item to count
 * @returns {number} - Count of items in inventory
 */
function getInventoryCount(bot, itemName) {
  return bot.inventory
    .items()
    .filter((item) => item.name === itemName)
    .reduce((sum, item) => sum + item.count, 0);
}

module.exports = {
  getInventoryCount,
};

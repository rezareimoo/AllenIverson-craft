/**
 * Block/Item name validation and correction utilities
 * Uses minecraft-data to ensure correct block/item names
 */

/**
 * Quick check if a name is a valid block in minecraft-data
 * @param {string} name - The block name to check
 * @param {Object} mcData - Minecraft data instance
 * @returns {boolean} - True if valid block name
 */
function isValidBlockName(name, mcData) {
  if (!name || !mcData) return false;
  return !!mcData.blocksByName[name.toLowerCase().trim()];
}

/**
 * Quick check if a name is a valid item in minecraft-data
 * @param {string} name - The item name to check
 * @param {Object} mcData - Minecraft data instance
 * @returns {boolean} - True if valid item name
 */
function isValidItemName(name, mcData) {
  if (!name || !mcData) return false;
  return !!mcData.itemsByName[name.toLowerCase().trim()];
}

/**
 * Quick check if a name is either a valid block or item
 * @param {string} name - The name to check
 * @param {Object} mcData - Minecraft data instance
 * @returns {boolean} - True if valid block or item name
 */
function isValidName(name, mcData) {
  return isValidBlockName(name, mcData) || isValidItemName(name, mcData);
}

/**
 * Gets a list of all collectible blocks (blocks that can be mined)
 * @param {Object} mcData - Minecraft data instance
 * @returns {Array<string>} - Array of block names
 */
function getCollectibleBlocks(mcData) {
  if (!mcData) return [];

  // Filter blocks that are typically collectible (solid, not technical)
  const excludePatterns = [
    "air",
    "void",
    "barrier",
    "command_block",
    "structure",
    "jigsaw",
    "light",
    "debug",
    "piston_head",
    "moving_piston",
    "fire",
    "soul_fire",
    "nether_portal",
    "end_portal",
    "end_gateway",
    "frosted_ice",
    "bubble_column",
  ];

  return Object.keys(mcData.blocksByName).filter((name) => {
    const block = mcData.blocksByName[name];
    // Filter out non-solid/technical blocks
    if (!block || block.hardness === undefined || block.hardness < 0) {
      return false;
    }
    // Filter out excluded patterns
    return !excludePatterns.some(
      (pattern) => name.includes(pattern) || name === pattern
    );
  });
}

/**
 * Suggests similar block/item names for user feedback
 * @param {string} inputName - The invalid name
 * @param {Object} mcData - Minecraft data instance
 * @param {number} maxSuggestions - Maximum suggestions to return
 * @returns {Array<string>} - Array of similar valid names
 */
function getSuggestions(inputName, mcData, maxSuggestions = 3) {
  if (!inputName || !mcData) return [];

  const normalized = inputName.toLowerCase().trim();
  const allNames = [
    ...Object.keys(mcData.blocksByName || {}),
    ...Object.keys(mcData.itemsByName || {}),
  ];

  // Score names by similarity
  const scored = allNames
    .map((name) => ({
      name,
      distance: levenshteinDistance(normalized, name.toLowerCase()),
    }))
    .filter((item) => item.distance <= 5) // Only consider reasonably close matches
    .sort((a, b) => a.distance - b.distance);

  return scored.slice(0, maxSuggestions).map((item) => item.name);
}

/**
 * Calculates Levenshtein distance between two strings
 * Used for fuzzy matching of block names
 */
function levenshteinDistance(str1, str2) {
  const m = str2.length;
  const n = str1.length;
  const dp = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str2[i - 1] === str1[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1, // deletion
          dp[i][j - 1] + 1, // insertion
          dp[i - 1][j - 1] + 1 // substitution
        );
      }
    }
  }

  return dp[m][n];
}

/**
 * Finds the closest matching block/item name using fuzzy matching
 * @param {string} inputName - The potentially incorrect name
 * @param {Object} mcData - Minecraft data instance
 * @param {number} maxDistance - Maximum allowed edit distance (default: 3)
 * @returns {string|null} - The corrected name or null if no good match found
 */
function findClosestName(inputName, mcData, maxDistance = 3) {
  if (!inputName || !mcData) return null;

  const normalizedInput = inputName.toLowerCase().trim();

  // First, try exact match (case-insensitive)
  const allNames = [
    ...Object.keys(mcData.blocksByName || {}),
    ...Object.keys(mcData.itemsByName || {}),
  ];

  // Check for exact match (case-insensitive)
  const exactMatch = allNames.find(
    (name) => name.toLowerCase() === normalizedInput
  );
  if (exactMatch) return exactMatch;

  // Try partial match (contains)
  const partialMatch = allNames.find((name) =>
    name.toLowerCase().includes(normalizedInput)
  );
  if (partialMatch) {
    // Only return if it's a reasonable match (not too different in length)
    const lengthDiff = Math.abs(partialMatch.length - normalizedInput.length);
    if (lengthDiff <= 5) return partialMatch;
  }

  // Fuzzy match - find closest by edit distance
  let bestMatch = null;
  let bestDistance = Infinity;

  for (const name of allNames) {
    const distance = levenshteinDistance(normalizedInput, name.toLowerCase());
    if (distance < bestDistance && distance <= maxDistance) {
      bestDistance = distance;
      bestMatch = name;
    }
  }

  return bestMatch;
}

/**
 * Validates and corrects a block/item name
 * @param {string} name - The name to validate
 * @param {Object} mcData - Minecraft data instance
 * @returns {Object} - { valid: boolean, corrected: string, original: string }
 */
function validateAndCorrectName(name, mcData) {
  if (!name || !mcData) {
    return { valid: false, corrected: null, original: name };
  }

  const normalized = name.toLowerCase().trim();

  // Check if it's a valid block name
  if (mcData.blocksByName[normalized]) {
    return { valid: true, corrected: normalized, original: name };
  }

  // Check if it's a valid item name
  if (mcData.itemsByName[normalized]) {
    return { valid: true, corrected: normalized, original: name };
  }

  // Try to find a close match
  const corrected = findClosestName(normalized, mcData);
  if (corrected) {
    return { valid: true, corrected, original: name };
  }

  return { valid: false, corrected: null, original: name };
}

/**
 * Validates and corrects block/item names in a task object
 * @param {Object} task - The task object to validate
 * @param {Object} mcData - Minecraft data instance
 * @returns {Object} - The corrected task object
 */
function validateTask(task, mcData) {
  if (!task || !mcData) return task;

  const correctedTask = { ...task };

  // Validate 'target' field (used in collect, craft, place tasks)
  if (task.target) {
    const validation = validateAndCorrectName(task.target, mcData);
    if (validation.valid && validation.corrected !== task.target) {
      console.log(
        `[BlockNames] Corrected "${task.target}" to "${validation.corrected}"`
      );
      correctedTask.target = validation.corrected;
    } else if (!validation.valid) {
      console.warn(
        `[BlockNames] Could not validate or correct "${task.target}"`
      );
    }
  }

  return correctedTask;
}

/**
 * Validates and corrects all tasks in an array
 * @param {Array} tasks - Array of task objects
 * @param {Object} mcData - Minecraft data instance
 * @returns {Array} - Array of corrected task objects
 */
function validateTasks(tasks, mcData) {
  if (!Array.isArray(tasks) || !mcData) return tasks;

  return tasks.map((task) => validateTask(task, mcData));
}

/**
 * Gets a list of common block/item names for use in prompts
 * Uses a default version to generate the list
 * @param {string} version - Minecraft version (default: '1.20.1')
 * @returns {Object} - { blocks: Array<string>, items: Array<string> }
 */
function getCommonNames(version = "1.20.1") {
  try {
    const mcData = require("minecraft-data")(version);
    const allBlocks = Object.keys(mcData.blocksByName || {});
    const allItems = Object.keys(mcData.itemsByName || {});

    // Filter out common blocks/items (exclude technical blocks like air, barriers, etc.)
    const excludeList = [
      "air",
      "barrier",
      "structure_void",
      "command_block",
      "repeating_command_block",
      "chain_command_block",
    ];

    const commonBlocks = allBlocks
      .filter((name) => !excludeList.includes(name))
      .slice(0, 200); // Limit to 200 most common

    const commonItems = allItems
      .filter((name) => !excludeList.includes(name))
      .slice(0, 200); // Limit to 200 most common

    return { blocks: commonBlocks, items: commonItems };
  } catch (error) {
    console.error(`[BlockNames] Error getting common names: ${error.message}`);
    return { blocks: [], items: [] };
  }
}

module.exports = {
  validateAndCorrectName,
  validateTask,
  validateTasks,
  findClosestName,
  getCommonNames,
  isValidBlockName,
  isValidItemName,
  isValidName,
  getCollectibleBlocks,
  getSuggestions,
};


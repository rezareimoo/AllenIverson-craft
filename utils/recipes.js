/**
 * Recipe validation and lookup utilities using minecraft-data
 */

const { ITEM_TO_BLOCK_SOURCE, SMELTABLE_ITEMS, FUEL_ITEMS } = require("../config/constants");

/**
 * Checks if an item is obtained through smelting
 * @param {string} itemName - The item to check
 * @returns {Object|null} - Smelt info { input, fuelPerItem } or null
 */
function getSmeltInfo(itemName) {
  return SMELTABLE_ITEMS[itemName] || null;
}

/**
 * Checks if an item is smeltable (can be obtained via smelting)
 * @param {string} itemName - The item to check
 * @returns {boolean} - True if item is obtained via smelting
 */
function isSmeltable(itemName) {
  return !!SMELTABLE_ITEMS[itemName];
}

/**
 * Checks if an item has a crafting recipe in minecraft-data
 * @param {string} itemName - The item name to check
 * @param {Object} mcData - Minecraft data instance
 * @returns {boolean} - True if the item has a recipe
 */
function isCraftable(itemName, mcData) {
  if (!itemName || !mcData) return false;

  const item = mcData.itemsByName[itemName];
  if (!item) return false;

  // Check if there are recipes for this item
  const recipes = mcData.recipes[item.id];
  return recipes && recipes.length > 0;
}

/**
 * Gets recipes for an item from minecraft-data
 * @param {string} itemName - The item name
 * @param {Object} mcData - Minecraft data instance
 * @returns {Array} - Array of recipe objects, or empty array if none
 */
function getRecipes(itemName, mcData) {
  if (!itemName || !mcData) return [];

  const item = mcData.itemsByName[itemName];
  if (!item) return [];

  return mcData.recipes[item.id] || [];
}

/**
 * Preferred ingredients - when a recipe allows alternatives, prefer these common items
 * Lower index = higher priority
 */
const PREFERRED_INGREDIENTS = {
  // Prefer common wood types for planks
  planks: [
    "oak_planks",
    "birch_planks",
    "spruce_planks",
    "jungle_planks",
    "acacia_planks",
    "dark_oak_planks",
    "mangrove_planks",
    "cherry_planks",
    "bamboo_planks",
    "crimson_planks",
    "warped_planks",
  ],
  // Prefer common logs
  logs: [
    "oak_log",
    "birch_log",
    "spruce_log",
    "jungle_log",
    "acacia_log",
    "dark_oak_log",
    "mangrove_log",
    "cherry_log",
    "crimson_stem",
    "warped_stem",
  ],
  // Prefer regular stone variants over deepslate
  stone: [
    "cobblestone",
    "stone",
    "cobbled_deepslate",
    "deepslate_cobblestone", 
    "deepslate",
    "blackstone",
    "polished_blackstone",
  ],
  // Prefer common dyes
  dyes: [
    "white_dye",
    "black_dye",
    "red_dye",
    "blue_dye",
    "yellow_dye",
    "green_dye",
  ],
};

/**
 * Gets the preference score for an item (lower is better)
 * @param {string} itemName - The item name
 * @returns {number} - Preference score (0 = most preferred, higher = less preferred)
 */
function getPreferenceScore(itemName) {
  // Check each preference category
  for (const category of Object.values(PREFERRED_INGREDIENTS)) {
    const index = category.indexOf(itemName);
    if (index !== -1) {
      return index;
    }
  }
  // Items not in preference list get a neutral score
  return 100;
}

/**
 * Calculates total preference score for a recipe's ingredients
 * @param {Object} recipe - The recipe object
 * @param {Object} mcData - Minecraft data instance
 * @returns {number} - Total preference score (lower is better)
 */
function getRecipePreferenceScore(recipe, mcData) {
  let totalScore = 0;
  
  if (recipe.inShape) {
    for (const row of recipe.inShape) {
      for (const ingredient of row) {
        const itemId = getIngredientId(ingredient, mcData);
        if (itemId !== null) {
          const item = mcData.items[itemId];
          if (item) {
            totalScore += getPreferenceScore(item.name);
          }
        }
      }
    }
  }
  
  if (recipe.ingredients) {
    for (const ingredient of recipe.ingredients) {
      const itemId = getIngredientId(ingredient, mcData);
      if (itemId !== null) {
        const item = mcData.items[itemId];
        if (item) {
          totalScore += getPreferenceScore(item.name);
        }
      }
    }
  }
  
  return totalScore;
}

/**
 * Selects the best recipe from a list based on ingredient preferences
 * Prefers recipes using common materials like oak_planks over cherry_planks
 * @param {Array} recipes - Array of recipe objects
 * @param {Object} mcData - Minecraft data instance
 * @returns {Object} - The best recipe
 */
function selectBestRecipe(recipes, mcData) {
  if (!recipes || recipes.length === 0) return null;
  if (recipes.length === 1) return recipes[0];
  
  let bestRecipe = recipes[0];
  let bestScore = getRecipePreferenceScore(recipes[0], mcData);
  
  for (let i = 1; i < recipes.length; i++) {
    const score = getRecipePreferenceScore(recipes[i], mcData);
    if (score < bestScore) {
      bestScore = score;
      bestRecipe = recipes[i];
    }
  }
  
  // Log if we selected a different recipe than the first one
  if (bestRecipe !== recipes[0]) {
    const bestIngredients = getRecipeIngredients(bestRecipe, mcData);
    console.log(`[Resolver] Selected better recipe with ingredients: ${bestIngredients.map(i => i.name).join(', ')} (score: ${bestScore})`);
  }
  
  return bestRecipe;
}

/**
 * Extracts item ID from an ingredient (handles both number and object formats)
 * @param {number|Object|Array} ingredient - The ingredient (can be item ID, {id, count} object, or array of alternatives)
 * @param {Object} mcData - Minecraft data instance (needed for preference selection)
 * @returns {number|null} - The item ID or null if invalid
 */
function getIngredientId(ingredient, mcData) {
  if (ingredient === null || ingredient === undefined) return null;
  
  // If it's a number, it's directly an item ID
  if (typeof ingredient === 'number') {
    return ingredient >= 0 ? ingredient : null;
  }
  
  // If it's an object with id property
  if (typeof ingredient === 'object' && !Array.isArray(ingredient) && ingredient.id !== undefined) {
    return ingredient.id >= 0 ? ingredient.id : null;
  }
  
  // If it's an array (alternative ingredients), select the most preferred one
  if (Array.isArray(ingredient) && ingredient.length > 0) {
    if (!mcData) {
      // Fallback: just take first if no mcData
      return getIngredientId(ingredient[0], null);
    }
    
    // Find the most preferred alternative
    let bestId = null;
    let bestScore = Infinity;
    
    for (const alt of ingredient) {
      const altId = getIngredientId(alt, null); // Get ID without recursing into arrays
      if (altId !== null) {
        const item = mcData.items[altId];
        if (item) {
          const score = getPreferenceScore(item.name);
          if (score < bestScore) {
            bestScore = score;
            bestId = altId;
          }
        }
      }
    }
    
    return bestId;
  }
  
  return null;
}

/**
 * Gets the ingredients required for a recipe
 * @param {Object} recipe - A minecraft-data recipe object
 * @param {Object} mcData - Minecraft data instance
 * @returns {Array} - Array of { name: string, count: number }
 */
function getRecipeIngredients(recipe, mcData) {
  if (!recipe || !mcData) return [];

  const ingredientMap = {};

  // Handle shaped recipes (inShape)
  if (recipe.inShape) {
    for (const row of recipe.inShape) {
      for (const ingredient of row) {
        const itemId = getIngredientId(ingredient, mcData);
        if (itemId !== null) {
          const item = mcData.items[itemId];
          if (item) {
            const count = (typeof ingredient === 'object' && !Array.isArray(ingredient) && ingredient.count) ? ingredient.count : 1;
            ingredientMap[item.name] = (ingredientMap[item.name] || 0) + count;
          }
        }
      }
    }
  }

  // Handle shapeless recipes (ingredients array)
  if (recipe.ingredients) {
    for (const ingredient of recipe.ingredients) {
      const itemId = getIngredientId(ingredient, mcData);
      if (itemId !== null) {
        const item = mcData.items[itemId];
        if (item) {
          const count = (typeof ingredient === 'object' && !Array.isArray(ingredient) && ingredient.count) ? ingredient.count : 1;
          ingredientMap[item.name] = (ingredientMap[item.name] || 0) + count;
        }
      }
    }
  }

  // Convert map to array
  const ingredients = [];
  for (const [name, count] of Object.entries(ingredientMap)) {
    ingredients.push({ name, count });
  }

  return ingredients;
}

/**
 * Checks if a recipe requires a crafting table (3x3 grid)
 * @param {Object} recipe - A minecraft-data recipe object
 * @returns {boolean} - True if requires crafting table
 */
function requiresCraftingTable(recipe) {
  if (!recipe) return false;

  // Check inShape dimensions for shaped recipes
  if (recipe.inShape) {
    const rows = recipe.inShape.length;
    const cols = Math.max(...recipe.inShape.map((row) => row.length));
    // If grid is larger than 2x2, needs crafting table
    return rows > 2 || cols > 2;
  }

  // For shapeless recipes, check ingredient count
  if (recipe.ingredients && recipe.ingredients.length > 4) {
    return true;
  }

  return false;
}

/**
 * Gets a list of common craftable items with their basic recipe info
 * Useful for LLM prompts
 * @param {Object} mcData - Minecraft data instance
 * @param {number} limit - Maximum number of items to return
 * @returns {Array} - Array of { name, requiresTable, ingredients }
 */
function getCommonCraftableItems(mcData, limit = 50) {
  if (!mcData) return [];

  const craftables = [];

  // Priority items that are commonly crafted
  const priorityItems = [
    "oak_planks",
    "birch_planks",
    "spruce_planks",
    "jungle_planks",
    "acacia_planks",
    "dark_oak_planks",
    "stick",
    "crafting_table",
    "wooden_pickaxe",
    "wooden_axe",
    "wooden_sword",
    "wooden_shovel",
    "wooden_hoe",
    "stone_pickaxe",
    "stone_axe",
    "stone_sword",
    "stone_shovel",
    "stone_hoe",
    "iron_pickaxe",
    "iron_axe",
    "iron_sword",
    "iron_shovel",
    "iron_hoe",
    "diamond_pickaxe",
    "diamond_axe",
    "diamond_sword",
    "diamond_shovel",
    "diamond_hoe",
    "furnace",
    "chest",
    "torch",
    "ladder",
    "fence",
    "oak_fence",
    "oak_door",
    "oak_stairs",
    "oak_slab",
    "bed",
    "white_bed",
    "bow",
    "arrow",
    "shield",
    "bucket",
    "compass",
    "clock",
    "fishing_rod",
    "shears",
    "lead",
    "book",
    "paper",
  ];

  for (const itemName of priorityItems) {
    const item = mcData.itemsByName[itemName];
    if (!item) continue;

    const recipes = mcData.recipes[item.id];
    if (!recipes || recipes.length === 0) continue;

    const recipe = recipes[0];
    const ingredients = getRecipeIngredients(recipe, mcData);
    const needsTable = requiresCraftingTable(recipe);

    craftables.push({
      name: itemName,
      requiresTable: needsTable,
      ingredients,
    });

    if (craftables.length >= limit) break;
  }

  return craftables;
}

/**
 * Formats recipe information for use in LLM prompts
 * @param {Object} mcData - Minecraft data instance
 * @param {number} limit - Maximum number of recipes to include
 * @returns {string} - Formatted recipe information
 */
function formatRecipesForPrompt(mcData, limit = 30) {
  if (!mcData) return "";

  const craftables = getCommonCraftableItems(mcData, limit);
  const lines = [];

  for (const item of craftables) {
    const ingredientStr = item.ingredients
      .map((i) => `${i.count} ${i.name}`)
      .join(" + ");
    const tableNote = item.requiresTable ? " (needs crafting_table)" : "";
    lines.push(`- ${item.name}: ${ingredientStr}${tableNote}`);
  }

  return lines.join("\n");
}

/**
 * Validates that an item can be crafted and returns helpful info
 * @param {string} itemName - The item to validate
 * @param {Object} mcData - Minecraft data instance
 * @returns {Object} - { valid: boolean, message: string, recipe?: Object }
 */
function validateCraftRequest(itemName, mcData) {
  if (!itemName || !mcData) {
    return { valid: false, message: "Invalid item name or missing data" };
  }

  const item = mcData.itemsByName[itemName];
  if (!item) {
    return {
      valid: false,
      message: `Unknown item "${itemName}" - not found in Minecraft data`,
    };
  }

  const recipes = mcData.recipes[item.id];
  if (!recipes || recipes.length === 0) {
    return {
      valid: false,
      message: `"${itemName}" cannot be crafted - it must be found or obtained another way`,
    };
  }

  const recipe = recipes[0];
  const ingredients = getRecipeIngredients(recipe, mcData);
  const needsTable = requiresCraftingTable(recipe);

  return {
    valid: true,
    message: `Recipe found for "${itemName}"`,
    recipe,
    ingredients,
    requiresTable: needsTable,
  };
}

/**
 * Checks if an item is a raw material (can be collected, not crafted)
 * @param {string} itemName - The item name to check
 * @param {Object} mcData - Minecraft data instance
 * @returns {boolean} - True if the item is a raw material
 */
function isRawMaterial(itemName, mcData) {
  // Check if there's no crafting recipe for this item
  const item = mcData.itemsByName[itemName];
  if (!item) return true; // Unknown items treated as raw materials
  
  const recipes = mcData.recipes[item.id];
  return !recipes || recipes.length === 0;
}

/**
 * Gets the collectible block name for an item
 * Some items are dropped from different blocks (e.g., cobblestone from stone)
 * @param {string} itemName - The item name
 * @param {Object} mcData - Minecraft data instance
 * @returns {string} - The block name to collect
 */
function getCollectibleBlock(itemName, mcData) {
  // Check if this item has a special block source
  if (ITEM_TO_BLOCK_SOURCE[itemName]) {
    return ITEM_TO_BLOCK_SOURCE[itemName];
  }
  
  // Check if a block with this name exists
  const block = mcData.blocksByName[itemName];
  if (block) {
    return itemName;
  }
  
  // For items without a direct block, return the item name
  // The collect handler will deal with it or fail gracefully
  return itemName;
}

/**
 * Recursively resolves all dependencies needed to craft an item.
 * Returns an ordered list of tasks (collect raw materials first, then crafts in dependency order).
 * 
 * @param {string} itemName - The item to craft
 * @param {number} count - How many to craft
 * @param {Object} mcData - Minecraft data instance
 * @param {Object} inventoryMap - Current inventory as { itemName: count } map
 * @param {Set} visited - Set of items being processed (for cycle detection)
 * @param {Object} pendingCrafts - Map of items being crafted and their counts (to avoid duplicates)
 * @returns {Object} - { feasible: boolean, tasks: Array, reason?: string }
 */
function resolveCraftingDependencies(
  itemName,
  count,
  mcData,
  inventoryMap = {},
  visited = new Set(),
  pendingCrafts = {}
) {
  const tasks = [];
  const depth = visited.size;
  
  // Check how many we already have
  const have = inventoryMap[itemName] || 0;
  const alreadyPending = pendingCrafts[itemName] || 0;
  const effectiveHave = have + alreadyPending;
  
  // If we already have enough (including pending crafts), no tasks needed
  if (effectiveHave >= count) {
    return { feasible: true, tasks: [] };
  }
  
  const needed = count - effectiveHave;
  
  // Check if item exists
  const item = mcData.itemsByName[itemName];
  if (!item) {
    // Unknown item - try to collect it as a block
    const block = mcData.blocksByName[itemName];
    if (block) {
      const collectTarget = getCollectibleBlock(itemName, mcData);
      tasks.push({ type: "collect", target: collectTarget, count: needed });
      return { feasible: true, tasks };
    }
    return { 
      feasible: false, 
      tasks: [], 
      reason: `Unknown item: ${itemName}` 
    };
  }
  
  // Check if this item is obtained through smelting (e.g., iron_ingot from raw_iron)
  const smeltInfo = getSmeltInfo(itemName);
  if (smeltInfo) {
    if (depth === 0) {
      console.log(`[Resolver] ${itemName} is obtained via smelting ${smeltInfo.input}`);
    }
    
    // Calculate fuel needed (coal smelts 8 items)
    const fuelNeeded = Math.ceil(needed / 8);
    
    // Recursively resolve the input item (e.g., raw_iron)
    const inputResult = resolveCraftingDependencies(
      smeltInfo.input,
      needed,
      mcData,
      inventoryMap,
      new Set(visited),
      { ...pendingCrafts }
    );
    
    if (!inputResult.feasible) {
      return inputResult;
    }
    tasks.push(...inputResult.tasks);
    
    // Add fuel collection if needed (prefer coal)
    const coalHave = inventoryMap["coal"] || 0;
    const charcoalHave = inventoryMap["charcoal"] || 0;
    const totalFuelHave = coalHave + charcoalHave;
    
    if (totalFuelHave < fuelNeeded) {
      const fuelToCollect = fuelNeeded - totalFuelHave;
      tasks.push({ type: "collect", target: "coal_ore", count: fuelToCollect });
    }
    
    // Add smelt task
    tasks.push({ 
      type: "smelt", 
      input: smeltInfo.input, 
      output: itemName, 
      count: needed 
    });
    
    // Track pending
    pendingCrafts[itemName] = (pendingCrafts[itemName] || 0) + needed;
    
    return { feasible: true, tasks };
  }
  
  // Check if this is a raw material (no recipe)
  if (isRawMaterial(itemName, mcData)) {
    const collectTarget = getCollectibleBlock(itemName, mcData);
    if (depth === 0) {
      console.log(`[Resolver] ${itemName} is a raw material -> collect ${collectTarget}`);
    }
    tasks.push({ type: "collect", target: collectTarget, count: needed });
    return { feasible: true, tasks };
  }
  
  // Circular dependency check
  if (visited.has(itemName)) {
    return { 
      feasible: false, 
      tasks: [], 
      reason: `Circular dependency detected for ${itemName}` 
    };
  }
  visited.add(itemName);
  
  // Get the recipe - select the best one based on ingredient preferences
  const recipes = mcData.recipes[item.id];
  if (!recipes || recipes.length === 0) {
    // Treat as raw material if no recipe found
    const collectTarget = getCollectibleBlock(itemName, mcData);
    tasks.push({ type: "collect", target: collectTarget, count: needed });
    return { feasible: true, tasks };
  }
  
  // Select best recipe based on ingredient preferences (prefers oak over cherry, cobblestone over deepslate, etc.)
  const recipe = selectBestRecipe(recipes, mcData);
  const ingredients = getRecipeIngredients(recipe, mcData);
  
  if (depth === 0) {
    console.log(`[Resolver] ${itemName} requires: ${ingredients.map(i => `${i.count} ${i.name}`).join(', ')}`);
  }
  
  if (ingredients.length === 0) {
    console.log(`[Resolver] WARNING: No ingredients parsed from recipe for ${itemName}`);
  }
  
  // Calculate how many crafts we need to perform
  // Get output count from recipe result
  let outputPerCraft = 1;
  if (recipe.result) {
    outputPerCraft = recipe.result.count || 1;
  }
  const craftTimes = Math.ceil(needed / outputPerCraft);
  
  // Resolve each ingredient recursively
  for (const { name: ingredientName, count: countPerCraft } of ingredients) {
    const totalIngredientNeeded = countPerCraft * craftTimes;
    
    // Recursively resolve this ingredient
    const subResult = resolveCraftingDependencies(
      ingredientName,
      totalIngredientNeeded,
      mcData,
      inventoryMap,
      new Set(visited), // Copy visited set for each branch
      { ...pendingCrafts } // Copy pending crafts
    );
    
    if (!subResult.feasible) {
      return subResult; // Propagate failure
    }
    
    // Add sub-tasks (these are already in correct order)
    tasks.push(...subResult.tasks);
    
    // Track that we'll have this ingredient after sub-tasks complete
    // This is for subsequent ingredients that might also need this item
    pendingCrafts[ingredientName] = (pendingCrafts[ingredientName] || 0) + totalIngredientNeeded;
  }
  
  // Add the craft task for this item
  // NOTE: count is the TOTAL TARGET AMOUNT we want (not additional needed)
  // handleCraft will re-check inventory and calculate how many more to craft
  // We use 'count' (the original parameter) not 'needed' (which subtracts current inventory)
  tasks.push({ type: "craft", target: itemName, count: count });
  
  // Track the actual items we'll get in pending (for dependency calculation)
  const actualOutputCount = craftTimes * outputPerCraft;
  pendingCrafts[itemName] = (pendingCrafts[itemName] || 0) + actualOutputCount;
  
  visited.delete(itemName);
  
  return { feasible: true, tasks };
}

/**
 * Merges and deduplicates tasks (combines multiple collects/crafts/smelts of same item)
 * @param {Array} tasks - Array of tasks to merge
 * @returns {Array} - Merged task array
 */
function mergeTasks(tasks) {
  const collectMap = {};
  const craftMap = {};
  const smeltMap = {}; // key: "input->output", value: { input, output, count }
  const otherTasks = [];
  
  // Group collect, craft, and smelt tasks
  for (const task of tasks) {
    if (task.type === "collect") {
      collectMap[task.target] = (collectMap[task.target] || 0) + task.count;
    } else if (task.type === "craft") {
      craftMap[task.target] = (craftMap[task.target] || 0) + task.count;
    } else if (task.type === "smelt") {
      const key = `${task.input}->${task.output}`;
      if (!smeltMap[key]) {
        smeltMap[key] = { input: task.input, output: task.output, count: 0 };
      }
      smeltMap[key].count += task.count;
    } else {
      otherTasks.push(task);
    }
  }
  
  // Build merged task list: collects first, then smelts, then crafts in order
  const merged = [];
  
  // Add all collect tasks first
  for (const [target, count] of Object.entries(collectMap)) {
    merged.push({ type: "collect", target, count });
  }
  
  // Add smelt tasks (after collection, before crafting)
  const seenSmelts = new Set();
  for (const task of tasks) {
    if (task.type === "smelt") {
      const key = `${task.input}->${task.output}`;
      if (!seenSmelts.has(key)) {
        seenSmelts.add(key);
        const smeltInfo = smeltMap[key];
        merged.push({ type: "smelt", input: smeltInfo.input, output: smeltInfo.output, count: smeltInfo.count });
      }
    }
  }
  
  // Add craft tasks in dependency order (preserve original order for crafts)
  const seenCrafts = new Set();
  for (const task of tasks) {
    if (task.type === "craft" && !seenCrafts.has(task.target)) {
      seenCrafts.add(task.target);
      merged.push({ type: "craft", target: task.target, count: craftMap[task.target] });
    }
  }
  
  // Add any other tasks
  merged.push(...otherTasks);
  
  return merged;
}

/**
 * Main entry point: resolves all dependencies for crafting an item.
 * Returns a deduplicated, ordered list of tasks.
 * 
 * @param {string} itemName - The item to craft
 * @param {number} count - How many to craft
 * @param {Object} mcData - Minecraft data instance
 * @param {Object} inventoryMap - Current inventory as { itemName: count } map
 * @returns {Object} - { feasible: boolean, tasks: Array, reason?: string }
 */
function resolveAllDependencies(itemName, count, mcData, inventoryMap = {}) {
  const result = resolveCraftingDependencies(itemName, count, mcData, inventoryMap);
  
  if (!result.feasible) {
    return result;
  }
  
  // Merge and deduplicate tasks
  const mergedTasks = mergeTasks(result.tasks);
  
  return { feasible: true, tasks: mergedTasks };
}

module.exports = {
  isCraftable,
  getRecipes,
  getRecipeIngredients,
  requiresCraftingTable,
  getCommonCraftableItems,
  formatRecipesForPrompt,
  validateCraftRequest,
  isRawMaterial,
  isSmeltable,
  getSmeltInfo,
  getCollectibleBlock,
  resolveCraftingDependencies,
  resolveAllDependencies,
  mergeTasks,
  selectBestRecipe,
  getRecipePreferenceScore,
  getPreferenceScore,
};


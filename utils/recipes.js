/**
 * Recipe validation and lookup utilities using minecraft-data
 */

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
 * Gets the ingredients required for a recipe
 * @param {Object} recipe - A minecraft-data recipe object
 * @param {Object} mcData - Minecraft data instance
 * @returns {Array} - Array of { name: string, count: number }
 */
function getRecipeIngredients(recipe, mcData) {
  if (!recipe || !mcData) return [];

  const ingredients = [];
  const ingredientMap = {};

  // Handle shaped recipes (inShape)
  if (recipe.inShape) {
    for (const row of recipe.inShape) {
      for (const ingredient of row) {
        if (ingredient && ingredient.id !== undefined && ingredient.id !== -1) {
          const item = mcData.items[ingredient.id];
          if (item) {
            const count = ingredient.count || 1;
            ingredientMap[item.name] = (ingredientMap[item.name] || 0) + count;
          }
        }
      }
    }
  }

  // Handle shapeless recipes (ingredients array)
  if (recipe.ingredients) {
    for (const ingredient of recipe.ingredients) {
      if (ingredient && ingredient.id !== undefined && ingredient.id !== -1) {
        const item = mcData.items[ingredient.id];
        if (item) {
          const count = ingredient.count || 1;
          ingredientMap[item.name] = (ingredientMap[item.name] || 0) + count;
        }
      }
    }
  }

  // Convert map to array
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

module.exports = {
  isCraftable,
  getRecipes,
  getRecipeIngredients,
  requiresCraftingTable,
  getCommonCraftableItems,
  formatRecipesForPrompt,
  validateCraftRequest,
};


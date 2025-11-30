/**
 * Inventory Projection Utilities
 * Calculates projected inventory state after executing queued tasks
 */

/**
 * Creates a map of item counts from inventory array
 * @param {Array} inventory - Array of { name, count } objects
 * @returns {Object} - Map of itemName -> count
 */
export function inventoryToMap(inventory) {
  const map = {};
  for (const item of inventory) {
    if (item && item.name) {
      map[item.name] = (map[item.name] || 0) + (item.count || 0);
    }
  }
  return map;
}

/**
 * Converts inventory map back to array format
 * @param {Object} map - Map of itemName -> count
 * @returns {Array} - Array of { name, count } objects
 */
export function mapToInventory(map) {
  return Object.entries(map)
    .filter(([_, count]) => count > 0)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Applies a single task to the inventory map (mutates the map)
 * @param {Object} inventoryMap - Current inventory map
 * @param {Object} task - Task to apply
 * @param {Object} recipes - Map of itemName -> { ingredients, outputCount }
 * @returns {Object} - The mutated inventory map
 */
export function applyTaskToInventory(inventoryMap, task, recipes = {}) {
  switch (task.type) {
    case 'collect':
      // Add collected items to inventory
      if (task.target && task.count) {
        inventoryMap[task.target] = (inventoryMap[task.target] || 0) + task.count;
      }
      break;
      
    case 'craft':
      // Subtract ingredients, add crafted item
      if (task.target && recipes[task.target]) {
        const recipe = recipes[task.target];
        const craftCount = task.count || 1;
        
        // Subtract ingredients
        if (recipe.ingredients) {
          for (const ingredient of recipe.ingredients) {
            if (ingredient.name && ingredient.count) {
              const required = ingredient.count * craftCount;
              inventoryMap[ingredient.name] = Math.max(0, (inventoryMap[ingredient.name] || 0) - required);
            }
          }
        }
        
        // Add crafted items
        const outputCount = (recipe.outputCount || 1) * craftCount;
        inventoryMap[task.target] = (inventoryMap[task.target] || 0) + outputCount;
      }
      break;
      
    case 'place':
      // Remove placed block from inventory
      if (task.target) {
        inventoryMap[task.target] = Math.max(0, (inventoryMap[task.target] || 0) - 1);
      }
      break;
      
    // move, follow, inventory, stop don't affect inventory
    default:
      break;
  }
  
  return inventoryMap;
}

/**
 * Projects inventory state after executing a list of tasks
 * @param {Array} currentInventory - Current inventory array
 * @param {Array} tasks - Array of tasks to project
 * @param {Object} recipes - Map of itemName -> { ingredients, outputCount }
 * @returns {Array} - Projected inventory array
 */
export function projectInventory(currentInventory, tasks, recipes = {}) {
  const inventoryMap = inventoryToMap(currentInventory);
  
  for (const task of tasks) {
    applyTaskToInventory(inventoryMap, task, recipes);
  }
  
  return mapToInventory(inventoryMap);
}

/**
 * Projects inventory at a specific task index (after all tasks up to and including that index)
 * @param {Array} currentInventory - Current inventory array
 * @param {Array} tasks - Array of tasks
 * @param {number} taskIndex - Index of task to project up to (inclusive)
 * @param {Object} recipes - Map of itemName -> { ingredients, outputCount }
 * @returns {Array} - Projected inventory array
 */
export function projectInventoryAtTask(currentInventory, tasks, taskIndex, recipes = {}) {
  const tasksToApply = tasks.slice(0, taskIndex + 1);
  return projectInventory(currentInventory, tasksToApply, recipes);
}

/**
 * Checks if a craft task is feasible with current/projected inventory
 * @param {Object} task - Craft task { type: 'craft', target, count }
 * @param {Object} inventoryMap - Current inventory as map
 * @param {Object} recipe - Recipe for the item { ingredients, outputCount, requiresTable }
 * @returns {Object} - { feasible: boolean, missing: Array<{ name, required, have, missing }> }
 */
export function checkCraftFeasibility(task, inventoryMap, recipe) {
  if (!recipe || !recipe.ingredients) {
    return { feasible: false, missing: [], error: 'No recipe found' };
  }
  
  const craftCount = task.count || 1;
  const missing = [];
  
  for (const ingredient of recipe.ingredients) {
    const required = ingredient.count * craftCount;
    const have = inventoryMap[ingredient.name] || 0;
    
    if (have < required) {
      missing.push({
        name: ingredient.name,
        required,
        have,
        missing: required - have,
      });
    }
  }
  
  return {
    feasible: missing.length === 0,
    missing,
    requiresTable: recipe.requiresTable || false,
  };
}

/**
 * Checks feasibility of a craft task considering all previous tasks in queue
 * @param {Array} currentInventory - Current inventory array
 * @param {Array} tasks - Array of all tasks
 * @param {number} taskIndex - Index of the craft task to check
 * @param {Object} recipes - Map of itemName -> recipe
 * @returns {Object} - { feasible, missing, requiresTable }
 */
export function checkCraftFeasibilityWithQueue(currentInventory, tasks, taskIndex, recipes) {
  const task = tasks[taskIndex];
  if (!task || task.type !== 'craft') {
    return { feasible: true, missing: [] };
  }
  
  // Project inventory up to (but not including) this task
  const previousTasks = tasks.slice(0, taskIndex);
  const projectedInventory = projectInventory(currentInventory, previousTasks, recipes);
  const inventoryMap = inventoryToMap(projectedInventory);
  
  const recipe = recipes[task.target];
  return checkCraftFeasibility(task, inventoryMap, recipe);
}

/**
 * Calculates feasibility for all craft tasks in the queue
 * @param {Array} currentInventory - Current inventory array
 * @param {Array} tasks - Array of all tasks
 * @param {Object} recipes - Map of itemName -> recipe
 * @returns {Map} - Map of taskIndex -> feasibility result
 */
export function calculateAllFeasibility(currentInventory, tasks, recipes) {
  const results = new Map();
  
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i].type === 'craft') {
      results.set(i, checkCraftFeasibilityWithQueue(currentInventory, tasks, i, recipes));
    }
  }
  
  return results;
}

/**
 * Gets the difference between current and projected inventory
 * @param {Array} currentInventory - Current inventory
 * @param {Array} projectedInventory - Projected inventory
 * @returns {Array} - Array of { name, current, projected, diff }
 */
export function getInventoryDiff(currentInventory, projectedInventory) {
  const currentMap = inventoryToMap(currentInventory);
  const projectedMap = inventoryToMap(projectedInventory);
  
  // Get all unique item names
  const allItems = new Set([
    ...Object.keys(currentMap),
    ...Object.keys(projectedMap),
  ]);
  
  const diff = [];
  for (const name of allItems) {
    const current = currentMap[name] || 0;
    const projected = projectedMap[name] || 0;
    
    if (current !== projected) {
      diff.push({
        name,
        current,
        projected,
        diff: projected - current,
      });
    }
  }
  
  return diff.sort((a, b) => b.diff - a.diff);
}


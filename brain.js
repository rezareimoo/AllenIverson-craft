/**
 * Brain — thin facade over intent parsing + goal expansion.
 * Kept so existing requires of ./brain keep working.
 */

const { parseIntent } = require("./intent/parse");
const { expandGoal } = require("./planner/expandGoal");
const { botState } = require("./state/botState");

/**
 * Process a user request into a task array.
 *
 * @param {string} message
 * @param {object|null} mcData
 * @param {{ speaker?: string }} options
 * @returns {Promise<{ tasks: Array|null, goal: object|null, message?: string, reason?: string, source?: string }>}
 */
async function processUserRequest(message, mcData = null, options = {}) {
  const speaker = options.speaker || null;
  const inventory = botState.getInventory();
  const inventoryMap = botState.getInventoryMap();

  const { goal, source, hint } = await parseIntent(message, {
    speaker,
    inventory,
    mcData,
  });

  if (!goal) {
    return {
      tasks: null,
      goal: null,
      reason: hint || "Couldn't understand that command.",
      source,
    };
  }

  if (goal.intent === "unknown") {
    return {
      tasks: null,
      goal,
      reason: goal.reason || "I don't understand that command.",
      source,
    };
  }

  const expanded = expandGoal(goal, {
    mcData,
    inventoryMap,
    speaker,
  });

  if (!expanded.ok) {
    return {
      tasks: null,
      goal,
      reason: expanded.reason,
      source,
    };
  }

  return {
    tasks: expanded.tasks,
    goal,
    message: expanded.message,
    source,
  };
}

module.exports = {
  processUserRequest,
};

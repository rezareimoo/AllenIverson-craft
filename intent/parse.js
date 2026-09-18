/**
 * Intent parser: patterns first, tiny LLM fallback second.
 */

const { matchPatterns } = require("./patterns");
const { llmFallbackGoal } = require("./llmFallback");

/**
 * Parse a player chat command into a single Goal.
 *
 * @param {string} message - Command text (Allen prefix already stripped)
 * @param {{ speaker: string, inventory?: Array, mcData?: object }} context
 * @returns {Promise<{ goal: object|null, source: 'pattern'|'llm'|'none', hint?: string }>}
 */
async function parseIntent(message, context = {}) {
  const { speaker, mcData } = context;

  const patterned = matchPatterns(message, { speaker, mcData });
  if (patterned) {
    console.log(`[Intent] Pattern match: ${JSON.stringify(patterned)}`);
    return { goal: patterned, source: "pattern" };
  }

  const inventorySummary = summarizeInventory(context.inventory);
  const llmGoal = await llmFallbackGoal(message, {
    speaker,
    inventorySummary,
    mcData,
  });

  if (llmGoal) {
    return { goal: llmGoal, source: "llm" };
  }

  return {
    goal: null,
    source: "none",
    hint: 'Try: "collect 10 oak logs", "make me an iron pickaxe", "bring me 8 oak planks", "come to me", "stop"',
  };
}

function summarizeInventory(inventory) {
  if (!inventory || inventory.length === 0) return "empty";
  const counts = {};
  for (const item of inventory) {
    counts[item.name] = (counts[item.name] || 0) + item.count;
  }
  return Object.entries(counts)
    .slice(0, 20)
    .map(([n, c]) => `${c}x ${n}`)
    .join(", ");
}

module.exports = {
  parseIntent,
};

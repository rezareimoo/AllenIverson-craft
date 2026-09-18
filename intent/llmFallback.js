/**
 * Tiny Ollama fallback: emit a single Goal, not a multi-step plan.
 */

const { Ollama } = require("ollama");
const { resolveItemName } = require("./patterns");

const ollama = new Ollama({
  host: process.env.OLLAMA_HOST || "http://localhost:11434",
});

const VALID_INTENTS = new Set([
  "collect",
  "craft",
  "smelt",
  "give",
  "move",
  "follow",
  "inventory",
  "stop",
  "farm_create",
  "farm_adopt",
  "farm_status",
  "farm_pause",
  "farm_resume",
  "unknown",
]);

/**
 * @param {string} message
 * @param {{ speaker?: string, inventorySummary?: string, mcData?: object }} context
 * @returns {Promise<object|null>} Goal or null
 */
async function llmFallbackGoal(message, context = {}) {
  const { speaker = "Player", inventorySummary = "unknown", mcData = null } =
    context;

  const systemPrompt = `You translate Minecraft player chat into ONE JSON goal object (not a plan).

Speaker username: "${speaker}"
Bot inventory summary: ${inventorySummary}

Output ONLY a JSON object with:
- "intent": one of collect, craft, smelt, give, move, follow, inventory, stop, farm_create, farm_adopt, farm_status, farm_pause, farm_resume, unknown
- "item": exact lowercase snake_case minecraft item/block name when needed
- "crop": wheat, carrot, or potato (also wheat_seeds/carrots/potatoes — normalized internally)
- "count": positive number (default 1)
- "player": username when move/follow/give refers to a person (use "${speaker}" for "me")
- "block": block name for move-to-block
- "reason": short text only for unknown

Rules:
- Do NOT output multi-step plans or arrays.
- For "make/craft X" use intent craft with item X — dependencies are handled elsewhere.
- For "make a wheat farm" use farm_create with crop wheat (not craft).
- For "tend this farm" use farm_adopt.
- For "bring/give me X" use intent give.
- For "come to me" use intent move with player "${speaker}".
- Use exact names like oak_log, iron_pickaxe, cobblestone, raw_iron, iron_ingot.
- If unclear, {"intent":"unknown","reason":"..."}`;

  const jsonSchema = {
    type: "object",
    properties: {
      intent: { type: "string" },
      item: { type: "string" },
      crop: { type: "string" },
      count: { type: "number" },
      player: { type: "string" },
      block: { type: "string" },
      reason: { type: "string" },
    },
    required: ["intent"],
  };

  try {
    const response = await ollama.chat({
      model: process.env.OLLAMA_MODEL || "llama3",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      options: {
        temperature: 0.1,
        num_predict: 120,
      },
      format: jsonSchema,
    });

    let content = (response.message?.content || "").trim();
    content = content
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const objMatch = content.match(/\{[\s\S]*\}/);
    if (objMatch) content = objMatch[0];

    const goal = JSON.parse(content);
    if (!goal || !VALID_INTENTS.has(goal.intent)) {
      return null;
    }

    if (goal.item) {
      goal.item = resolveItemName(goal.item, mcData) || goal.item;
    }
    if (goal.block) {
      goal.block = resolveItemName(goal.block, mcData) || goal.block;
    }
    if (goal.count != null) {
      goal.count = Math.max(1, parseInt(goal.count, 10) || 1);
    } else if (["collect", "craft", "smelt", "give"].includes(goal.intent)) {
      goal.count = 1;
    }

    // Fix "me" / missing player
    if (
      (goal.intent === "move" ||
        goal.intent === "follow" ||
        goal.intent === "give") &&
      (!goal.player || goal.player.toLowerCase() === "me" || goal.player === "Steve")
    ) {
      goal.player = speaker;
    }

    console.log(`[Intent:LLM] Goal: ${JSON.stringify(goal)}`);
    return goal;
  } catch (error) {
    console.error("[Intent:LLM] Fallback failed:", error.message);
    return null;
  }
}

module.exports = {
  llmFallbackGoal,
};

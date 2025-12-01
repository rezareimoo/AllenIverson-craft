/**
 * LLM Brain - Processes natural language requests using Ollama (Llama3)
 */

const { Ollama } = require("ollama");
const {
  validateTasks,
  getCommonNames,
  getCollectibleBlocks,
} = require("./utils/blockNames");
const {
  formatRecipesForPrompt,
  getCommonCraftableItems,
} = require("./utils/recipes");

// Initialize Ollama client
const ollama = new Ollama({
  host: process.env.OLLAMA_HOST || "http://localhost:11434",
});

/**
 * Processes a user's natural language request using Ollama (Llama3)
 * and converts it into an ARRAY of structured JSON tasks for multi-step execution.
 *
 * @param {string} message - The user's chat message
 * @param {Object} mcData - Optional minecraft-data instance for validation (uses default version if not provided)
 * @returns {Promise<Array|null>} - An array of task objects or null if invalid
 */
async function processUserRequest(message, mcData = null) {
  // Get common block/item names for the prompt
  // Use provided mcData or default version
  let commonNames;
  let validationData = mcData;

  if (!validationData) {
    // Use default version for validation if mcData not provided
    try {
      validationData = require("minecraft-data")("1.20.1");
    } catch (e) {
      console.warn("[Brain] Could not load minecraft-data for validation");
    }
  }

  if (validationData) {
    commonNames = getCommonNames("1.20.1");
  } else {
    commonNames = { blocks: [], items: [] };
  }

  // Build block/item name lists for the prompt
  const commonBlocksList = commonNames.blocks.slice(0, 100).join(", ");
  const commonItemsList = commonNames.items.slice(0, 100).join(", ");

  // Generate dynamic recipe information from minecraft-data
  let recipeInfo = "";
  let craftableItemsList = "";
  if (validationData) {
    recipeInfo = formatRecipesForPrompt(validationData, 35);
    const craftables = getCommonCraftableItems(validationData, 50);
    craftableItemsList = craftables.map((c) => c.name).join(", ");
  }

  const systemPrompt = `You are a Minecraft assistant controlling a bot. Translate user commands into a JSON ARRAY of task steps.

CRITICAL: You MUST use EXACT block/item names from Minecraft. All names use lowercase with underscores (e.g., "oak_log", not "Oak Log" or "oak log").

CRITICAL: You MUST always output a JSON ARRAY starting with [ and ending with ]. Even for single tasks, wrap it in an array. Never output a single object without array brackets.

Example for single task: [{"type": "collect", "target": "oak_log", "count": 5}]
Example for multiple tasks: [{"type": "collect", "target": "oak_log", "count": 2}, {"type": "craft", "target": "oak_planks", "count": 8}]

Each task object must have a 'type' field.

Available task types:
- 'collect': Gather blocks/items from the world
- 'craft': Craft items (bot will handle crafting table and smelting automatically)
- 'smelt': Smelt items in a furnace (bot will handle furnace placement automatically)
- 'place': Place a block from inventory
- 'move': Navigate to a block or a player
- 'follow': Continuously follow a player
- 'inventory': Report what items are in the bot's inventory
- 'stop': Stop all actions and clear the queue

IMPORTANT: For items that require smelting (like iron_ingot, gold_ingot), the 'craft' command will automatically handle smelting. You don't need to explicitly use 'smelt' for recipes - just use 'craft' for the final item.

TASK FORMATS:

For 'collect' type:
{ "type": "collect", "target": "<block_name>", "count": <number> }
VALID BLOCK NAMES (use these EXACT names): ${
    commonBlocksList ||
    "oak_log, birch_log, spruce_log, diamond_ore, iron_ore, coal_ore, cobblestone, dirt, sand, stone, grass_block, etc."
  }

For 'craft' type:
{ "type": "craft", "target": "<item_name>", "count": <number> }
VALID ITEM NAMES (use these EXACT names): ${
    commonItemsList ||
    "oak_planks, birch_planks, stick, crafting_table, wooden_pickaxe, stone_pickaxe, iron_pickaxe, diamond_pickaxe, wooden_sword, chest, furnace, torch, etc."
  }

For 'smelt' type (use for direct smelting requests):
{ "type": "smelt", "input": "<input_item>", "output": "<output_item>", "count": <number> }
SMELTING RECIPES:
- iron_ingot: raw_iron (from iron_ore)
- gold_ingot: raw_gold (from gold_ore)
- copper_ingot: raw_copper (from copper_ore)
- glass: sand
- stone: cobblestone
- cooked_beef: beef
- cooked_porkchop: porkchop
- charcoal: oak_log (or any log)

For 'place' type:
{ "type": "place", "target": "<block_name>" }

For 'move' type to a block:
{ "type": "move", "block": "<block_name>", "radius": 3 }

For 'move' type to a player:
{ "type": "move", "player": "<player_name>" }

For 'follow' type:
{ "type": "follow", "player": "<player_name>" }

For 'inventory' type:
{ "type": "inventory" }

For 'stop' type:
{ "type": "stop" }

CRAFTING RECIPES (generated from Minecraft data - use exact item names):
${recipeInfo || `- oak_planks: 1 oak_log
- stick: 2 oak_planks
- crafting_table: 4 oak_planks
- wooden_pickaxe: 3 oak_planks + 2 stick (needs crafting_table)
- stone_pickaxe: 3 cobblestone + 2 stick (needs crafting_table)
- furnace: 8 cobblestone (needs crafting_table)
- chest: 8 oak_planks (needs crafting_table)`}

CRAFTABLE ITEMS (verified from Minecraft data):
${craftableItemsList || "oak_planks, stick, crafting_table, wooden_pickaxe, wooden_sword, wooden_axe, stone_pickaxe, furnace, chest, torch"}

MULTI-STEP PLANNING:
For complex requests, ALWAYS break them into sequential steps. The bot executes tasks in order.

When a user asks for something that requires multiple steps (like crafting an item that needs materials), you MUST create multiple tasks in the array. For example, "make a wooden pickaxe" requires collecting logs, crafting planks, crafting sticks, crafting a crafting table, placing it, and finally crafting the pickaxe - this should be 6 separate tasks in the array.

Example: User says "make me a wooden pickaxe"
Output:
[
  { "type": "collect", "target": "oak_log", "count": 2 },
  { "type": "craft", "target": "oak_planks", "count": 8 },
  { "type": "craft", "target": "stick", "count": 4 },
  { "type": "craft", "target": "crafting_table", "count": 1 },
  { "type": "place", "target": "crafting_table" },
  { "type": "craft", "target": "wooden_pickaxe", "count": 1 }
]

Example: User says "come to me" (assuming user is Steve)
Output:
[
  { "type": "move", "player": "Steve" }
]

Example: User says "go to the crafting table" or "find a crafting table"
Output:
[
  { "type": "move", "block": "crafting_table", "radius": 3 }
]

Example: User says "stop"
Output:
[
  { "type": "stop" }
]

Example: User says "what's in your inventory" or "show me your inventory" or "what do you have"
Output:
[
  { "type": "inventory" }
]

CRITICAL OUTPUT FORMAT:
- Output ONLY a valid JSON array
- Start with [ and end with ]
- No explanations, no markdown code blocks, no text before or after
- Just the raw JSON array
- Example format: [{"type":"collect","target":"oak_log","count":2}]

If the command doesn't make sense, output: [{"type":"unknown","reason":"<brief explanation>"}]

Remember: Always return an array, even for single tasks!`;

  // Define JSON schema to force array response
  const jsonSchema = {
    type: "array",
    items: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: [
            "collect",
            "craft",
            "smelt",
            "place",
            "move",
            "follow",
            "inventory",
            "stop",
            "unknown",
          ],
        },
        target: { type: "string" },
        count: { type: "number" },
        block: { type: "string" },
        radius: { type: "number" },
        player: { type: "string" },
        reason: { type: "string" },
        input: { type: "string" },  // For smelt tasks
        output: { type: "string" }, // For smelt tasks
      },
      required: ["type"],
    },
  };

  try {
    const response = await ollama.chat({
      model: process.env.OLLAMA_MODEL || "llama3",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      options: {
        temperature: 0.1, // Low temperature for consistent JSON output
        num_predict: 800, // Increased for multi-step plans
      },
      format: jsonSchema, // Use JSON schema to force array response
    });

    let content = response.message.content.trim();
    console.log(`[Brain] LLM Response (raw): ${content}`);

    // Remove markdown code blocks if present (```json ... ```)
    content = content
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    // Try to extract JSON from the response if it's wrapped in text
    // Look for JSON array pattern [...]
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      content = jsonMatch[0];
    }

    console.log(`[Brain] LLM Response (cleaned): ${content}`);

    // Parse the JSON response
    let taskArray;
    try {
      taskArray = JSON.parse(content);
    } catch (parseError) {
      console.error(`[Brain] JSON parse error: ${parseError.message}`);
      console.error(`[Brain] Content that failed to parse: ${content}`);
      return null;
    }

    // Ensure it's always an array
    if (!Array.isArray(taskArray)) {
      console.log(
        `[Brain] Response is not an array, converting: ${JSON.stringify(
          taskArray
        )}`
      );
      // If it's an object with a 'type' field, wrap it
      if (taskArray && typeof taskArray === "object" && taskArray.type) {
        taskArray = [taskArray];
      } else {
        console.error(
          `[Brain] Invalid response format: expected array or task object, got: ${typeof taskArray}`
        );
        return null;
      }
    }

    console.log(
      `[Brain] Parsed ${taskArray.length} task(s): ${JSON.stringify(taskArray)}`
    );

    // Validate that each task has a type field
    for (const task of taskArray) {
      if (!task || !task.type) {
        console.error(
          "[Brain] Invalid task in response: missing 'type' field",
          task
        );
        return null;
      }
    }

    // Validate and correct block/item names using minecraft-data
    if (validationData) {
      const originalTasks = JSON.parse(JSON.stringify(taskArray));
      taskArray = validateTasks(taskArray, validationData);

      // Log any corrections made
      for (let i = 0; i < taskArray.length; i++) {
        if (
          originalTasks[i].target &&
          taskArray[i].target !== originalTasks[i].target
        ) {
          console.log(
            `[Brain] Corrected block/item name: "${originalTasks[i].target}" -> "${taskArray[i].target}"`
          );
        }
      }
    }

    console.log(`[Brain] Final validated tasks: ${JSON.stringify(taskArray)}`);

    return taskArray;
  } catch (error) {
    console.error("[Brain] Error processing request:", error.message);
    return null;
  }
}

module.exports = {
  processUserRequest,
};

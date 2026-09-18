/**
 * Expand a high-level Goal into a concrete task queue using the
 * deterministic recipe resolver (no LLM planning).
 */

const { SMELTABLE_ITEMS } = require("../config/constants");
const {
  resolveAllDependencies,
  validateCraftRequest,
} = require("../utils/recipes");
const { resolveItemName } = require("../intent/patterns");
const { normalizeCrop } = require("../farming/crops");

/**
 * @param {object} goal
 * @param {{ mcData: object, inventoryMap?: object, speaker?: string }} context
 * @returns {{ ok: boolean, tasks: Array, message?: string, reason?: string }}
 */
function expandGoal(goal, context = {}) {
  if (!goal || !goal.intent) {
    return { ok: false, tasks: [], reason: "No goal" };
  }

  const { mcData, inventoryMap = {}, speaker } = context;
  const player = goal.player || speaker;

  switch (goal.intent) {
    case "stop":
      return { ok: true, tasks: [{ type: "stop" }], message: "Stopping." };

    case "inventory":
      return {
        ok: true,
        tasks: [{ type: "inventory" }],
        message: "Checking inventory...",
      };

    case "follow":
      if (!player) {
        return { ok: false, tasks: [], reason: "No player to follow" };
      }
      return {
        ok: true,
        tasks: [{ type: "follow", player }],
        message: `Following ${player}.`,
      };

    case "move":
      if (goal.block) {
        return {
          ok: true,
          tasks: [{ type: "move", block: goal.block, radius: goal.radius || 3 }],
          message: `Going to ${goal.block}.`,
        };
      }
      if (player) {
        return {
          ok: true,
          tasks: [{ type: "move", player }],
          message: `Coming to ${player}.`,
        };
      }
      return { ok: false, tasks: [], reason: "Move needs a player or block" };

    case "collect": {
      const item = normalizeItem(goal.item, mcData);
      if (!item) {
        return { ok: false, tasks: [], reason: `Unknown item to collect` };
      }
      const count = Math.max(1, goal.count || 1);
      return {
        ok: true,
        tasks: [{ type: "collect", target: item, count }],
        message: `Collecting ${count} ${item}.`,
      };
    }

    case "craft": {
      const item = normalizeItem(goal.item, mcData);
      if (!item) {
        return { ok: false, tasks: [], reason: "Unknown item to craft" };
      }
      const count = Math.max(1, goal.count || 1);

      if (!mcData) {
        return {
          ok: true,
          tasks: [{ type: "craft", target: item, count }],
          message: `Crafting ${count} ${item}.`,
        };
      }

      const validation = validateCraftRequest(item, mcData);
      // Smeltable-only items (iron_ingot) aren't "craftable" but resolver handles them
      const smeltInfo = SMELTABLE_ITEMS[item];
      if (!validation.valid && !smeltInfo) {
        return { ok: false, tasks: [], reason: validation.message };
      }

      const resolution = resolveAllDependencies(
        item,
        count,
        mcData,
        inventoryMap
      );
      if (!resolution.feasible) {
        return {
          ok: false,
          tasks: [],
          reason: resolution.reason || `Can't make ${item}`,
        };
      }

      const tasks =
        resolution.tasks.length > 0
          ? resolution.tasks
          : [{ type: "craft", target: item, count }];

      return {
        ok: true,
        tasks,
        message: describePlan(item, count, tasks),
      };
    }

    case "smelt": {
      const item = normalizeItem(goal.item, mcData);
      if (!item) {
        return { ok: false, tasks: [], reason: "Unknown item to smelt" };
      }
      const count = Math.max(1, goal.count || 1);
      const smeltInfo = SMELTABLE_ITEMS[item];
      if (!smeltInfo) {
        // Maybe they named the input (raw_iron) — find output
        const asOutput = Object.entries(SMELTABLE_ITEMS).find(
          ([, v]) => v.input === item
        );
        if (asOutput) {
          return {
            ok: true,
            tasks: [
              {
                type: "smelt",
                input: item,
                output: asOutput[0],
                count,
              },
            ],
            message: `Smelting ${count} ${asOutput[0]}.`,
          };
        }
        return {
          ok: false,
          tasks: [],
          reason: `I don't know how to smelt ${item}`,
        };
      }
      return {
        ok: true,
        tasks: [
          {
            type: "smelt",
            input: smeltInfo.input,
            output: item,
            count,
          },
        ],
        message: `Smelting ${count} ${item}.`,
      };
    }

    case "give": {
      const item = normalizeItem(goal.item, mcData);
      if (!item) {
        return { ok: false, tasks: [], reason: "Unknown item to give" };
      }
      if (!player) {
        return { ok: false, tasks: [], reason: "No player to give items to" };
      }
      const count = Math.max(1, goal.count || 1);
      const have = inventoryMap[item] || 0;
      const tasks = [];

      if (have < count && mcData) {
        const smeltInfo = SMELTABLE_ITEMS[item];
        const craftable =
          smeltInfo ||
          (mcData.itemsByName[item] &&
            mcData.recipes[mcData.itemsByName[item].id]);

        if (craftable || smeltInfo) {
          const resolution = resolveAllDependencies(
            item,
            count,
            mcData,
            inventoryMap
          );
          if (resolution.feasible && resolution.tasks.length > 0) {
            tasks.push(...resolution.tasks);
          } else if (!resolution.feasible) {
            tasks.push({ type: "collect", target: item, count });
          }
        } else {
          tasks.push({ type: "collect", target: item, count });
        }
      }

      tasks.push({ type: "give", target: item, count, player });
      return {
        ok: true,
        tasks,
        message: `Getting ${count} ${item} for ${player}.`,
      };
    }

    case "farm_create": {
      const crop = normalizeCrop(goal.crop || "wheat");
      if (!crop) {
        return {
          ok: false,
          tasks: [],
          reason: "I can make wheat, carrot, or potato farms.",
        };
      }
      return {
        ok: true,
        tasks: [{ type: "farm_create", crop }],
        message: `Setting up a ${crop} farm here.`,
      };
    }

    case "farm_adopt": {
      const crop = goal.crop ? normalizeCrop(goal.crop) : null;
      return {
        ok: true,
        tasks: [{ type: "farm_adopt", crop }],
        message: "Looking for farmland to adopt...",
      };
    }

    case "farm_status":
      return {
        ok: true,
        tasks: [{ type: "farm_status" }],
        message: "Checking farms...",
      };

    case "farm_pause":
      return {
        ok: true,
        tasks: [{ type: "farm_pause" }],
        message: "Pausing farm tending.",
      };

    case "farm_resume":
      return {
        ok: true,
        tasks: [{ type: "farm_resume" }],
        message: "Resuming farm tending.",
      };

    case "unknown":
      return {
        ok: false,
        tasks: [],
        reason: goal.reason || "I don't understand that",
      };

    default:
      return {
        ok: false,
        tasks: [],
        reason: `Unknown intent: ${goal.intent}`,
      };
  }
}

function normalizeItem(item, mcData) {
  if (!item) return null;
  return resolveItemName(item, mcData) || item;
}

function describePlan(item, count, tasks) {
  const collects = tasks.filter((t) => t.type === "collect");
  const crafts = tasks.filter((t) => t.type === "craft");
  const smelts = tasks.filter((t) => t.type === "smelt");
  const parts = [];
  if (collects.length) {
    parts.push(
      `need ${collects.map((t) => `${t.count} ${t.target}`).join(", ")}`
    );
  }
  if (smelts.length) {
    parts.push(`smelt ${smelts.map((t) => t.output).join(", ")}`);
  }
  if (crafts.length) {
    parts.push(`${crafts.length} craft step(s)`);
  }
  const detail = parts.length ? ` (${parts.join("; ")})` : "";
  return `On it — ${item} x${count}${detail}`;
}

module.exports = {
  expandGoal,
};

import { useState, useMemo } from "react";
import { getInventoryDiff } from "../utils/inventoryProjection";

/**
 * Format item name for display
 */
function formatItemName(name) {
  if (!name) return "";
  // Shorten long names
  const formatted = name.replace(/_/g, " ");
  if (formatted.length > 10) {
    return formatted.substring(0, 8) + "..";
  }
  return formatted;
}

/**
 * Single inventory slot
 */
function InventorySlot({ item, diffAmount }) {
  const hasDiff = diffAmount !== undefined && diffAmount !== 0;

  return (
    <div
      className="mc-slot"
      title={
        item ? `${item.name.replace(/_/g, " ")} (${item.count})` : "Empty slot"
      }
    >
      {item && (
        <>
          <div className="mc-slot__icon">{formatItemName(item.name)}</div>
          <div className="mc-slot__count">
            {item.count}
            {hasDiff && (
              <span
                style={{
                  color:
                    diffAmount > 0 ? "var(--mc-success)" : "var(--mc-error)",
                  fontSize: "0.8rem",
                  marginLeft: "2px",
                }}
              >
                {diffAmount > 0 ? `+${diffAmount}` : diffAmount}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Inventory Panel Component
 * Shows current and projected inventory
 */
export function InventoryPanel({
  inventory = [],
  projectedInventory = [],
  showProjection = false,
  onToggleProjection,
}) {
  const [viewMode, setViewMode] = useState("current"); // 'current', 'projected', 'diff'

  // Aggregate inventory items by name
  const aggregatedInventory = useMemo(() => {
    const map = {};
    for (const item of inventory) {
      if (item && item.name) {
        if (!map[item.name]) {
          map[item.name] = { name: item.name, count: 0 };
        }
        map[item.name].count += item.count || 0;
      }
    }
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }, [inventory]);

  // Aggregate projected inventory
  const aggregatedProjected = useMemo(() => {
    const map = {};
    for (const item of projectedInventory) {
      if (item && item.name) {
        if (!map[item.name]) {
          map[item.name] = { name: item.name, count: 0 };
        }
        map[item.name].count += item.count || 0;
      }
    }
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }, [projectedInventory]);

  // Calculate diff between current and projected
  const inventoryDiff = useMemo(() => {
    return getInventoryDiff(aggregatedInventory, aggregatedProjected);
  }, [aggregatedInventory, aggregatedProjected]);

  // Create diff map for quick lookup
  const diffMap = useMemo(() => {
    const map = {};
    for (const diff of inventoryDiff) {
      map[diff.name] = diff.diff;
    }
    return map;
  }, [inventoryDiff]);

  // Get display inventory based on view mode
  const displayInventory = useMemo(() => {
    if (viewMode === "projected") {
      return aggregatedProjected;
    }
    return aggregatedInventory;
  }, [viewMode, aggregatedInventory, aggregatedProjected]);

  // Fill grid with empty slots
  const gridItems = useMemo(() => {
    const items = [...displayInventory];
    // Pad to at least 27 slots (3 rows of 9)
    while (items.length < 27) {
      items.push(null);
    }
    return items;
  }, [displayInventory]);

  const hasChanges = inventoryDiff.length > 0;

  return (
    <div className="mc-panel">
      <div
        className="mc-panel__header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>Inventory</span>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            className={`mc-button mc-button--small ${
              viewMode === "current" ? "mc-button--primary" : ""
            }`}
            onClick={() => setViewMode("current")}
          >
            Current
          </button>
          <button
            className={`mc-button mc-button--small ${
              viewMode === "projected" ? "mc-button--primary" : ""
            }`}
            onClick={() => setViewMode("projected")}
            disabled={!hasChanges}
            title={
              hasChanges
                ? "Show projected inventory after tasks"
                : "No pending tasks"
            }
          >
            Projected
          </button>
        </div>
      </div>

      {inventory.length === 0 && projectedInventory.length === 0 ? (
        <div className="mc-empty-state">
          <div className="mc-empty-state__icon">🎒</div>
          <div>Inventory is empty</div>
        </div>
      ) : (
        <>
          <div className="mc-inventory-grid">
            {gridItems.map((item, index) => (
              <InventorySlot
                key={index}
                item={item}
                diffAmount={
                  viewMode === "current" && item
                    ? diffMap[item.name]
                    : undefined
                }
              />
            ))}
          </div>

          {viewMode === "current" && hasChanges && (
            <div style={{ marginTop: "12px" }}>
              <div
                className="mc-text-small"
                style={{ color: "var(--mc-text)", marginBottom: "8px" }}
              >
                Changes after queue completion:
              </div>
              <div
                style={{
                  maxHeight: "100px",
                  overflowY: "auto",
                  background: "var(--mc-stone-dark)",
                  padding: "8px",
                  borderRadius: "0",
                  border: "2px solid var(--mc-border)",
                }}
              >
                {inventoryDiff.map((diff) => (
                  <div
                    key={diff.name}
                    className="mc-text-small"
                    style={{
                      color:
                        diff.diff > 0 ? "var(--mc-success)" : "var(--mc-error)",
                      padding: "2px 0",
                    }}
                  >
                    {diff.name.replace(/_/g, " ")}: {diff.current} →{" "}
                    {diff.projected}({diff.diff > 0 ? "+" : ""}
                    {diff.diff})
                  </div>
                ))}
              </div>
            </div>
          )}

          <div
            className="mc-text-small"
            style={{
              marginTop: "8px",
              color: "var(--mc-stone)",
              textAlign: "center",
            }}
          >
            {displayInventory.length} unique item
            {displayInventory.length !== 1 ? "s" : ""} •
            {displayInventory.reduce(
              (sum, item) => sum + (item?.count || 0),
              0
            )}{" "}
            total
          </div>
        </>
      )}
    </div>
  );
}

export default InventoryPanel;

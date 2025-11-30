/**
 * Shows whether a craft task is feasible based on available/projected inventory
 */
export function FeasibilityIndicator({ feasibility }) {
  if (!feasibility) return null;

  const { feasible, missing, requiresTable, error } = feasibility;

  if (error) {
    return (
      <div className="mc-feasibility mc-feasibility--not-feasible">
        <span className="mc-feasibility__icon">?</span>
        <span>{error}</span>
      </div>
    );
  }

  if (feasible) {
    return (
      <div className="mc-feasibility mc-feasibility--feasible">
        <span className="mc-feasibility__icon">✓</span>
        <div>
          <span>Craftable</span>
          {requiresTable && (
            <span style={{ fontSize: '0.9rem', marginLeft: '8px', opacity: 0.8 }}>
              (needs crafting table)
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mc-feasibility mc-feasibility--not-feasible">
      <span className="mc-feasibility__icon">✗</span>
      <div>
        <span>Missing materials</span>
        {requiresTable && (
          <span style={{ fontSize: '0.9rem', marginLeft: '8px', opacity: 0.8 }}>
            (needs crafting table)
          </span>
        )}
        <div className="mc-feasibility__missing">
          {missing.map((item) => (
            <div key={item.name}>
              {item.name.replace(/_/g, ' ')}: need {item.required}, have {item.have}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default FeasibilityIndicator;


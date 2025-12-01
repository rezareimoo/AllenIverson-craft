import { useState, useEffect, useCallback } from 'react';
import BlockItemSelector from './BlockItemSelector';
import FeasibilityIndicator from './FeasibilityIndicator';
import { inventoryToMap, checkCraftFeasibility } from '../utils/inventoryProjection';

const TASK_TYPES = [
  { value: 'collect', label: 'Collect', description: 'Gather blocks/items from the world' },
  { value: 'craft', label: 'Craft', description: 'Craft items using recipes' },
  { value: 'smelt', label: 'Smelt', description: 'Smelt items in a furnace' },
  { value: 'place', label: 'Place', description: 'Place a block from inventory' },
  { value: 'move', label: 'Move', description: 'Navigate to a block or player' },
  { value: 'follow', label: 'Follow', description: 'Continuously follow a player' },
  { value: 'inventory', label: 'Inventory', description: 'Show current inventory' },
  { value: 'stop', label: 'Stop', description: 'Stop all actions' },
];

// Common smelting recipes (input -> output)
const SMELT_RECIPES = [
  { input: 'raw_iron', output: 'iron_ingot', label: 'Iron Ingot (from Raw Iron)' },
  { input: 'raw_gold', output: 'gold_ingot', label: 'Gold Ingot (from Raw Gold)' },
  { input: 'raw_copper', output: 'copper_ingot', label: 'Copper Ingot (from Raw Copper)' },
  { input: 'sand', output: 'glass', label: 'Glass (from Sand)' },
  { input: 'cobblestone', output: 'stone', label: 'Stone (from Cobblestone)' },
  { input: 'stone', output: 'smooth_stone', label: 'Smooth Stone (from Stone)' },
  { input: 'clay_ball', output: 'brick', label: 'Brick (from Clay Ball)' },
  { input: 'netherrack', output: 'nether_brick', label: 'Nether Brick (from Netherrack)' },
  { input: 'oak_log', output: 'charcoal', label: 'Charcoal (from Log)' },
  { input: 'beef', output: 'cooked_beef', label: 'Cooked Beef (from Beef)' },
  { input: 'porkchop', output: 'cooked_porkchop', label: 'Cooked Porkchop (from Porkchop)' },
  { input: 'chicken', output: 'cooked_chicken', label: 'Cooked Chicken (from Chicken)' },
  { input: 'mutton', output: 'cooked_mutton', label: 'Cooked Mutton (from Mutton)' },
  { input: 'cod', output: 'cooked_cod', label: 'Cooked Cod (from Cod)' },
  { input: 'salmon', output: 'cooked_salmon', label: 'Cooked Salmon (from Salmon)' },
  { input: 'potato', output: 'baked_potato', label: 'Baked Potato (from Potato)' },
  { input: 'cactus', output: 'green_dye', label: 'Green Dye (from Cactus)' },
  { input: 'ancient_debris', output: 'netherite_scrap', label: 'Netherite Scrap (from Ancient Debris)' },
];

/**
 * Task Builder Component
 * Creates tasks based on selected type with dynamic form fields
 */
export function TaskBuilder({ 
  onAddTask, 
  blocks = [], 
  items = [], 
  allItems = [],
  players = [],
  inventory = [],
  projectedInventory = [],
  fetchRecipe,
  recipes = {},
}) {
  const [taskType, setTaskType] = useState('collect');
  const [target, setTarget] = useState('');
  const [count, setCount] = useState(1);
  const [moveTarget, setMoveTarget] = useState('block'); // 'block' or 'player'
  const [playerName, setPlayerName] = useState('');
  const [radius, setRadius] = useState(3);
  const [feasibility, setFeasibility] = useState(null);
  const [isLoadingRecipe, setIsLoadingRecipe] = useState(false);
  const [smeltRecipe, setSmeltRecipe] = useState(''); // For smelt task

  // Check craft feasibility when target changes
  useEffect(() => {
    const checkFeasibility = async () => {
      if (taskType !== 'craft' || !target) {
        setFeasibility(null);
        return;
      }

      setIsLoadingRecipe(true);
      
      try {
        // Use projected inventory for feasibility check
        const inventoryToUse = projectedInventory.length > 0 ? projectedInventory : inventory;
        const inventoryMap = inventoryToMap(inventoryToUse);
        
        // Check if we have the recipe cached
        let recipe = recipes[target];
        
        // If not cached, fetch it
        if (!recipe && fetchRecipe) {
          recipe = await fetchRecipe(target);
        }

        if (recipe) {
          const result = checkCraftFeasibility(
            { type: 'craft', target, count },
            inventoryMap,
            recipe
          );
          setFeasibility(result);
        } else {
          setFeasibility({ feasible: false, missing: [], error: 'No recipe found' });
        }
      } catch (error) {
        console.error('Error checking feasibility:', error);
        setFeasibility({ feasible: false, missing: [], error: 'Error checking recipe' });
      } finally {
        setIsLoadingRecipe(false);
      }
    };

    const debounceTimer = setTimeout(checkFeasibility, 300);
    return () => clearTimeout(debounceTimer);
  }, [taskType, target, count, inventory, projectedInventory, recipes, fetchRecipe]);

  // Reset form when task type changes
  useEffect(() => {
    setTarget('');
    setCount(1);
    setPlayerName('');
    setFeasibility(null);
    setSmeltRecipe('');
  }, [taskType]);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    
    let task = { type: taskType };
    
    switch (taskType) {
      case 'collect':
        if (!target) return;
        task.target = target;
        task.count = Math.max(1, parseInt(count) || 1);
        break;
        
      case 'craft':
        if (!target) return;
        task.target = target;
        task.count = Math.max(1, parseInt(count) || 1);
        break;
      
      case 'smelt':
        if (!smeltRecipe) return;
        const selectedSmelt = SMELT_RECIPES.find(r => `${r.input}->${r.output}` === smeltRecipe);
        if (!selectedSmelt) return;
        task.input = selectedSmelt.input;
        task.output = selectedSmelt.output;
        task.count = Math.max(1, parseInt(count) || 1);
        break;
        
      case 'place':
        if (!target) return;
        task.target = target;
        break;
        
      case 'move':
        if (moveTarget === 'block') {
          if (!target) return;
          task.block = target;
          task.radius = Math.max(1, parseInt(radius) || 3);
        } else {
          if (!playerName) return;
          task.player = playerName;
        }
        break;
        
      case 'follow':
        if (!playerName) return;
        task.player = playerName;
        break;
        
      case 'inventory':
      case 'stop':
        // No additional fields needed
        break;
    }
    
    onAddTask?.(task);
    
    // Reset form
    setTarget('');
    setCount(1);
    setPlayerName('');
  }, [taskType, target, count, moveTarget, playerName, radius, onAddTask]);

  const getItemsForType = () => {
    switch (taskType) {
      case 'collect':
        return blocks;
      case 'craft':
        return items;
      case 'place':
      case 'move':
        return allItems;
      default:
        return [];
    }
  };

  const renderFields = () => {
    switch (taskType) {
      case 'collect':
        return (
          <>
            <div className="mc-form-group">
              <label className="mc-form-group__label">Block to Collect</label>
              <BlockItemSelector
                items={getItemsForType()}
                value={target}
                onChange={setTarget}
                placeholder="Search blocks..."
              />
            </div>
            <div className="mc-form-group">
              <label className="mc-form-group__label">Amount</label>
              <input
                type="number"
                className="mc-input"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                min="1"
                max="64"
              />
            </div>
          </>
        );
        
      case 'craft':
        return (
          <>
            <div className="mc-form-group">
              <label className="mc-form-group__label">Item to Craft</label>
              <BlockItemSelector
                items={getItemsForType()}
                value={target}
                onChange={setTarget}
                placeholder="Search craftable items..."
              />
            </div>
            <div className="mc-form-group">
              <label className="mc-form-group__label">Amount</label>
              <input
                type="number"
                className="mc-input"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                min="1"
                max="64"
              />
            </div>
            {target && (
              <div className="mc-form-group">
                {isLoadingRecipe ? (
                  <div className="mc-text-small" style={{ color: 'var(--mc-info)' }}>
                    Checking recipe...
                  </div>
                ) : (
                  <FeasibilityIndicator feasibility={feasibility} />
                )}
              </div>
            )}
          </>
        );
      
      case 'smelt':
        return (
          <>
            <div className="mc-form-group">
              <label className="mc-form-group__label">Smelting Recipe</label>
              <select
                className="mc-select"
                value={smeltRecipe}
                onChange={(e) => setSmeltRecipe(e.target.value)}
              >
                <option value="">Select what to smelt...</option>
                {SMELT_RECIPES.map((recipe) => (
                  <option 
                    key={`${recipe.input}->${recipe.output}`} 
                    value={`${recipe.input}->${recipe.output}`}
                  >
                    {recipe.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="mc-form-group">
              <label className="mc-form-group__label">Amount</label>
              <input
                type="number"
                className="mc-input"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                min="1"
                max="64"
              />
            </div>
            <div className="mc-text-small" style={{ color: 'var(--mc-stone)', marginBottom: '8px' }}>
              Bot will find/craft a furnace and collect fuel automatically.
            </div>
          </>
        );
        
      case 'place':
        return (
          <div className="mc-form-group">
            <label className="mc-form-group__label">Block to Place</label>
            <BlockItemSelector
              items={getItemsForType()}
              value={target}
              onChange={setTarget}
              placeholder="Search blocks..."
            />
          </div>
        );
        
      case 'move':
        return (
          <>
            <div className="mc-form-group">
              <label className="mc-form-group__label">Move To</label>
              <select
                className="mc-select"
                value={moveTarget}
                onChange={(e) => setMoveTarget(e.target.value)}
              >
                <option value="block">Block</option>
                <option value="player">Player</option>
              </select>
            </div>
            
            {moveTarget === 'block' ? (
              <>
                <div className="mc-form-group">
                  <label className="mc-form-group__label">Target Block</label>
                  <BlockItemSelector
                    items={getItemsForType()}
                    value={target}
                    onChange={setTarget}
                    placeholder="Search blocks..."
                  />
                </div>
                <div className="mc-form-group">
                  <label className="mc-form-group__label">Stop Distance (blocks)</label>
                  <input
                    type="number"
                    className="mc-input"
                    value={radius}
                    onChange={(e) => setRadius(e.target.value)}
                    min="1"
                    max="10"
                  />
                </div>
              </>
            ) : (
              <div className="mc-form-group">
                <label className="mc-form-group__label">Player Name</label>
                {players.length > 0 ? (
                  <select
                    className="mc-select"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                  >
                    <option value="">Select a player...</option>
                    {players.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name} {p.entity ? '(visible)' : '(not visible)'}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    className="mc-input"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    placeholder="Enter player name..."
                  />
                )}
              </div>
            )}
          </>
        );
        
      case 'follow':
        return (
          <div className="mc-form-group">
            <label className="mc-form-group__label">Player to Follow</label>
            {players.length > 0 ? (
              <select
                className="mc-select"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
              >
                <option value="">Select a player...</option>
                {players.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} {p.entity ? '(visible)' : '(not visible)'}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                className="mc-input"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Enter player name..."
              />
            )}
          </div>
        );
        
      case 'inventory':
      case 'stop':
        return (
          <div className="mc-text-small" style={{ color: 'var(--mc-stone)', marginBottom: '16px' }}>
            This action has no additional options.
          </div>
        );
        
      default:
        return null;
    }
  };

  const isFormValid = () => {
    switch (taskType) {
      case 'collect':
      case 'craft':
      case 'place':
        return !!target;
      case 'smelt':
        return !!smeltRecipe;
      case 'move':
        return moveTarget === 'block' ? !!target : !!playerName;
      case 'follow':
        return !!playerName;
      case 'inventory':
      case 'stop':
        return true;
      default:
        return false;
    }
  };

  const selectedTypeInfo = TASK_TYPES.find(t => t.value === taskType);

  return (
    <div className="mc-panel">
      <div className="mc-panel__header">Add Task</div>
      
      <form onSubmit={handleSubmit}>
        <div className="mc-form-group">
          <label className="mc-form-group__label">Task Type</label>
          <select
            className="mc-select"
            value={taskType}
            onChange={(e) => setTaskType(e.target.value)}
          >
            {TASK_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
          {selectedTypeInfo && (
            <div className="mc-text-small" style={{ marginTop: '4px', color: 'var(--mc-stone)' }}>
              {selectedTypeInfo.description}
            </div>
          )}
        </div>
        
        {renderFields()}
        
        <button
          type="submit"
          className="mc-button mc-button--primary"
          disabled={!isFormValid()}
          style={{ width: '100%' }}
        >
          Add to Queue
        </button>
      </form>
    </div>
  );
}

export default TaskBuilder;


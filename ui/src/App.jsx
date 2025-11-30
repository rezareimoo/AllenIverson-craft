import { useState, useEffect, useCallback, useMemo } from 'react';
import { useBotSocket } from './hooks/useBotSocket';
import { TaskBuilder } from './components/TaskBuilder';
import { TaskQueue } from './components/TaskQueue';
import { InventoryPanel } from './components/InventoryPanel';
import { 
  projectInventory, 
  calculateAllFeasibility,
  inventoryToMap,
} from './utils/inventoryProjection';

function App() {
  const {
    connected,
    botStatus,
    queue,
    isExecuting,
    currentTask,
    inventory,
    lastEvent,
    fetchQueue,
    addTasks,
    removeTask,
    clearQueue,
    fetchInventory,
    fetchStatus,
    fetchBlocks,
    fetchItems,
    fetchAllItems,
    fetchRecipe,
    fetchPlayers,
  } = useBotSocket();

  // Data loaded from API
  const [blocks, setBlocks] = useState([]);
  const [items, setItems] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [players, setPlayers] = useState([]);
  const [recipes, setRecipes] = useState({});
  const [notification, setNotification] = useState(null);

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      const [blocksData, itemsData, allItemsData, playersData] = await Promise.all([
        fetchBlocks(),
        fetchItems(),
        fetchAllItems(),
        fetchPlayers(),
      ]);
      
      setBlocks(blocksData || []);
      
      // Items come with recipe info
      if (itemsData) {
        setItems(itemsData.map(i => i.name || i));
        // Build recipes map
        const recipesMap = {};
        for (const item of itemsData) {
          if (item.name && item.ingredients) {
            recipesMap[item.name] = {
              ingredients: item.ingredients,
              requiresTable: item.requiresTable,
              outputCount: 1, // Default, could be enhanced
            };
          }
        }
        setRecipes(recipesMap);
      }
      
      setAllItems(allItemsData?.blocks || []);
      setPlayers(playersData || []);
    };
    
    loadData();
    
    // Refresh players periodically
    const playersInterval = setInterval(async () => {
      const playersData = await fetchPlayers();
      setPlayers(playersData || []);
    }, 5000);
    
    return () => clearInterval(playersInterval);
  }, [fetchBlocks, fetchItems, fetchAllItems, fetchPlayers]);

  // Fetch recipe and cache it
  const handleFetchRecipe = useCallback(async (itemName) => {
    if (recipes[itemName]) {
      return recipes[itemName];
    }
    
    const recipe = await fetchRecipe(itemName);
    if (recipe) {
      setRecipes(prev => ({
        ...prev,
        [itemName]: recipe,
      }));
    }
    return recipe;
  }, [recipes, fetchRecipe]);

  // Calculate projected inventory
  const projectedInventory = useMemo(() => {
    if (queue.length === 0) return inventory;
    return projectInventory(inventory, queue, recipes);
  }, [inventory, queue, recipes]);

  // Calculate feasibility for all craft tasks
  const feasibilityMap = useMemo(() => {
    return calculateAllFeasibility(inventory, queue, recipes);
  }, [inventory, queue, recipes]);

  // Handle task events
  useEffect(() => {
    if (!lastEvent) return;
    
    let message = '';
    let type = 'info';
    
    switch (lastEvent.type) {
      case 'started':
        message = `Started: ${lastEvent.task?.type}`;
        type = 'info';
        break;
      case 'completed':
        message = `Completed: ${lastEvent.task?.type}`;
        type = 'success';
        break;
      case 'failed':
        message = `Failed: ${lastEvent.message || lastEvent.task?.type}`;
        type = 'error';
        break;
    }
    
    if (message) {
      setNotification({ message, type, timestamp: lastEvent.timestamp });
      setTimeout(() => setNotification(null), 3000);
    }
  }, [lastEvent]);

  // Add task handler
  const handleAddTask = useCallback(async (task) => {
    const result = await addTasks([task]);
    if (result.success) {
      setNotification({ 
        message: `Added ${task.type} task to queue`, 
        type: 'success',
        timestamp: Date.now(),
      });
      setTimeout(() => setNotification(null), 2000);
    }
  }, [addTasks]);

  // Remove task handler
  const handleRemoveTask = useCallback(async (index) => {
    const result = await removeTask(index);
    if (!result.success) {
      setNotification({
        message: result.error || 'Failed to remove task',
        type: 'error',
        timestamp: Date.now(),
      });
      setTimeout(() => setNotification(null), 2000);
    }
  }, [removeTask]);

  // Clear queue handler
  const handleClearQueue = useCallback(async () => {
    const result = await clearQueue();
    if (result.success) {
      setNotification({
        message: 'Queue cleared',
        type: 'success',
        timestamp: Date.now(),
      });
      setTimeout(() => setNotification(null), 2000);
    }
  }, [clearQueue]);

  // Reorder queue handler (currently just updates local state - would need API support for persistence)
  const handleReorderQueue = useCallback(async (newQueue) => {
    // For now, we'd need to clear and re-add tasks to change order via API
    // This is a limitation - full implementation would need a reorder endpoint
    console.log('Reorder requested:', newQueue);
  }, []);

  return (
    <div className="app-container mc-background">
      {/* Header */}
      <header className="app-header">
        <div>
          <h1 className="mc-title">AllenIverson Bot</h1>
          <p className="mc-subtitle">Task Queue Manager</p>
        </div>
        <div className="app-header__status">
          <div className={`status-dot ${botStatus.connected ? 'status-dot--connected' : 'status-dot--disconnected'}`} />
          <span className="mc-text">
            {botStatus.connected ? `Connected (${botStatus.version})` : 'Disconnected'}
          </span>
          {botStatus.connected && currentTask && (
            <span className="mc-badge mc-badge--running">
              {currentTask.type}
            </span>
          )}
        </div>
      </header>

      {/* Notification Toast */}
      {notification && (
        <div 
          style={{
            position: 'fixed',
            top: '100px',
            right: '20px',
            zIndex: 1000,
            animation: 'fadeIn 0.2s ease',
          }}
        >
          <div className={`mc-badge mc-badge--${notification.type === 'success' ? 'success' : notification.type === 'error' ? 'error' : 'info'}`}
            style={{ padding: '12px 20px', fontSize: '1.1rem' }}>
            {notification.message}
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="main-content">
        {/* Task Queue */}
        <TaskQueue
          queue={queue}
          isExecuting={isExecuting}
          onRemoveTask={handleRemoveTask}
          onClearQueue={handleClearQueue}
          onReorderQueue={handleReorderQueue}
          feasibilityMap={feasibilityMap}
        />
        
        {/* Task Builder */}
        <TaskBuilder
          onAddTask={handleAddTask}
          blocks={blocks}
          items={items}
          allItems={allItems}
          players={players}
          inventory={inventory}
          projectedInventory={projectedInventory}
          fetchRecipe={handleFetchRecipe}
          recipes={recipes}
        />
      </main>

      {/* Sidebar - Inventory */}
      <aside className="sidebar">
        <InventoryPanel
          inventory={inventory}
          projectedInventory={projectedInventory}
        />
        
        {/* Bot Status Info */}
        {botStatus.connected && (
          <div className="mc-panel">
            <div className="mc-panel__header">Bot Status</div>
            <div className="mc-text-small" style={{ color: 'var(--mc-text)' }}>
              {botStatus.position && (
                <div style={{ marginBottom: '8px' }}>
                  <strong>Position:</strong> {' '}
                  X: {botStatus.position.x?.toFixed(1)}, {' '}
                  Y: {botStatus.position.y?.toFixed(1)}, {' '}
                  Z: {botStatus.position.z?.toFixed(1)}
                </div>
              )}
              {botStatus.health !== undefined && (
                <div style={{ marginBottom: '4px' }}>
                  <strong>Health:</strong> {botStatus.health}/20
                </div>
              )}
              {botStatus.food !== undefined && (
                <div>
                  <strong>Food:</strong> {botStatus.food}/20
                </div>
              )}
            </div>
          </div>
        )}

        {/* Help Panel */}
        <div className="mc-panel" style={{ background: 'var(--mc-stone-dark)' }}>
          <div className="mc-panel__header" style={{ color: 'var(--mc-text-light)', borderColor: 'var(--mc-stone)' }}>
            Quick Help
          </div>
          <div className="mc-text-small" style={{ color: 'var(--mc-inventory-bg)' }}>
            <p style={{ marginBottom: '8px' }}>
              <strong>Collect:</strong> Gather blocks from the world
            </p>
            <p style={{ marginBottom: '8px' }}>
              <strong>Craft:</strong> Create items using recipes
            </p>
            <p style={{ marginBottom: '8px' }}>
              <strong>Place:</strong> Place blocks from inventory
            </p>
            <p style={{ marginBottom: '8px' }}>
              <strong>Move:</strong> Navigate to blocks or players
            </p>
            <p style={{ marginBottom: '8px' }}>
              <strong>Follow:</strong> Continuously follow a player
            </p>
            <p>
              <strong>Tip:</strong> Green ✓ means craftable, red ✗ shows missing materials
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

export default App;


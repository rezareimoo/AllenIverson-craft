import { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.DEV 
  ? 'http://localhost:3001' 
  : window.location.origin;

/**
 * Custom hook for Socket.io connection to the bot server
 * Provides real-time state synchronization
 */
export function useBotSocket() {
  const [connected, setConnected] = useState(false);
  const [botStatus, setBotStatus] = useState({
    connected: false,
    version: null,
  });
  const [queue, setQueue] = useState([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentTask, setCurrentTask] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [lastEvent, setLastEvent] = useState(null);
  
  const socketRef = useRef(null);

  useEffect(() => {
    // Initialize socket connection
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
    
    socketRef.current = socket;

    // Connection events
    socket.on('connect', () => {
      console.log('[Socket] Connected to server');
      setConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('[Socket] Disconnected from server');
      setConnected(false);
    });

    socket.on('connect_error', (error) => {
      console.error('[Socket] Connection error:', error.message);
      setConnected(false);
    });

    // Bot status events
    socket.on('bot:status', (data) => {
      console.log('[Socket] Bot status:', data);
      setBotStatus(data);
    });

    // Queue events
    socket.on('queue:updated', (data) => {
      console.log('[Socket] Queue updated:', data);
      setQueue(data.queue || []);
      setIsExecuting(data.isExecuting || false);
      setCurrentTask(data.currentTask || null);
    });

    // Task lifecycle events
    socket.on('task:started', (data) => {
      console.log('[Socket] Task started:', data);
      setCurrentTask(data.task);
      setIsExecuting(true);
      setLastEvent({ type: 'started', task: data.task, timestamp: Date.now() });
    });

    socket.on('task:completed', (data) => {
      console.log('[Socket] Task completed:', data);
      setLastEvent({ type: 'completed', task: data.task, timestamp: Date.now() });
    });

    socket.on('task:failed', (data) => {
      console.log('[Socket] Task failed:', data);
      setLastEvent({ type: 'failed', task: data.task, message: data.message, timestamp: Date.now() });
    });

    // Inventory events
    socket.on('inventory:updated', (data) => {
      console.log('[Socket] Inventory updated:', data);
      setInventory(Array.isArray(data) ? data : []);
    });

    // Cleanup on unmount
    return () => {
      socket.disconnect();
    };
  }, []);

  // API Functions
  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/queue');
      const data = await res.json();
      setQueue(data.queue || []);
      setIsExecuting(data.isExecuting || false);
      setCurrentTask(data.currentTask || null);
      return data;
    } catch (error) {
      console.error('[API] Failed to fetch queue:', error);
      return null;
    }
  }, []);

  const addTasks = useCallback(async (tasks) => {
    try {
      const res = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: Array.isArray(tasks) ? tasks : [tasks] }),
      });
      const data = await res.json();
      if (data.success) {
        setQueue(data.queue);
      }
      return data;
    } catch (error) {
      console.error('[API] Failed to add tasks:', error);
      return { success: false, error: error.message };
    }
  }, []);

  const removeTask = useCallback(async (index) => {
    try {
      const res = await fetch(`/api/queue/${index}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        setQueue(data.queue);
      }
      return data;
    } catch (error) {
      console.error('[API] Failed to remove task:', error);
      return { success: false, error: error.message };
    }
  }, []);

  const clearQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/queue', {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        setQueue([]);
        setIsExecuting(false);
        setCurrentTask(null);
      }
      return data;
    } catch (error) {
      console.error('[API] Failed to clear queue:', error);
      return { success: false, error: error.message };
    }
  }, []);

  const fetchInventory = useCallback(async () => {
    try {
      const res = await fetch('/api/inventory');
      const data = await res.json();
      setInventory(data.inventory || []);
      return data;
    } catch (error) {
      console.error('[API] Failed to fetch inventory:', error);
      return null;
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      setBotStatus({
        connected: data.connected,
        version: data.version,
        position: data.position,
        health: data.health,
        food: data.food,
      });
      return data;
    } catch (error) {
      console.error('[API] Failed to fetch status:', error);
      return null;
    }
  }, []);

  const fetchBlocks = useCallback(async () => {
    try {
      const res = await fetch('/api/blocks');
      const data = await res.json();
      return data.blocks || [];
    } catch (error) {
      console.error('[API] Failed to fetch blocks:', error);
      return [];
    }
  }, []);

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch('/api/items');
      const data = await res.json();
      return data.items || [];
    } catch (error) {
      console.error('[API] Failed to fetch items:', error);
      return [];
    }
  }, []);

  const fetchAllItems = useCallback(async () => {
    try {
      const res = await fetch('/api/all-items');
      const data = await res.json();
      return { items: data.items || [], blocks: data.blocks || [] };
    } catch (error) {
      console.error('[API] Failed to fetch all items:', error);
      return { items: [], blocks: [] };
    }
  }, []);

  const fetchRecipe = useCallback(async (itemName) => {
    try {
      const res = await fetch(`/api/recipe/${encodeURIComponent(itemName)}`);
      if (!res.ok) {
        return null;
      }
      return await res.json();
    } catch (error) {
      console.error('[API] Failed to fetch recipe:', error);
      return null;
    }
  }, []);

  const fetchPlayers = useCallback(async () => {
    try {
      const res = await fetch('/api/players');
      const data = await res.json();
      return data.players || [];
    } catch (error) {
      console.error('[API] Failed to fetch players:', error);
      return [];
    }
  }, []);

  return {
    // Connection state
    connected,
    botStatus,
    
    // Queue state
    queue,
    isExecuting,
    currentTask,
    
    // Inventory state
    inventory,
    
    // Last event for notifications
    lastEvent,
    
    // API functions
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
  };
}

export default useBotSocket;


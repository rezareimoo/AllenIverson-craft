import { useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import FeasibilityIndicator from './FeasibilityIndicator';

/**
 * Format task details for display
 */
function formatTaskDetails(task) {
  const format = (name) => name?.replace(/_/g, ' ') || '';
  
  switch (task.type) {
    case 'collect':
      return `${format(task.target)} × ${task.count || 1}`;
    case 'craft':
      return `${format(task.target)} × ${task.count || 1}`;
    case 'place':
      return format(task.target);
    case 'move':
      if (task.player) return `to player: ${task.player}`;
      if (task.block) return `to ${format(task.block)}`;
      return 'to target';
    case 'follow':
      return task.player || 'player';
    case 'inventory':
      return 'Check inventory';
    case 'stop':
      return 'Stop all actions';
    default:
      return JSON.stringify(task);
  }
}

/**
 * Sortable Task Item
 */
function SortableTaskItem({ 
  task, 
  index, 
  isRunning, 
  onRemove,
  feasibility,
  canRemove = true,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ 
    id: `task-${index}`,
    disabled: isRunning,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const taskClasses = [
    'mc-task',
    isRunning ? 'mc-task--running' : '',
    isDragging ? 'mc-task--dragging' : '',
  ].filter(Boolean).join(' ');

  const typeClass = `mc-task__type mc-task__type--${task.type}`;

  return (
    <div ref={setNodeRef} style={style} className={taskClasses}>
      <div 
        className="mc-task__drag-handle" 
        {...attributes} 
        {...listeners}
        title="Drag to reorder"
      >
        ⋮⋮
      </div>
      
      <div className={typeClass}>
        {task.type}
      </div>
      
      <div className="mc-task__details">
        <div>{formatTaskDetails(task)}</div>
        {task.type === 'craft' && feasibility && !feasibility.feasible && (
          <div style={{ marginTop: '4px' }}>
            <FeasibilityIndicator feasibility={feasibility} />
          </div>
        )}
      </div>
      
      {isRunning && (
        <div className="mc-badge mc-badge--running">
          Running
        </div>
      )}
      
      {canRemove && (
        <button
          className="mc-task__remove"
          onClick={() => onRemove(index)}
          title="Remove task"
          disabled={isRunning}
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * Task Queue Component
 * Displays queued tasks with drag-drop reordering
 */
export function TaskQueue({ 
  queue = [], 
  isExecuting = false,
  onRemoveTask,
  onClearQueue,
  onReorderQueue,
  feasibilityMap = new Map(),
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;

    if (active.id !== over?.id) {
      const oldIndex = parseInt(active.id.replace('task-', ''), 10);
      const newIndex = parseInt(over.id.replace('task-', ''), 10);
      
      // Don't allow moving the currently running task
      if (isExecuting && (oldIndex === 0 || newIndex === 0)) {
        return;
      }
      
      const newQueue = arrayMove(queue, oldIndex, newIndex);
      onReorderQueue?.(newQueue);
    }
  };

  const sortableItems = useMemo(() => 
    queue.map((_, index) => `task-${index}`),
    [queue]
  );

  return (
    <div className="mc-panel" style={{ flex: 1 }}>
      <div className="mc-panel__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Task Queue ({queue.length})</span>
        {queue.length > 0 && (
          <button
            className="mc-button mc-button--danger mc-button--small"
            onClick={onClearQueue}
          >
            Clear All
          </button>
        )}
      </div>

      {queue.length === 0 ? (
        <div className="mc-empty-state">
          <div className="mc-empty-state__icon">📋</div>
          <div>No tasks in queue</div>
          <div className="mc-text-small" style={{ marginTop: '8px', color: 'var(--mc-stone)' }}>
            Add tasks using the form below
          </div>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sortableItems}
            strategy={verticalListSortingStrategy}
          >
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {queue.map((task, index) => (
                <SortableTaskItem
                  key={`task-${index}`}
                  task={task}
                  index={index}
                  isRunning={isExecuting && index === 0}
                  onRemove={onRemoveTask}
                  feasibility={feasibilityMap.get(index)}
                  canRemove={!(isExecuting && index === 0)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {queue.length > 0 && (
        <div className="mc-text-small" style={{ marginTop: '12px', color: 'var(--mc-stone)', textAlign: 'center' }}>
          Drag tasks to reorder • Click × to remove
        </div>
      )}
    </div>
  );
}

export default TaskQueue;


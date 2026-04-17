import { useEffect } from 'react';
import { uiController, registerStore } from '../controllers/UIController';
import { useStore } from '../state/store';

interface TaskStartedEvent {
  taskId?: string;
  goal?: string;
  parentId?: string;
  status?: string;
}

interface TaskCompletedEvent {
  taskId?: string;
  success?: boolean;
  result?: string;
}

interface TaskFailedEvent {
  taskId?: string;
  error?: string;
  canRetry?: boolean;
}

interface ExecutionEvent {
  goal?: string;
  success?: boolean;
}

interface RetryEvent {
  taskId?: string;
  attempt?: number;
}

export const useLiveExecution = () => {
  const { addLog, setRunning, incrementAttempt } = useStore();

  useEffect(() => {
    registerStore(useStore.getState);

    const listeners: Array<() => void> = [];

    try {
      const eventBusModule = require('../../core/dist/event-bus.js');
      const eventBus = eventBusModule.getEventBus?.();

      if (eventBus) {
        const taskStarted = (data: TaskStartedEvent) => {
          if (data.goal) {
            uiController.addNode(data.parentId || null, data.goal, 'running');
            addLog({ level: 'info', message: `Task started: ${data.goal}` });
          }
        };

        const taskCompleted = (data: TaskCompletedEvent) => {
          if (data.taskId) {
            uiController.completeNode(data.taskId, 'done');
            addLog({ level: 'info', message: `Task completed: ${data.taskId}` });
          }
        };

        const taskFailed = (data: TaskFailedEvent) => {
          if (data.taskId) {
            uiController.completeNode(data.taskId, 'failed', data.error);
            addLog({ level: 'error', message: `Task failed: ${data.error || 'Unknown'}` });
            if (data.canRetry) {
              incrementAttempt();
            }
          }
        };

        const executionStarted = (data: ExecutionEvent) => {
          if (data.goal) {
            uiController.startExecution(data.goal);
            setRunning(true);
            addLog({ level: 'info', message: `Execution started: ${data.goal}` });
          }
        };

        const executionCompleted = (data: ExecutionEvent) => {
          setRunning(false);
          addLog({ 
            level: data.success ? 'info' : 'error', 
            message: `Execution ${data.success ? 'completed' : 'failed'}` 
          });
        };

        const retryStarted = (data: RetryEvent) => {
          if (data.taskId && data.attempt) {
            uiController.addRetryNode(data.taskId, data.attempt);
            addLog({ level: 'warn', message: `Retrying task (Attempt ${data.attempt})` });
          }
        };

        eventBus.on('task.started', taskStarted as any);
        eventBus.on('task.completed', taskCompleted as any);
        eventBus.on('task.failed', taskFailed as any);
        eventBus.on('project.started', executionStarted as any);
        eventBus.on('project.completed', executionCompleted as any);
        eventBus.on('project.failed', (d: ExecutionEvent) => executionCompleted({ ...d, success: false }) as any);
        eventBus.on('task.retried', retryStarted as any);

        listeners.push(() => {
          eventBus.off('task.started', taskStarted as any);
          eventBus.off('task.completed', taskCompleted as any);
          eventBus.off('task.failed', taskFailed as any);
          eventBus.off('project.started', executionStarted as any);
          eventBus.off('project.completed', executionCompleted as any);
          eventBus.off('project.failed', (d: ExecutionEvent) => executionCompleted({ ...d, success: false }) as any);
          eventBus.off('task.retried', retryStarted as any);
        });
      }
    } catch (err) {
      console.warn('Could not connect to event bus:', err);
    }

    return () => {
      listeners.forEach(unsub => unsub());
    };
  }, [addLog, setRunning, incrementAttempt]);
};

import { useEffect } from 'react';
import { uiController, registerStore } from '../controllers/UIController.js';
import { useStore } from '../state/store.js';
import { getEventBus } from '../../core/event-bus.js';

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
      const eventBus = getEventBus();

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
            message: `Execution ${data.success ? 'completed' : 'failed'}`,
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

export function subscribeToSessionEvents(session: any, state: any, statsRef: any, handlersRef: any): void {
  if (!session || !state || !session.on) return;

  state.setRunning(true);
  state.setExecutionStart();

  session.on('session.started', (data: any) => {
    addLog('info', `Session started: ${data.mode} mode, ${data.strategy} strategy`);
  });

  session.on('agent.output', (data: any) => {
    if (statsRef?.current) {
      statsRef.current.lastAgentOutput = { agentId: data.agentId, content: data.content };
    }
    state.addMessage({ type: 'system', content: `[${data.agentId}] ${(data.content || '').slice(0, 200)}` });
  });

  session.on('agent.fallback', (data: any) => {
    state.setAgentStatus(data.from, { status: 'failed' });
    state.setAgentStatus(data.to, { status: 'busy' });
    state.addMessage({ type: 'system', content: `Fallback: ${data.from} → ${data.to} (${data.reason})` });
  });

  session.on('agent.completed', (data: any) => {
    state.setAgentStatus(data.agentId, { status: 'ready' });
  });

  session.on('agent.error', (data: any) => {
    state.setAgentStatus(data.agentId, { status: 'failed', error: data.error });
  });

  session.on('changes.collected', (data: any) => {
    addLog('info', `${data.changes.length} file change(s) detected`);
  });

  session.on('validation.started', () => {
    addLog('info', 'Validating changes...');
  });

  session.on('validation.passed', () => {
    addLog('info', 'Validation passed');
  });

  session.on('validation.failed', (data: any) => {
    addLog('error', `Validation failed: ${(data.errors || []).join(', ')}`);
  });

  session.on('changes.applied', (data: any) => {
    addLog('info', `Applied ${data.applied?.length || 0} change(s), ${data.failed?.length || 0} failed`);
  });

  session.on('session.completed', (data: any) => {
    state.setRunning(false);
    if (data.success) {
      addLog('info', 'Session completed successfully');
    }
    if (handlersRef?.current?.onComplete) {
      handlersRef.current.onComplete(data);
    }
  });

  session.on('session.error', (data: any) => {
    state.setRunning(false);
    addLog('error', `Session error: ${data.error}`);
  });
}

function addLog(level: 'info' | 'error' | 'warn', message: string): void {
  const state = useStore.getState();
  if (level === 'error') {
    state.addMessage({ type: 'error', content: message });
  } else if (level === 'warn') {
    state.addMessage({ type: 'system', content: `⚠ ${message}` });
  } else {
    state.addMessage({ type: 'system', content: message });
  }
}

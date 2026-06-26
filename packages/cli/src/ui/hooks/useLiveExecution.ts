import { useEffect } from 'react';
import { uiController, registerStore } from '../controllers/UIController.js';
import { useStore } from '../state/store.js';
import { getEventBus } from '../../core/event-bus.js';

import type { SessionEventMap } from '../../core/session/events.js';

export const useLiveExecution = () => {
  const { addLog, setRunning, incrementAttempt } = useStore();

  useEffect(() => {
    registerStore(useStore.getState);

    const listeners: Array<() => void> = [];

    try {
      const eventBus = getEventBus();

      if (eventBus) {
        const taskStarted = (data: { taskId?: string; goal?: string; parentId?: string }) => {
          if (data.goal) {
            uiController.addNode(data.parentId || null, data.goal, 'running');
            addLog({ level: 'info', message: `Task started: ${data.goal}` });
          }
        };

        const taskCompleted = (data: { taskId?: string; success?: boolean; result?: string }) => {
          if (data.taskId) {
            uiController.completeNode(data.taskId, 'done');
            addLog({ level: 'info', message: `Task completed: ${data.taskId}` });
          }
        };

        const taskFailed = (data: { taskId?: string; error?: string; canRetry?: boolean }) => {
          if (data.taskId) {
            uiController.completeNode(data.taskId, 'failed', data.error);
            addLog({ level: 'error', message: `Task failed: ${data.error || 'Unknown'}` });
            if (data.canRetry) {
              incrementAttempt();
            }
          }
        };

        const executionStarted = (data: { goal?: string }) => {
          if (data.goal) {
            uiController.startExecution(data.goal);
            setRunning(true);
            addLog({ level: 'info', message: `Execution started: ${data.goal}` });
          }
        };

        const executionCompleted = (data: { success?: boolean }) => {
          setRunning(false);
          addLog({
            level: data.success ? 'info' : 'error',
            message: `Execution ${data.success ? 'completed' : 'failed'}`,
          });
        };

        const retryStarted = (data: { taskId?: string; attempt?: number }) => {
          if (data.taskId && data.attempt) {
            uiController.addRetryNode(data.taskId, data.attempt);
            addLog({ level: 'warn', message: `Retrying task (Attempt ${data.attempt})` });
          }
        };

        eventBus.on('task.started', taskStarted);
        eventBus.on('task.completed', taskCompleted);
        eventBus.on('task.failed', taskFailed);
        eventBus.on('project.started', executionStarted);
        eventBus.on('project.completed', executionCompleted);
        eventBus.on('project.failed', (d: { goal?: string }) => executionCompleted({ success: false }));
        eventBus.on('task.retried', retryStarted);

        listeners.push(() => {
          eventBus.off('task.started', taskStarted);
          eventBus.off('task.completed', taskCompleted);
          eventBus.off('task.failed', taskFailed);
          eventBus.off('project.started', executionStarted);
          eventBus.off('project.completed', executionCompleted);
          eventBus.off('project.failed', (d: { goal?: string }) => executionCompleted({ success: false }));
          eventBus.off('task.retried', retryStarted);
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

export function subscribeToSessionEvents(
  session: import('../../core/session/SessionOrchestrator.js').SessionOrchestrator,
  state: ReturnType<typeof import('../state/store.js').useStore>,
  statsRef?: { current: { lastAgentOutput?: { agentId: string; content: string } } },
  handlersRef?: { current?: { onComplete?: (data: SessionEventMap['session.completed']) => void } },
): void {
  if (!session || !state || !session.on) return;

  state.setRunning(true);
  state.setExecutionStart();

  session.on('session.started', (data) => {
    addLog('info', `Session started: ${data.mode} mode, ${data.strategy} strategy`);
  });

  session.on('agent.output', (data) => {
    if (statsRef?.current) {
      statsRef.current.lastAgentOutput = { agentId: data.agentId, content: data.content };
    }
    state.addMessage({ type: 'system', content: `[${data.agentId}] ${(data.content || '').slice(0, 200)}` });
  });

  session.on('agent.fallback', (data) => {
    state.setAgentStatus(data.from, { status: 'failed' });
    state.setAgentStatus(data.to, { status: 'busy' });
    state.addMessage({ type: 'system', content: `Fallback: ${data.from} → ${data.to} (${data.reason})` });
  });

  session.on('agent.completed', (data) => {
    state.setAgentStatus(data.agentId, { status: 'ready' });
  });

  session.on('agent.error', (data) => {
    state.setAgentStatus(data.agentId, { status: 'failed', error: data.error });
  });

  session.on('changes.collected', (data) => {
    addLog('info', `${data.changes.length} file change(s) detected`);
  });

  session.on('validation.started', () => {
    addLog('info', 'Validating changes...');
  });

  session.on('validation.passed', () => {
    addLog('info', 'Validation passed');
  });

  session.on('validation.failed', (data) => {
    addLog('error', `Validation failed: ${(data.errors || []).join(', ')}`);
  });

  session.on('changes.applied', (data) => {
    addLog('info', `Applied ${data.applied?.length || 0} change(s), ${data.failed?.length || 0} failed`);
  });

  session.on('session.completed', (data) => {
    state.setRunning(false);
    if (data.success) {
      addLog('info', 'Session completed successfully');
    }
    if (handlersRef?.current?.onComplete) {
      handlersRef.current.onComplete(data);
    }
  });

  session.on('session.error', (data) => {
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

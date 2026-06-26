import type { SessionOrchestrator } from '../../core/session/SessionOrchestrator.js';
import { useStore } from '../state/store.js';

export function createSessionEventBridge(orchestrator: SessionOrchestrator): () => void {
  const unsubs: (() => void)[] = [];

  const on = (event: string, handler: (...args: any[]) => void): void => {
    (orchestrator as any).on(event, handler);
    unsubs.push(() => { (orchestrator as any).off(event, handler); });
  };

  on('session.started', ({ goal, strategy, mode }) => {
    const store = useStore.getState();
    store.addMessage({ type: 'system', content: `Session started: ${goal}` });
    store.setRunning(true);
    store.setExecutionStart();
    store.setStrategy(strategy);
    store.setMode(mode);
  });

  on('agent.output', ({ agentId, content }) => {
    const store = useStore.getState();
    const messages = store.messages;
    const lastAgentMsg = [...messages].reverse().find(
      (m) => m.type === agentId || m.agent === agentId
    );
    if (lastAgentMsg && lastAgentMsg.isStreaming) {
      store.appendToMessage(lastAgentMsg.id, content);
    } else {
      store.addMessage({ type: agentId as any, content, agent: agentId as any, isStreaming: true });
    }
  });

  on('agent.completed', ({ agentId }) => {
    const store = useStore.getState();
    const messages = store.messages;
    const lastAgentMsg = [...messages].reverse().find(
      (m) => m.agent === agentId
    );
    if (lastAgentMsg) {
      store.updateMessage(lastAgentMsg.id, { isStreaming: false });
    }
  });

  on('agent.error', ({ agentId, error }) => {
    const store = useStore.getState();
    store.addMessage({ type: 'error', content: `[${agentId}] ${error}` });
  });

  on('session.completed', ({ success, duration }) => {
    const store = useStore.getState();
    store.setRunning(false);
    store.addMessage({
      type: 'system',
      content: `Session ${success ? 'completed' : 'failed'} in ${(duration / 1000).toFixed(1)}s`,
    });
    store.addLog(`Session completed: success=${success} duration=${duration}ms`);
  });

  on('session.error', ({ error }) => {
    const store = useStore.getState();
    store.setRunning(false);
    store.addMessage({ type: 'error', content: `Session error: ${error}` });
  });

  on('validation.failed', ({ errors }) => {
    const store = useStore.getState();
    store.addMessage({ type: 'system', content: `Validation failed: ${errors.length} error(s)` });
    errors.forEach((e: string) => store.addLog(`VALIDATION: ${e}`));
  });

  on('changes.applied', ({ applied, failed }) => {
    const store = useStore.getState();
    if (applied.length > 0) {
      store.addMessage({ type: 'system', content: `Applied ${applied.length} change(s)` });
    }
    if (failed.length > 0) {
      store.addMessage({ type: 'error', content: `Failed to apply ${failed.length} change(s)` });
    }
  });

  on('permission.requested', ({ agentId, action, details }) => {
    const store = useStore.getState();
    store.addPermissionRequest({ agentId, action, details });
    store.addLog(`PERMISSION: ${agentId} requested ${action} — ${details}`);
  });

  return () => { unsubs.forEach((fn) => fn()); };
}

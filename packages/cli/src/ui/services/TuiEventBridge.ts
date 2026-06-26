import type { SessionOrchestrator } from '../../core/session/SessionOrchestrator.js';
import { useStore } from '../state/store.js';

export function createSessionEventBridge(orchestrator: SessionOrchestrator): () => void {
  const unsubs: (() => void)[] = [];

  const sessionStarted = orchestrator.on('session.started', ({ goal, strategy, mode }) => {
    const store = useStore.getState();
    store.addMessage({ type: 'system', content: `Session started: ${goal}` });
    store.setRunning(true);
    store.setExecutionStart();
    store.setStrategy(strategy);
    store.setMode(mode);
  });

  const agentOutput = orchestrator.on('agent.output', ({ agentId, content }) => {
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

  const agentCompleted = orchestrator.on('agent.completed', ({ agentId }) => {
    const store = useStore.getState();
    const messages = store.messages;
    const lastAgentMsg = [...messages].reverse().find(
      (m) => m.agent === agentId
    );
    if (lastAgentMsg) {
      store.updateMessage(lastAgentMsg.id, { isStreaming: false });
    }
  });

  const agentError = orchestrator.on('agent.error', ({ agentId, error }) => {
    const store = useStore.getState();
    store.addMessage({ type: 'error', content: `[${agentId}] ${error}` });
  });

  const sessionCompleted = orchestrator.on('session.completed', ({ success, duration }) => {
    const store = useStore.getState();
    store.setRunning(false);
    store.addMessage({
      type: 'system',
      content: `Session ${success ? 'completed' : 'failed'} in ${(duration / 1000).toFixed(1)}s`,
    });
    store.addLog(`Session completed: success=${success} duration=${duration}ms`);
  });

  const sessionError = orchestrator.on('session.error', ({ error }) => {
    const store = useStore.getState();
    store.setRunning(false);
    store.addMessage({ type: 'error', content: `Session error: ${error}` });
  });

  const validationFailed = orchestrator.on('validation.failed', ({ errors }) => {
    const store = useStore.getState();
    store.addMessage({ type: 'system', content: `Validation failed: ${errors.length} error(s)` });
    errors.forEach((e) => store.addLog(`VALIDATION: ${e}`));
  });

  const changesApplied = orchestrator.on('changes.applied', ({ applied, failed }) => {
    const store = useStore.getState();
    if (applied.length > 0) {
      store.addMessage({ type: 'system', content: `Applied ${applied.length} change(s)` });
    }
    if (failed.length > 0) {
      store.addMessage({ type: 'error', content: `Failed to apply ${failed.length} change(s)` });
    }
  });

  unsubs.push(sessionStarted, agentOutput, agentCompleted, agentError);
  unsubs.push(sessionCompleted, sessionError, validationFailed, changesApplied);

  return () => { unsubs.forEach((fn) => fn()); };
}

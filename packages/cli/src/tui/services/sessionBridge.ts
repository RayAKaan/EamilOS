import type { AppModel, ModifiedFile, RunSummary } from '../model.js';
import { createSessionOrchestrator } from '../../core/session/SessionOrchestrator.js';
import type { SessionEventMap } from '../../core/session/events.js';
import { update } from '../update.js';
import type { Msg } from '../update.js';

export interface SessionBridgeCallbacks {
  dispatch: (msg: Msg) => void;
  getModel: () => AppModel;
  onLog: (text: string) => void;
}

export async function runSession(
  prompt: string,
  strategy: string,
  mode: string,
  callbacks: SessionBridgeCallbacks
): Promise<void> {
  const { dispatch, getModel, onLog } = callbacks;

  dispatch({ type: 'SESSION_STARTED' });

  const model = getModel();
  const hasExecution = Array.from(model.agents.values()).some(
    a => a.status === 'ready'
  );

  if (!hasExecution) {
    dispatch({ type: 'SESSION_ERROR', error: 'No agents available' });
    return;
  }

  const session = createSessionOrchestrator({
    goal: prompt,
    projectId: `tui_${Date.now()}`,
    strategy: strategy as any,
    mode: mode as any,
    workingDir: process.cwd(),
    maxRetries: 2,
    timeoutMs: 120000,
  });

  session.on('agent.started', (data) => {
    dispatch({ type: 'AGENT_STARTED', agentId: data.agentId });
    onLog(`Agent started: ${data.agentId}`);
  });

  session.on('agent.output', (data) => {
    dispatch({ type: 'AGENT_OUTPUT', agentId: data.agentId, content: data.content });
  });

  session.on('agent.completed', (data) => {
    dispatch({ type: 'AGENT_COMPLETED', agentId: data.agentId });
    onLog(`Agent completed: ${data.agentId}`);
  });

  session.on('agent.error', (data) => {
    dispatch({ type: 'AGENT_ERROR', agentId: data.agentId, error: data.error });
    onLog(`Agent error: ${data.agentId}: ${data.error}`);
  });

  session.on('agent.fallback', (data) => {
    dispatch({ type: 'AGENT_FALLBACK', from: data.from, to: data.to, reason: data.reason });
    onLog(`Fallback: ${data.from} → ${data.to}`);
  });

  session.on('validation.started', () => {
    dispatch({ type: 'VALIDATION_STARTED' });
  });

  session.on('validation.passed', () => {
    dispatch({ type: 'VALIDATION_PASSED' });
  });

  session.on('validation.failed', (data) => {
    dispatch({ type: 'VALIDATION_FAILED', errors: data.errors });
    onLog(`Validation failed: ${data.errors.length} errors`);
  });

  session.on('changes.collected', (data) => {
    const files: ModifiedFile[] = (data.changes ?? []).map(c => ({
      path: c.path,
      action: c.action === 'deleted' ? 'delete' : c.action === 'modified' ? 'modify' : 'create',
      agent: c.agentId ?? 'unknown',
    }));
    dispatch({ type: 'CHANGES_COLLECTED', files });
    onLog(`Changes collected: ${files.length} files`);
  });

  try {
    const result = await session.run();

    const summary: RunSummary = {
      strategy: result.strategy ?? strategy,
      agentUsed: result.agentUsed ?? 'unknown',
      durationMs: result.duration,
      fileCount: result.fileChanges?.length ?? 0,
      validated: result.success && result.errors.length === 0,
      errors: result.errors,
    };

    dispatch({ type: 'SESSION_COMPLETED', summary });
    onLog(`Session ${summary.validated ? 'completed' : 'failed'} in ${(summary.durationMs / 1000).toFixed(1)}s`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    dispatch({ type: 'SESSION_ERROR', error: msg });
    onLog(`Session error: ${msg}`);
  }
}

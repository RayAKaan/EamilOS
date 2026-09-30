import type { AppModel, ModifiedFile, RunSummary } from '../model.js';
import { createSessionOrchestrator } from '../../core/session/SessionOrchestrator.js';
import type { Msg } from '../update.js';
import type { AgentRegistry } from '../../core/agents/AgentRegistry.js';

export interface SessionBridgeCallbacks {
  dispatch: (msg: Msg) => void;
  getModel: () => AppModel;
  onLog: (text: string) => void;
  registry: AgentRegistry;
}

export interface ExecutionController {
  abortController: AbortController;
  taskId: string;
  agentId?: string;
  startedAt: number;
  lastEventAt: number;
  phase: 'starting' | 'waiting' | 'executing' | 'validating' | 'completed' | 'failed' | 'cancelled';
  lastOutput: string;
}

let activeController: { abortController: AbortController; taskId: string } | null = null;

export function cancelActiveSession(reason = 'Cancelled by user'): void {
  if (!activeController) return;
  activeController.abortController.abort(reason);
}

export function abortAllExecutions(reason: string): void {
  cancelActiveSession(reason);
}

export async function runSession(
  prompt: string,
  strategy: string,
  mode: string,
  callbacks: SessionBridgeCallbacks
): Promise<void> {
  const { dispatch, getModel, onLog, registry } = callbacks;
  const controller = new AbortController();
  activeController = { abortController: controller, taskId: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` };
  const taskId = activeController.taskId;
  const missionId = `mission_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  dispatch({ type: 'MISSION_QUEUED', objective: prompt });
  dispatch({ type: 'SET_MISSION_STATE', state: 'queued' });
  dispatch({ type: 'LOOP_STAGE', stage: 'observe', status: 'completed' });
  dispatch({ type: 'LOOP_STAGE', stage: 'interpret', status: 'completed' });
  dispatch({ type: 'LOOP_STAGE', stage: 'plan', status: 'active' });

  const available = registry.getAvailableAgents();
  if (available.length === 0) {
    dispatch({ type: 'SESSION_ERROR', error: 'No agents available. Agent discovery is still running or no supported agent is installed.' });
    activeController = null;
    return;
  }

  // Let the runtime choose the effective mode from the actual available capabilities.
  const effectiveMode = mode === 'auto'
    ? (available.some(a => a.supportedModes.includes('execution')) ? 'execution' : 'communication')
    : mode;

  const session = createSessionOrchestrator({
    goal: prompt,
    projectId: `tui_${Date.now()}`,
    strategy: strategy as any,
    mode: effectiveMode as any,
    workingDir: process.cwd(),
    maxRetries: 2,
    timeoutMs: 120000,
    registry,
    signal: controller.signal,
  });

  let executionController: ExecutionController | null = null;

  session.on('session.started', (data) => {
    dispatch({ type: 'MISSION_ACCEPTED', missionId });
    dispatch({ type: 'SET_MISSION_STATE', state: 'running' });
    dispatch({ type: 'LOOP_STAGE', stage: 'plan', status: 'completed' });
    dispatch({ type: 'LOOP_STAGE', stage: 'execute', status: 'active' });
    dispatch({ type: 'STATUS_TEXT', text: `Running · ${data.mode}` });
  });

  session.on('agent.started', (data) => {
    const model = getModel();
    const callsign = model.agents.get(data.agentId)?.callsign || data.agentId;
    dispatch({ type: 'AGENT_STARTING', agentId: data.agentId, callsign });
    dispatch({ type: 'AGENT_STARTED', agentId: data.agentId });
    dispatch({ type: 'TASK_STARTED', taskId, agentId: data.agentId });
    onLog(`Agent started: ${data.agentId}`);
    executionController = {
      abortController: controller,
      taskId,
      agentId: data.agentId,
      startedAt: Date.now(),
      lastEventAt: Date.now(),
      phase: 'waiting',
      lastOutput: '',
    };
  });

  session.on('agent.output', (data) => {
    dispatch({ type: 'AGENT_OUTPUT', agentId: data.agentId, content: data.content });
    if (executionController) {
      executionController.lastEventAt = Date.now();
      executionController.lastOutput = data.content;
      executionController.phase = 'executing';
    }
  });

  session.on('agent.completed', (data) => {
    dispatch({ type: 'AGENT_COMPLETED', agentId: data.agentId });
    dispatch({ type: 'AGENT_READY', agentId: data.agentId });
    onLog(`Agent completed: ${data.agentId}`);
    if (executionController) {
      executionController.phase = 'completed';
      executionController.lastEventAt = Date.now();
    }
  });

  session.on('agent.error', (data) => {
    dispatch({ type: 'AGENT_ERROR', agentId: data.agentId, error: data.error });
    onLog(`Agent error: ${data.agentId}: ${data.error}`);
    if (executionController) {
      executionController.phase = controller.signal.aborted ? 'cancelled' : 'failed';
      executionController.lastEventAt = Date.now();
    }
  });

  session.on('agent.fallback', (data) => {
    if (controller.signal.aborted) return;
    dispatch({ type: 'AGENT_FALLBACK', from: data.from, to: data.to, reason: data.reason });
    onLog(`Fallback: ${data.from} → ${data.to}`);
  });

  session.on('validation.started', () => {
    dispatch({ type: 'LOOP_STAGE', stage: 'measure', status: 'completed' });
    dispatch({ type: 'LOOP_STAGE', stage: 'execute', status: 'completed' });
    dispatch({ type: 'LOOP_STAGE', stage: 'validate', status: 'active' });
    dispatch({ type: 'VALIDATION_STARTED', stage: 'validation' });
    if (executionController) executionController.phase = 'validating';
  });

  session.on('validation.passed', () => {
    dispatch({ type: 'VALIDATION_PASSED' });
    dispatch({ type: 'VALIDATION_FINISHED', passed: true, errors: [] });
    dispatch({ type: 'LOOP_STAGE', stage: 'validate', status: 'completed' });
    dispatch({ type: 'LOOP_STAGE', stage: 'adapt', status: 'completed' });
  });

  session.on('validation.failed', (data) => {
    dispatch({ type: 'VALIDATION_FAILED', errors: data.errors });
    dispatch({ type: 'VALIDATION_FINISHED', passed: false, errors: data.errors });
    if (executionController) executionController.phase = 'failed';
  });

  session.on('changes.collected', (data) => {
    const files: ModifiedFile[] = (data.changes ?? []).map(c => ({
      path: c.path,
      action: c.action === 'deleted' ? 'delete' : c.action === 'modified' ? 'modify' : 'create',
      agent: c.agentId ?? 'unknown',
    }));
    dispatch({ type: 'CHANGES_COLLECTED', files });
    for (const file of files) dispatch({ type: 'FILE_CHANGED', path: file.path, action: file.action, agent: file.agent });
  });

  session.on('session.completed', (data) => {
    onLog(`Session ${data.success ? 'completed' : 'failed'}`);
  });

  session.on('session.error', (data) => {
    dispatch({ type: 'SESSION_ERROR', error: data.error });
    onLog(`Session error: ${data.error}`);
  });

  dispatch({ type: 'TASK_QUEUED', taskId, objective: prompt });

  try {
    const result = await session.run();

    if (controller.signal.aborted) {
      dispatch({ type: 'EXECUTION_CANCELLED', reason: 'Cancelled by user' });
      dispatch({ type: 'TASK_COMPLETED', taskId, success: false });
      return;
    }

    const success = result.success && result.errors.length === 0;
    const summary: RunSummary = {
      strategy: result.strategy ?? strategy,
      agentUsed: result.agentUsed ?? 'unknown',
      durationMs: result.duration,
      fileCount: result.fileChanges?.length ?? 0,
      validated: success,
      errors: result.errors,
    };

    dispatch({ type: 'SESSION_COMPLETED', summary });
    dispatch({ type: 'TASK_COMPLETED', taskId, success });
    dispatch({ type: 'SET_MISSION_STATE', state: success ? 'completed' : 'failed' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (controller.signal.aborted) {
      dispatch({ type: 'EXECUTION_CANCELLED', reason: 'Cancelled by user' });
    } else {
      dispatch({ type: 'SESSION_ERROR', error: msg });
    }
    dispatch({ type: 'TASK_COMPLETED', taskId, success: false });
    dispatch({ type: 'SET_MISSION_STATE', state: controller.signal.aborted ? 'cancelled' : 'failed' });
  } finally {
    if (activeController?.taskId === taskId) activeController = null;
  }
}

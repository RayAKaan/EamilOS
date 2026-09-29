import type { AppModel, ModifiedFile, RunSummary } from '../model.js';
import { createSessionOrchestrator } from '../../core/session/SessionOrchestrator.js';
import type { SessionEventMap } from '../../core/session/events.js';
import type { Msg } from '../update.js';

export interface SessionBridgeCallbacks {
  dispatch: (msg: Msg) => void;
  getModel: () => AppModel;
  onLog: (text: string) => void;
}

export interface ExecutionController {
  abortController: AbortController;
  taskId: string;
  agentId: string;
  startedAt: number;
  lastEventAt: number;
  phase: 'starting' | 'ready' | 'executing' | 'tool' | 'validating' | 'completed' | 'failed' | 'cancelled';
  currentTool?: string;
  lastOutput: string;
}

const activeExecutions = new Map<string, ExecutionController>();

export function createExecutionController(taskId: string, agentId: string): ExecutionController {
  const controller: ExecutionController = {
    abortController: new AbortController(),
    taskId,
    agentId,
    startedAt: Date.now(),
    lastEventAt: Date.now(),
    phase: 'starting',
    lastOutput: '',
  };
  activeExecutions.set(taskId, controller);
  return controller;
}

export function getExecutionController(taskId: string): ExecutionController | undefined {
  return activeExecutions.get(taskId);
}

export function abortExecution(taskId: string, reason: string): void {
  const controller = activeExecutions.get(taskId);
  if (controller) {
    controller.abortController.abort(reason);
    controller.phase = 'cancelled';
  }
}

export function abortAllExecutions(reason: string): void {
  for (const controller of activeExecutions.values()) {
    controller.abortController.abort(reason);
    controller.phase = 'cancelled';
  }
  activeExecutions.clear();
}

export async function runSession(
  prompt: string,
  strategy: string,
  mode: string,
  callbacks: SessionBridgeCallbacks
): Promise<void> {
  const { dispatch, getModel, onLog } = callbacks;

  dispatch({ type: 'MISSION_QUEUED', objective: prompt });
  dispatch({ type: 'SET_MISSION_STATE', state: 'queued' });
  dispatch({ type: 'LOOP_STAGE', stage: 'observe', status: 'completed' });
  dispatch({ type: 'LOOP_STAGE', stage: 'interpret', status: 'completed' });
  dispatch({ type: 'LOOP_STAGE', stage: 'plan', status: 'active' });

  const model = getModel();
  const hasExecution = Array.from(model.agents.values()).some(
    a => a.status === 'ready'
  );

  if (!hasExecution) {
    dispatch({ type: 'SESSION_ERROR', error: 'No agents available' });
    dispatch({ type: 'SET_MISSION_STATE', state: 'failed' });
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

  const missionId = `mission-${Date.now()}`;
  const taskId = `task-${Date.now()}`;
  const executionId = `exec-${Date.now()}`;

  let executionController: ExecutionController | null = null;

  session.on('agent.started', (data) => {
    const model = getModel();
    const callsign = model.agents.get(data.agentId)?.callsign || data.agentId;
    dispatch({ type: 'LOOP_STAGE', stage: 'plan', status: 'completed' });
    dispatch({ type: 'LOOP_STAGE', stage: 'execute', status: 'active' });
    dispatch({ type: 'AGENT_STARTED', agentId: data.agentId });
    dispatch({ type: 'AGENT_STARTING', agentId: data.agentId, callsign });
    onLog(`Agent started: ${data.agentId}`);
    
    executionController = createExecutionController(taskId, data.agentId);
    executionController.phase = 'starting';
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
      executionController.phase = 'failed';
    }
  });

  session.on('agent.fallback', (data) => {
    const now=Date.now();
    dispatch({ type: 'DECISION_PROPOSED', decision: { id:'decision-'+String(now), missionId:getModel().missionUi.id, loopId:getModel().loop.id, iterationId:getModel().loop.iterations.at(-1)?.id, provider:'runtime', action:'REASSIGN', reason:data.reason, sourceResources:[{type:'agent',id:data.from},{type:'agent',id:data.to}], evidenceIds:[], status:'proposed', createdAt:now } });
    dispatch({ type: 'AGENT_FALLBACK', from: data.from, to: data.to, reason: data.reason });
    const id=getModel().decisions.selectedDecisionId; if(id) dispatch({type:'DECISION_RESOLVED',decisionId:id,status:'applied',outcome:data.from+' → '+data.to});
    onLog(`Fallback: ${data.from} → ${data.to}`);
  });

  session.on('validation.started', () => {
    dispatch({ type: 'LOOP_STAGE', stage: 'measure', status: 'active' });
    dispatch({ type: 'LOOP_STAGE', stage: 'execute', status: 'completed' });
    dispatch({ type: 'LOOP_STAGE', stage: 'measure', status: 'completed' });
    dispatch({ type: 'LOOP_STAGE', stage: 'validate', status: 'active' });
    dispatch({ type: 'VALIDATION_STARTED', stage: 'validation' });
    
    if (executionController) {
      executionController.phase = 'validating';
    }
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
    dispatch({ type: 'LOOP_ADAPTATION', required: true });
    dispatch({ type: 'LOOP_STAGE', stage: 'validate', status: 'blocked' });
    dispatch({ type: 'LOOP_STAGE', stage: 'adapt', status: 'active' });
    onLog(`Validation failed: ${data.errors.length} errors`);
    
    if (executionController) {
      executionController.phase = 'failed';
    }
  });

  session.on('changes.collected', (data) => {
    const files: ModifiedFile[] = (data.changes ?? []).map(c => ({
      path: c.path,
      action: c.action === 'deleted' ? 'delete' : c.action === 'modified' ? 'modify' : 'create',
      agent: c.agentId ?? 'unknown',
    }));
    dispatch({ type: 'CHANGES_COLLECTED', files });
    onLog(`Changes collected: ${files.length} files`);
    
    for (const file of files) {
      dispatch({ type: 'FILE_CHANGED', path: file.path, action: file.action, agent: file.agent });
    }
  });

  dispatch({ type: 'MISSION_ACCEPTED', missionId });
  dispatch({ type: 'SET_MISSION_STATE', state: 'running' });
  dispatch({ type: 'TASK_QUEUED', taskId, objective: prompt });
  dispatch({ type: 'TASK_STARTED', taskId, agentId: 'pending' });

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
    dispatch({ type: 'TASK_COMPLETED', taskId, success: result.success && result.errors.length === 0 });
    dispatch({ type: 'SET_MISSION_STATE', state: result.success && result.errors.length === 0 ? 'completed' : 'failed' });
    onLog(`Session ${summary.validated ? 'completed' : 'failed'} in ${(summary.durationMs / 1000).toFixed(1)}s`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    dispatch({ type: 'SESSION_ERROR', error: msg });
    dispatch({ type: 'SET_MISSION_STATE', state: 'failed' });
    onLog(`Session error: ${msg}`);
  } finally {
    if (executionController) {
      activeExecutions.delete(taskId);
    }
  }
}
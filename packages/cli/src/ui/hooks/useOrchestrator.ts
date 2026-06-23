/**
 * useOrchestrator — Run the DualOrchestrator and stream events to the UI
 * Uses plain functions (not hooks) for imperative store access.
 */
import { useStore } from '../state/store.js';
import type { ExecutionStrategy } from '../types/ui.js';

type EventHandler = (...args: unknown[]) => void;

const EVENTS = {
  TASK_STARTED: 'task:started',
  TASK_COMPLETED: 'task:completed',
  TASK_FAILED: 'task:failed',
} as const;

interface OrchestratorResult {
  success: boolean;
  taskId: string;
  strategy: ExecutionStrategy;
  primaryResult?: string;
  secondaryResult?: string;
  finalOutput?: string;
  files: Array<{ path: string; action: string; content?: string }>;
  graphNodes: string[];
  attempts: number;
  duration: number;
  errors: string[];
  validated?: boolean;
  agentUsed?: string;
}

interface MinimalOrchestrator {
  on(event: string, handler: EventHandler): void;
  off(event: string, handler: EventHandler): void;
  execute(task: string, forceStrategy?: ExecutionStrategy): Promise<OrchestratorResult>;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const agentMsgIds: { opencode?: string; gemini?: string } = {};
let abortRef = false;
let currentStartTime = 0;

export async function run(prompt: string, strategy?: ExecutionStrategy): Promise<void> {
  const state = useStore.getState();
  if (!prompt.trim() || state.isRunning) return;

  const strat = strategy ?? state.currentStrategy;
  abortRef = false;
  agentMsgIds.opencode = undefined;
  agentMsgIds.gemini = undefined;

  state.setRunning(true);
  state.setExecutionStart();
  state.setStrategy(strat);
  state.updateGraphStats({ nodes: 0, edges: 0, strategy: strat, duration: undefined, toolsUsed: undefined, validated: false });
  state.setLastPrompt(prompt);

  currentStartTime = Date.now();
  state.addMessage({ type: 'user', content: prompt });

  const sysId = state.addMessage({
    type: 'system',
    content: 'Strategy: ' + strat + ' -- Initializing agents...',
  });

  await runOrchestrator(prompt, strat, sysId);
}

function allAgentsOffline(): boolean {
  const st = useStore.getState();
  return st.agentStatus.opencode.status === 'offline' && st.agentStatus.gemini.status === 'offline';
}

async function runOrchestrator(prompt: string, strat: ExecutionStrategy, sysId: string): Promise<void> {
  const state = useStore.getState();
  let orchestrator: MinimalOrchestrator | null = null;
  const handlers: Array<[string, EventHandler]> = [];

  // If both agents are offline, skip orchestrator and run simulation
  if (allAgentsOffline()) {
    state.updateMessage(sysId, { content: 'Strategy: ' + strat + ' -- No agents available, running simulation' });
    await runSimulation(prompt, strat, sysId);
    state.setRunning(false);
    return;
  }

  try {
    const mod = await import('../../multi-agent/orchestrator/index.js');
    const { DualOrchestrator } = mod as {
      DualOrchestrator: new (cfg: {
        strategy: ExecutionStrategy;
        workingDir: string;
        maxRetries?: number;
        timeoutMs?: number;
        env?: Record<string, string>;
      }) => MinimalOrchestrator
    };

    orchestrator = new DualOrchestrator({
      strategy: strat,
      workingDir: process.cwd(),
      maxRetries: 2,
      timeoutMs: 60000,
      env: process.env as Record<string, string>,
    });
  } catch (importErr) {
    state.updateMessage(sysId, { content: 'Strategy: ' + strat + ' -- Orchestrator not found, running simulation' });
    await runSimulation(prompt, strat, sysId);
    state.setRunning(false);
    return;
  }

  const on = (event: string, handler: EventHandler) => {
    orchestrator!.on(event, handler);
    handlers.push([event, handler]);
  };

  const off = (event: string, handler: EventHandler) => {
    orchestrator!.off(event, handler);
  };

  on(EVENTS.TASK_STARTED, (data: unknown) => {
    if (abortRef) return;
    const d = data as { task?: string; taskId?: string };
    state.updateMessage(sysId, { content: 'Strategy: ' + strat + ' -- Task started: ' + (d.task ?? 'processing') });
  });

  on(EVENTS.TASK_COMPLETED, (data: unknown) => {
    if (abortRef) return;
    const d = data as { taskId?: string; attempts?: number; agent?: string };
    state.updateMessage(sysId, { content: 'Strategy: ' + strat + ' -- Task completed (' + (d.attempts ?? 1) + ' attempt(s))' });
    state.updateGraphStats({ nodes: 2, edges: 1 });
    state.setAgentStatus('opencode', { status: 'ready' });
    state.setAgentStatus('gemini', { status: 'ready' });
  });

  on(EVENTS.TASK_FAILED, (data: unknown) => {
    const d = data as { taskId?: string; errors?: string[] };
    state.addMessage({ type: 'error', content: 'Task failed: ' + ((d.errors ?? ['Unknown error']) as string[]).join(', ') });
    state.setAgentStatus('opencode', { status: 'ready' });
    state.setAgentStatus('gemini', { status: 'ready' });
  });

  try {
    const result = await (orchestrator as MinimalOrchestrator).execute(prompt, strat);
    const duration = Date.now() - currentStartTime;

    if (result.primaryResult || result.finalOutput) {
      const ocId = state.addMessage({
        type: 'opencode',
        content: result.finalOutput ?? result.primaryResult ?? '',
        agent: 'opencode',
        isStreaming: false,
      });
      agentMsgIds.opencode = ocId;
    }

    if (result.secondaryResult && result.secondaryResult !== result.primaryResult) {
      const gemId = state.addMessage({
        type: 'gemini',
        content: result.secondaryResult,
        agent: 'gemini',
        isStreaming: false,
      });
      agentMsgIds.gemini = gemId;
    }

    if (result.files && result.files.length > 0) {
      const ocId = agentMsgIds.opencode;
      if (ocId) {
        for (const file of result.files) {
          state.addToolToMessage(ocId, {
            name: file.action,
            args: file.path,
            status: 'done',
            result: file.content ? '(edited ' + file.content.length + ' chars)' : undefined,
          });
        }
      }
    }

    state.updateGraphStats({
      duration,
      nodes: result.graphNodes?.length ?? 2,
      edges: result.files?.length ?? 0,
      toolsUsed: result.files?.length ?? 0,
      validated: result.validated ?? false,
    });

    state.addMessage({
      type: 'graph-stats',
      content: JSON.stringify({
        strategy: strat,
        duration: formatDuration(duration),
        toolsUsed: result.files?.length ?? 0,
        nodes: result.graphNodes?.length ?? 2,
        edges: result.files?.length ?? 0,
        validated: result.validated ?? false,
        agentUsed: result.agentUsed,
      }),
    });

    if (result.errors && result.errors.length > 0) {
      for (const err of result.errors) {
        state.addMessage({ type: 'error', content: err });
      }
    }
  } catch (execErr) {
    const msg = execErr instanceof Error ? execErr.message : String(execErr);
    state.addMessage({ type: 'error', content: 'Execution failed: ' + msg });
  } finally {
    for (const [event, handler] of handlers) {
      off(event, handler);
    }
    state.setRunning(false);
  }
}

export function cancel(): void {
  abortRef = true;
  const state = useStore.getState();
  state.setRunning(false);
  state.addMessage({ type: 'system', content: 'Execution cancelled by user.' });
}

async function runSimulation(prompt: string, strat: ExecutionStrategy, sysId: string): Promise<void> {
  const state = useStore.getState();

  await delay(300);
  if (abortRef) return;

  const ocId = state.addMessage({ type: 'opencode', content: '', agent: 'opencode', isStreaming: true });
  agentMsgIds.opencode = ocId;
  state.setAgentStatus('opencode', { status: 'busy' });

  const ocChunks = [
    'Analyzing: "' + prompt.slice(0, 50) + (prompt.length > 50 ? '...' : '') + '"\n\n',
    'Planning implementation...\n',
    '- Setup project structure\n',
    '- Implement core logic\n',
    '- Add error handling\n\n',
  ];

  for (const chunk of ocChunks) {
    if (abortRef) return;
    state.appendToMessage(ocId, chunk);
    await delay(120);
  }

  const t1 = state.addToolToMessage(ocId, { name: 'Write', args: 'src/index.js', status: 'running' });
  await delay(600);
  if (!abortRef) state.updateToolInMessage(ocId, t1, { status: 'done', lines: 42 });

  const t2 = state.addToolToMessage(ocId, { name: 'Bash', args: 'npm init -y', status: 'running' });
  await delay(400);
  if (!abortRef) state.updateToolInMessage(ocId, t2, { status: 'done' });

  state.updateGraphStats({ nodes: 6, edges: 4 });
  await delay(200);

  if (!abortRef) {
    state.appendToMessage(ocId, '\nImplementation complete.\n');
    state.updateMessage(ocId, { isStreaming: false });
    state.setAgentStatus('opencode', { status: 'ready' });
  }

  if ((strat === 'opencode-first' || strat === 'parallel') && !abortRef) {
    await delay(250);
    const gemId = state.addMessage({ type: 'gemini', content: '', agent: 'gemini', isStreaming: true });
    agentMsgIds.gemini = gemId;
    state.setAgentStatus('gemini', { status: 'busy' });

    const gemChunks = strat === 'parallel'
      ? ['Running independent research...\n\n', '- Performance analysis\n', '- Security review\n', '- Best practices check\n\n']
      : ['Reviewing OpenCode implementation...\n\n', 'Analysis:\n', '  Code quality: PASS\n', '  Structure: CLEAN\n', '  Security: OK\n\n', 'Approved.\n'];

    for (const chunk of gemChunks) {
      if (abortRef) break;
      state.appendToMessage(gemId, chunk);
      await delay(100);
    }

    if (!abortRef) {
      state.updateMessage(gemId, { isStreaming: false });
      state.setAgentStatus('gemini', { status: 'ready' });
    }
    state.updateGraphStats({ nodes: 12, edges: 8 });
  }

  if (abortRef) return;

  state.updateMessage(sysId, { content: 'Strategy: ' + strat + ' -- Simulation complete' });

  const duration = Date.now() - currentStartTime;
  state.addMessage({
    type: 'graph-stats',
    content: JSON.stringify({
      strategy: strat,
      duration: formatDuration(duration),
      toolsUsed: 2,
      nodes: 12,
      edges: 8,
      validated: true,
    }),
  });
}

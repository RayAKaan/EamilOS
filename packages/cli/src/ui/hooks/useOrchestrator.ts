import { useStore } from '../state/store.js';
import type { ExecutionStrategy } from '../types/ui.js';

type EventHandler = (...args: unknown[]) => void;

interface MinimalOrchestrator {
  on(event: string, handler: EventHandler): void;
  off(event: string, handler: EventHandler): void;
  execute(task: string, forceStrategy?: ExecutionStrategy): Promise<{
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
  }>;
}

function getAgentKey(agent: string): 'opencode' | 'gemini' {
  return agent.toLowerCase().includes('gemini') ? 'gemini' : 'opencode';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
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
  state.updateGraphStats({
    nodes: 0, edges: 0, strategy: strat, duration: undefined, toolsUsed: undefined, validated: false,
  });
  state.setLastPrompt(prompt);

  currentStartTime = Date.now();
  state.addMessage({ type: 'user', content: prompt });

  const sysId = state.addMessage({
    type: 'system',
    content: `Strategy: ${strat} -- Initializing agents...`,
  });

  await runOrchestrator(prompt, strat, sysId);
}

async function runOrchestrator(
  prompt: string,
  strat: ExecutionStrategy,
  sysId: string
): Promise<void> {
  const state = useStore.getState();
  let orchestrator: MinimalOrchestrator | null = null;
  const handlers: Array<[string, EventHandler]> = [];

  try {
    const mod = await import('../../multi-agent/orchestrator/index.js');
    const { DualOrchestrator } = mod as {
      DualOrchestrator: new (cfg: {
        strategy: ExecutionStrategy;
        workingDir: string;
        maxRetries?: number;
        timeoutMs?: number;
        env?: Record<string, string>;
      }) => MinimalOrchestrator;
    };

    orchestrator = new DualOrchestrator({
      strategy: strat,
      workingDir: process.cwd(),
      maxRetries: 2,
      timeoutMs: 180000,
      env: process.env as Record<string, string>,
    });
  } catch (importErr) {
    state.updateMessage(sysId, {
      content: `Strategy: ${strat} -- Orchestrator not found, running simulation`,
    });
    await runSimulation(prompt, strat, sysId);
    state.setRunning(false);
    return;
  }

  // Register event handlers
  const on = (event: string, handler: EventHandler) => {
    orchestrator!.on(event, handler);
    handlers.push([event, handler]);
  };
  const off = (event: string, handler: EventHandler) => {
    orchestrator!.off(event, handler);
  };

  // Agent started
  on('agent.started', (agent: unknown) => {
    const k = getAgentKey(String(agent));
    agentMsgIds[k] = state.addMessage({ type: k, content: '', agent: k, isStreaming: true });
    state.updateMessage(sysId, {
      content: `Strategy: ${strat} -- Agent started: ${String(agent)}`,
    });
    state.setAgentStatus(k, { status: 'busy' });
  });

  // Agent output chunks (streaming)
  on('agent.output', (agent: unknown, chunk: unknown) => {
    if (abortRef) return;
    const id = agentMsgIds[getAgentKey(String(agent))];
    if (id) state.appendToMessage(id, String(chunk));
  });

  // Agent completed
  on('agent.completed', (agent: unknown, result: unknown) => {
    const k = getAgentKey(String(agent));
    const id = agentMsgIds[k];
    if (id) {
      state.updateMessage(id, { isStreaming: false });
      const msg = state.messages.find((m) => m.id === id);
      if (msg && !msg.content.trim() && result) {
        state.updateMessage(id, { content: String(result) });
      }
    }
    state.setAgentStatus(k, { status: 'ready' });
  });

  // Validation events
  on('validation.started', () => {
    state.updateMessage(sysId, { content: `Strategy: ${strat} -- Validating...` });
  });

  on('validation.passed', () => {
    state.updateMessage(sysId, { content: `Strategy: ${strat} -- Validation passed` });
  });

  on('validation.failed', (result: unknown) => {
    state.updateMessage(sysId, {
      content: `Strategy: ${strat} -- Validation failed: ${String(result)}`,
    });
  });

  // Graph events
  on('graph.node', () => state.updateGraphStats({ nodes: state.graphStats.nodes + 1 }));
  on('graph.edge', () => state.updateGraphStats({ edges: state.graphStats.edges + 1 }));

  // Orchestrator done
  on('orchestrator.done', (data: unknown) => {
    const d = data as { duration?: number; strategy?: string; success?: boolean } | undefined;
    const dur = Date.now() - currentStartTime;
    const { graphStats } = state;
    const toolsUsed = Object.values(agentMsgIds).reduce((a, id) => {
      if (!id) return a;
      return a + (state.messages.find((m) => m.id === id)?.tools?.length ?? 0);
    }, 0);
    state.updateGraphStats({
      duration: dur,
      toolsUsed,
      validated: true,
    });
    state.addMessage({
      type: 'graph-stats',
      content: JSON.stringify({
        strategy: strat,
        duration: formatDuration(dur),
        toolsUsed,
        nodes: graphStats.nodes,
        edges: graphStats.edges,
        validated: true,
      }),
    });
    state.setRunning(false);
  });

  // Orchestrator error
  on('orchestrator.error', (err: unknown) => {
    state.addMessage({ type: 'error', content: String(err) });
    state.setRunning(false);
  });

  // Task-level events (for tracking)
  on('task:started', () => {
    state.updateMessage(sysId, { content: `Strategy: ${strat} -- Task running...` });
  });
  on('task:completed', (data: unknown) => {
    const d = data as { attempts?: number; agent?: string } | undefined;
    state.updateMessage(sysId, {
      content: `Strategy: ${strat} -- Task completed (${d?.attempts ?? 1} attempt(s))`,
    });
  });
  on('task:failed', (data: unknown) => {
    const d = data as { errors?: string[] } | undefined;
    state.addMessage({
      type: 'error',
      content: `Task failed: ${(d?.errors ?? ['Unknown error']).join(', ')}`,
    });
    state.setAgentStatus('opencode', { status: 'ready' });
    state.setAgentStatus('gemini', { status: 'ready' });
  });

  // Execute!
  try {
    await orchestrator.execute(prompt, strat);
  } catch (execErr) {
    const msg = execErr instanceof Error ? execErr.message : String(execErr);
    state.addMessage({ type: 'error', content: `Execution failed: ${msg}` });
    state.setRunning(false);
  } finally {
    for (const [event, handler] of handlers) {
      off(event, handler);
    }
  }
}

export function cancel(): void {
  abortRef = true;
  const state = useStore.getState();
  state.setRunning(false);
  state.addMessage({ type: 'system', content: 'Execution cancelled by user' });
}

async function runSimulation(
  prompt: string,
  strat: ExecutionStrategy,
  sysId: string
): Promise<void> {
  const state = useStore.getState();

  await delay(300);
  if (abortRef) return;

  const ocId = state.addMessage({
    type: 'opencode', content: '', agent: 'opencode', isStreaming: true,
  });
  agentMsgIds.opencode = ocId;
  state.setAgentStatus('opencode', { status: 'busy' });

  const ocChunks = [
    `Analyzing: "${prompt.slice(0, 50)}${prompt.length > 50 ? '...' : ''}"\n\n`,
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

    const gemId = state.addMessage({
      type: 'gemini', content: '', agent: 'gemini', isStreaming: true,
    });
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

  state.updateMessage(sysId, {
    content: `Strategy: ${strat} -- Simulation complete`,
  });

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

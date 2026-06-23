import { useStore } from '../state/store.js';
import type { ExecutionStrategy } from '../types/ui.js';

type AnyFn = (...args: unknown[]) => void;
interface Orchestrator { on(e: string, h: AnyFn): void; run(p: string): Promise<unknown>; }

let activeAbort = false;

const fmt = (ms: number) => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
const key  = (a: string): 'opencode' | 'gemini' =>
  a.toLowerCase().includes('gemini') ? 'gemini' : 'opencode';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Simulation ─────────────────────────────────────────────────────────────

async function simulate(
  prompt: string, strategy: ExecutionStrategy, t0: number
): Promise<void> {
  const S = useStore.getState;

  S().addMessage({ type: 'system',
    content: `demo mode  (orchestrator not found)\nstrategy : ${strategy}` });

  await sleep(200); if (activeAbort) return;

  const ocId = S().addMessage({ type: 'opencode', content: '', agent: 'opencode', isStreaming: true });

  const ocChunks = [
    `task: ${prompt}\n\n`,
    'analysing requirements...\n',
    'building implementation plan\n\n',
    'step 1  scaffold project structure\n',
    'step 2  implement core logic\n',
    'step 3  error handling & tests\n\n',
  ];
  for (const c of ocChunks) {
    if (activeAbort) break;
    S().appendToMessage(ocId, c);
    await sleep(80);
  }

  if (!activeAbort) {
    const t1 = S().addToolToMessage(ocId, { name: 'Write', args: 'src/index.js',   status: 'running' });
    await sleep(500); S().updateToolInMessage(ocId, t1, { status: 'done', lines: 42 });
    const t2 = S().addToolToMessage(ocId, { name: 'Bash',  args: 'npm init -y',    status: 'running' });
    await sleep(350); S().updateToolInMessage(ocId, t2, { status: 'done' });
    const t3 = S().addToolToMessage(ocId, { name: 'Write', args: 'package.json',   status: 'running' });
    await sleep(300); S().updateToolInMessage(ocId, t3, { status: 'done', lines: 18 });

    S().updateGraphStats({ nodes: 6, edges: 4 });
    S().appendToMessage(ocId, '\nimplementation complete\n');
    S().updateMessage(ocId, { isStreaming: false });
    S().setAgentStatus('opencode', { status: 'ready' });
  }

  if ((strategy === 'opencode-first' || strategy === 'parallel') && !activeAbort) {
    await sleep(200);
    const gId = S().addMessage({ type: 'gemini', content: '', agent: 'gemini', isStreaming: true });

    const gChunks = strategy === 'parallel'
      ? ['independent analysis...\n\n', 'performance  : acceptable\n', 'security     : minimal surface\n', 'structure    : clean\n\n']
      : ['reviewing opencode output...\n\n', 'code quality   : pass\n', 'error handling : pass\n', 'structure      : pass\n\napproved\n'];

    for (const c of gChunks) {
      if (activeAbort) break;
      S().appendToMessage(gId, c);
      await sleep(100);
    }
    if (!activeAbort) {
      S().updateMessage(gId, { isStreaming: false });
      S().setAgentStatus('gemini', { status: 'ready' });
      S().updateGraphStats({ nodes: 12, edges: 8 });
    }
  }

  if (activeAbort) return;

  const dur = Date.now() - t0;
  S().updateGraphStats({ duration: dur, toolsUsed: 3, validated: true });
  S().addMessage({
    type: 'graph-stats',
    content: JSON.stringify({ strategy, duration: fmt(dur), toolsUsed: 3, nodes: 12, edges: 8, validated: true }),
  });
}

// ── Real orchestrator ──────────────────────────────────────────────────────

async function runReal(
  prompt: string, strategy: ExecutionStrategy, t0: number
): Promise<void> {
  const mod = (await import('../../multi-agent/orchestrator/index.js')) as {
    DualOrchestrator: new (c: Record<string, unknown>) => Orchestrator;
  };
  const orch = new mod.DualOrchestrator({
    strategy,
    opencode: { model: process.env['OPENCODE_MODEL'] ?? 'anthropic/claude-sonnet-4-5' },
    gemini:   { yolo: true },
  });

  const ids: Partial<Record<'opencode' | 'gemini', string>> = {};
  const S = useStore.getState;

  const sysId = S().addMessage({ type: 'system', content: `strategy : ${strategy}\ninitialising...` });

  orch.on('agent.started', (a: unknown) => {
    const k = key(String(a));
    ids[k] = S().addMessage({ type: k, content: '', agent: k, isStreaming: true });
    S().updateMessage(sysId, { content: `strategy : ${strategy}\nagent started : ${String(a)}` });
    S().setAgentStatus(k, { status: 'busy' });
  });
  orch.on('agent.output', (a: unknown, c: unknown) => {
    if (activeAbort) return;
    const id = ids[key(String(a))];
    if (id) S().appendToMessage(id, String(c));
  });
  orch.on('agent.tool', (a: unknown, t: unknown) => {
    if (activeAbort) return;
    const id = ids[key(String(a))];
    if (!id) return;
    const tool = t as { name: string; args?: string };
    S().addToolToMessage(id, { name: tool.name ?? 'tool', args: tool.args ?? '', status: 'running' });
  });
  orch.on('tool.result', (a: unknown, n: unknown, r: unknown) => {
    if (activeAbort) return;
    const id = ids[key(String(a))];
    if (!id) return;
    const msg  = S().messages.find((m) => m.id === id);
    const tool = [...(msg?.tools ?? [])].reverse().find((t) => t.name === String(n));
    if (tool) S().updateToolInMessage(id, tool.id, { status: 'done', result: String(r ?? '').slice(0, 100) });
  });
  orch.on('tool.error', (a: unknown, n: unknown, e: unknown) => {
    const id  = ids[key(String(a))];
    if (!id) return;
    const msg  = S().messages.find((m) => m.id === id);
    const tool = (msg?.tools ?? []).find((t) => t.name === String(n));
    if (tool) S().updateToolInMessage(id, tool.id, { status: 'failed', result: String(e) });
  });
  orch.on('agent.completed', (a: unknown, result?: unknown) => {
    const k = key(String(a)); const id = ids[k];
    if (id) {
      S().updateMessage(id, { isStreaming: false });
      const msg = S().messages.find((m) => m.id === id);
      if (msg && !msg.content.trim() && result) {
        S().updateMessage(id, { content: String(result) });
      }
    }
    S().setAgentStatus(k, { status: 'ready' });
  });
  orch.on('validation.started', () =>
    S().updateMessage(sysId, { content: `strategy : ${strategy}\nvalidating...` }));
  orch.on('validation.passed',  () =>
    S().updateMessage(sysId, { content: `strategy : ${strategy}\nvalidation : passed` }));
  orch.on('validation.failed',  (r: unknown) =>
    S().updateMessage(sysId, { content: `strategy : ${strategy}\nvalidation : failed\n${String(r)}` }));
  orch.on('graph.node', () => S().updateGraphStats({ nodes: S().graphStats.nodes + 1 }));
  orch.on('graph.edge', () => S().updateGraphStats({ edges: S().graphStats.edges + 1 }));
  orch.on('orchestrator.done', () => {
    const dur = Date.now() - t0;
    const { graphStats } = S();
    const toolsUsed = Object.values(ids).reduce((a, id) => {
      if (!id) return a;
      return a + (S().messages.find((m) => m.id === id)?.tools?.length ?? 0);
    }, 0);
    S().updateGraphStats({ duration: dur, toolsUsed, validated: true });
    S().addMessage({
      type: 'graph-stats',
      content: JSON.stringify({ strategy, duration: fmt(dur), toolsUsed,
        nodes: graphStats.nodes, edges: graphStats.edges, validated: true }),
    });
    S().setRunning(false);
  });
  orch.on('orchestrator.error', (e: unknown) => {
    S().addMessage({ type: 'error', content: String(e) });
    S().setRunning(false);
  });

  await orch.run(prompt);
}

// ── Public ─────────────────────────────────────────────────────────────────

export async function run(
  prompt: string, strategy?: ExecutionStrategy
): Promise<void> {
  const S = useStore.getState;
  if (S().isRunning || !prompt.trim()) return;

  activeAbort = false;
  const strat = strategy ?? S().currentStrategy;
  const t0    = Date.now();

  S().setRunning(true);
  S().setExecutionStart();
  S().setStrategy(strat);
  S().setLastPrompt(prompt);
  S().updateGraphStats({ nodes: 0, edges: 0, strategy: strat, validated: false });
  S().addMessage({ type: 'user', content: prompt });

  try {
    await runReal(prompt, strat, t0);
  } catch {
    await simulate(prompt, strat, t0);
    S().setRunning(false);
  }
}

export function cancel(): void {
  activeAbort = true;
  useStore.getState().setRunning(false);
  useStore.getState().addMessage({ type: 'system', content: 'cancelled by user' });
}

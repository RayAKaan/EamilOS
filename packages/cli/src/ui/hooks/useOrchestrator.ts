import { useStore } from '../state/store.js';
import type { ExecutionStrategy, TerminalInfo } from '../types/ui.js';
import { createSessionOrchestrator } from '../../core/session/SessionOrchestrator.js';
import { AgentRegistry } from '../../core/agents/AgentRegistry.js';
import { initEamilOS } from '../../core/index.js';
import {
  AdaptiveMultiplexer,
  getAdaptiveMultiplexer,
  type AgentOperationalMode,
  type AgentTerminalDef,
} from '../../terminal/index.js';

type EventHandler = (...args: unknown[]) => void;

const EVENTS = {
  TASK_STARTED: 'task:started',
  TASK_COMPLETED: 'task:completed',
  TASK_FAILED: 'task:failed',
} as const;

function formatDuration(ms: number): string {
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

function formatDisplayContent(raw: string): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (parsed.summary && Array.isArray(parsed.files)) {
      let text = `${parsed.summary}\n`;
      for (const f of parsed.files) {
        text += `\n[${f.path}]\n${f.content}`;
      }
      return text.trim();
    }
  } catch {}
  return raw;
}

let abortRef = false;
let currentStartTime = 0;

export async function detectAndTrackAgents(): Promise<void> {
  const registry = AgentRegistry.create();

  try {
    await registry.detect();
    const available = registry.getAvailableAgents();
    const terminals: TerminalInfo[] = [];

    const knownCallsigns: Record<string, string> = {
      'opencode': 'BETA',
      'claude-code': 'ALPHA',
      'aider': 'DELTA',
      'goose': 'EPSILON',
      'gemini-cli': 'GAMMA',
      'codex-cli': 'ZETA',
      'ollama': 'OMEGA',
      'openai-api': 'THETA',
      'anthropic-api': 'IOTA',
    };

    const defaultMode: Record<string, AgentOperationalMode> = {
      'opencode': 'execution',
      'claude-code': 'execution',
      'aider': 'execution',
      'goose': 'execution',
      'gemini-cli': 'communication',
      'codex-cli': 'execution',
      'ollama': 'communication',
      'openai-api': 'communication',
      'anthropic-api': 'communication',
    };

    for (const agent of available) {
      const callsign = knownCallsigns[agent.id];
      if (callsign) {
        terminals.push({ callsign, agentId: agent.id, mode: defaultMode[agent.id] || 'execution' });
      }
    }

    useStore.getState().setActiveTerminals(terminals);

    if (terminals.length > 0) {
      const multiplexer = getAdaptiveMultiplexer();
      const terminalDefs: AgentTerminalDef[] = terminals.map(t => ({
        id: t.agentId,
        callsign: t.callsign,
        command: '',
        args: [],
        mode: t.mode,
      }));
      await multiplexer.spawnAgentTerminals(terminalDefs);
    }
  } catch {
  }
}

export async function run(prompt: string, strategy?: ExecutionStrategy): Promise<void> {
  const state = useStore.getState();
  if (!prompt.trim() || state.isRunning) return;

  const strat = strategy ?? state.currentStrategy;
  abortRef = false;

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

  try {
    await initEamilOS();
  } catch {
  }

  await runOrchestrator(prompt, strat, sysId);
}

async function runOrchestrator(prompt: string, strat: ExecutionStrategy, sysId: string): Promise<void> {
  const state = useStore.getState();
  const handlers: Array<[string, EventHandler]> = [];

  const normalizeStrategy = (s: string): 'single' | 'fallback' | 'swarm' | 'manual' => {
    if (s === 'swarm') return 'swarm';
    if (s === 'single' || s === 'manual') return s;
    return 'fallback';
  };

  const session = createSessionOrchestrator({
    goal: prompt,
    projectId: `tui_${Date.now()}`,
    strategy: normalizeStrategy(strat),
    mode: 'execution',
    workingDir: process.cwd(),
    maxRetries: 2,
    timeoutMs: 120000,
  });

  try {
    state.updateMessage(sysId, { content: 'Strategy: ' + strat + ' -- Running...' });

    session.on('agent.output', (data) => {
      if (abortRef) return;
      state.addMessage({ type: 'system', content: `[${data.agentId}] ${data.content.slice(0, 200)}` });
    });

    session.on('agent.fallback', (data) => {
      state.setAgentStatus(data.from, { status: 'failed' });
      state.setAgentStatus(data.to, { status: 'busy' });
      state.addMessage({ type: 'system', content: `Fallback: ${data.from} → ${data.to} (${data.reason})` });
    });

    session.on('agent.completed', (data) => {
      state.setAgentStatus(data.agentId, { status: 'ready' });
    });

    session.on('agent.started', (data) => {
      state.setAgentStatus(data.agentId, { status: 'busy' });
    });

    session.on('session.completed', (data) => {
      const duration = Date.now() - currentStartTime;
      state.updateGraphStats({ duration, nodes: 2, edges: 1 });
    });

    session.on('session.error', (data) => {
      state.addMessage({ type: 'error', content: 'Session error: ' + data.error });
    });

    session.on('changes.collected', (data) => {
      state.updateGraphStats({ nodes: data.changes?.length || 2, edges: data.changes?.length || 1 });
    });

    const result = await session.run();
    const duration = Date.now() - currentStartTime;

    const rawContent = result.primaryResult ?? '';
    if (rawContent) {
      const msgId = state.addMessage({
        type: 'eamilos',
        content: formatDisplayContent(rawContent),
        agent: result.agentUsed || 'EamilOS',
        isStreaming: false,
      });

      if (result.fileChanges && result.fileChanges.length > 0) {
        for (const file of result.fileChanges) {
          state.addToolToMessage(msgId, {
            name: file.action === 'delete' ? 'deleted' : file.action === 'modify' ? 'modified' : 'created',
            args: file.path,
            status: 'done',
            result: file.content ? '(content ' + file.content.length + ' chars)' : undefined,
          });
        }
      }
    }

    state.updateGraphStats({
      duration,
      nodes: result.fileChanges?.length || 2,
      edges: result.fileChanges?.length || 0,
      toolsUsed: result.fileChanges?.length || 0,
      validated: result.errors.length === 0,
    });

    state.addMessage({
      type: 'graph-stats',
      content: JSON.stringify({
        strategy: strat,
        duration: formatDuration(duration),
        toolsUsed: result.fileChanges?.length ?? 0,
        nodes: 2,
        edges: result.fileChanges?.length ?? 0,
        validated: result.errors.length === 0,
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
    state.setRunning(false);
  }
}

export function cancel(): void {
  abortRef = true;
  const state = useStore.getState();
  state.setRunning(false);
  state.addMessage({ type: 'system', content: 'Execution cancelled by user.' });
}

import { useStore } from '../state/store.js';
import type { ExecutionStrategy, TerminalInfo } from '../types/ui.js';
import { createSessionOrchestrator } from '../../core/session/SessionOrchestrator.js';
import type { SessionOrchestrator } from '../../core/session/SessionOrchestrator.js';
import { getAdaptiveMultiplexer } from '../../terminal/AdaptiveMultiplexer.js';
import { AgentRegistry } from '../../core/agents/AgentRegistry.js';
import { CallsignRegistry } from '../../core/identity/CallsignRegistry.js';
import { initEamilOS } from '../../core/index.js';
import type { AgentMode } from '../../core/agents/types.js';

type EventHandler = (...args: unknown[]) => void;

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
let activeSession: SessionOrchestrator | null = null;

export function normalizeStrategyForSession(s: string): 'single' | 'single-fallback' | 'fallback' | 'swarm' | 'manual' {
  const valid = ['single', 'single-fallback', 'fallback', 'swarm', 'manual'] as const;
  if ((valid as readonly string[]).includes(s)) return s as 'single' | 'single-fallback' | 'fallback' | 'swarm' | 'manual';
  return 'single-fallback';
}

export async function detectAndTrackAgents(): Promise<void> {
  const registry = AgentRegistry.create();
  const state = useStore.getState();

  try {
    await registry.detect();

    const allAgents = registry.getAllAgents();
    const available = registry.getAvailableAgents();

    const rankedAvailable = [...available].sort((a, b) => a.priority - b.priority);

    const callsigns = new CallsignRegistry();
    await callsigns.assign(rankedAvailable.map((a) => a.id));

    const terminals: TerminalInfo[] = [];

    for (const agent of allAgents) {
      const callsign = callsigns.callsignFor(agent.id);

      state.setAgentStatus(agent.id, {
        id: agent.id,
        name: agent.name,
        callsign,
        kind: agent.kind,
        provider: agent.provider,
        version: agent.version,
        error: agent.error,
        status: agent.status === 'available' ? 'ready' : 'offline',
        mode: getDefaultMode(agent.id),
      });

      if (agent.status === 'available') {
        terminals.push({
          callsign: callsign ?? agent.id.toUpperCase().slice(0, 4),
          agentId: agent.id,
          mode: getDefaultMode(agent.id),
          status: 'ready',
        });
      }
    }

    state.setActiveTerminals(terminals);

    state.addLog(
      `Detected agents: ${
        rankedAvailable.length > 0
          ? rankedAvailable.map((a) => `${callsigns.callsignFor(a.id) ?? '-'}:${a.id}`).join(', ')
          : 'none'
      }`
    );
  } catch (err) {
    state.addLog(`Agent detection failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function getDefaultMode(agentId: string): AgentMode {
  const executionAgents = ['opencode', 'claude-code', 'aider', 'goose', 'codex-cli'];
  return executionAgents.includes(agentId) ? 'execution' : 'communication';
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

  const uiSessionId = `session_${currentStartTime}`;
  let uiSessionStatus: 'completed' | 'failed' = 'failed';
  const streamingMessageIds = new Map<string, string>();

  function getAgentLabel(agentId: string): string {
    const s = useStore.getState();
    const terminal = s.activeTerminals.find((t) => t.agentId === agentId);
    const callsign = terminal?.callsign;
    return callsign ? `${callsign} · ${agentId}` : agentId;
  }

  function appendAgentOutput(agentId: string, chunk: string): void {
    const s = useStore.getState();
    const label = getAgentLabel(agentId);

    let messageId = streamingMessageIds.get(agentId);

    if (!messageId) {
      messageId = s.addMessage({
        type: 'system',
        eventLabel: label,
        content: `${label}\n${chunk}`,
        isStreaming: true,
      });
      streamingMessageIds.set(agentId, messageId);
      return;
    }

    s.appendToMessage(messageId, chunk);
  }

  function updateTerminalFromEvent(agentId: string, updates: Record<string, unknown>): void {
    const s = useStore.getState();
    const terminal = s.activeTerminals.find((t) => t.agentId === agentId);
    if (terminal) {
      s.updateTerminal(terminal.callsign, updates as any);
    }
  }

  const session = createSessionOrchestrator({
    goal: prompt,
    projectId: `tui_${Date.now()}`,
    strategy: normalizeStrategyForSession(strat),
    mode: state.currentMode,
    workingDir: process.cwd(),
    maxRetries: 2,
    timeoutMs: 120000,
  });
  activeSession = session;

  try {
    state.updateMessage(sysId, { content: 'Strategy: ' + strat + ' -- Running...' });

    session.on('agent.output', (data) => {
      if (abortRef) return;
      appendAgentOutput(data.agentId, data.content);
      state.addLog(`[${getAgentLabel(data.agentId)}] ${data.content}`);
      updateTerminalFromEvent(data.agentId, { lastLine: data.content.split('\n').filter(Boolean).at(-1) ?? data.content });
    });

    session.on('agent.fallback', (data) => {
      state.setAgentStatus(data.from, { status: 'failed' });
      state.setAgentStatus(data.to, { status: 'busy' });
      state.addMessage({ type: 'system', content: `Fallback: ${data.from} → ${data.to} (${data.reason})` });
    });

    session.on('agent.completed', (data) => {
      state.setAgentStatus(data.agentId, { status: 'ready' });

      const messageId = streamingMessageIds.get(data.agentId);
      if (messageId) {
        state.updateMessage(messageId, { isStreaming: false });
      }

      updateTerminalFromEvent(data.agentId, { status: 'done', endedAt: Date.now() });
    });

    session.on('agent.started', (data) => {
      state.setAgentStatus(data.agentId, { status: 'busy' });
      updateTerminalFromEvent(data.agentId, { status: 'running', startedAt: Date.now() });
    });

    session.on('agent.error', (data) => {
      state.setAgentStatus(data.agentId, { status: 'failed', error: data.error });
      updateTerminalFromEvent(data.agentId, { status: 'failed', endedAt: Date.now(), lastLine: data.error });
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

    session.on('permission.requested', (data) => {
      const id = state.addPermissionRequest({
        agentId: data.agentId,
        action: data.action,
        details: data.details,
      });

      state.openOverlay('permission', {
        request: {
          id: (data as any).requestId ?? id,
          agentId: data.agentId,
          action: data.action,
          details: data.details,
          requestId: (data as any).requestId,
        },
      });
    });

    const result = await session.run();
    uiSessionStatus = result.errors.length === 0 ? 'completed' : 'failed';
    const duration = Date.now() - currentStartTime;

    const rawContent = result.primaryResult ?? '';
    if (rawContent) {
      const msgId = state.addMessage({
        type: 'eamilos',
        content: formatDisplayContent(rawContent),
        agent: (result.agentUsed || 'EamilOS') as any,
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
    uiSessionStatus = 'failed';
    const msg = execErr instanceof Error ? execErr.message : String(execErr);
    state.addMessage({ type: 'error', content: 'Execution failed: ' + msg });
  } finally {
    activeSession = null;
    const latest = useStore.getState();
    latest.addSession({
      id: uiSessionId,
      goal: prompt,
      strategy: strat,
      startedAt: currentStartTime,
      messageCount: latest.messages.length,
      status: uiSessionStatus,
    });
    latest.setRunning(false);
  }
}

export function cancel(): void {
  abortRef = true;
  activeSession?.stop().catch(() => {});
  getAdaptiveMultiplexer().terminateAll();
  activeSession = null;
  const state = useStore.getState();
  state.setRunning(false);
  state.addMessage({ type: 'system', content: 'Execution cancelled by user.' });
}

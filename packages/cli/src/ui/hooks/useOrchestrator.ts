/**
 * useOrchestrator — Run the DualOrchestrator and stream events to the UI
 * Uses plain functions (not hooks) for imperative store access.
 */
import { useStore } from '../state/store.js';
import type { ExecutionStrategy } from '../types/ui.js';
import { DualOrchestrator } from '../../multi-agent/orchestrator/DualOrchestrator.js';
import { initEamilOS } from '../../core/index.js';

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
    // Continue even if config file init had warnings
  }

  await runOrchestrator(prompt, strat, sysId);
}

async function runOrchestrator(prompt: string, strat: ExecutionStrategy, sysId: string): Promise<void> {
  const state = useStore.getState();
  const handlers: Array<[string, EventHandler]> = [];

  const orchestrator = new DualOrchestrator({
    strategy: strat,
    workingDir: process.cwd(),
    maxRetries: 2,
    timeoutMs: 60000,
    env: process.env as Record<string, string>,
  });

  const on = (event: string, handler: EventHandler) => {
    orchestrator.on(event, handler);
    handlers.push([event, handler]);
  };

  const off = (event: string, handler: EventHandler) => {
    orchestrator.off(event, handler);
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
    state.setAgentStatus('opencode', { status: 'busy' });
    state.setAgentStatus('gemini', { status: 'busy' });
    const result = await orchestrator.execute(prompt, strat);
    const duration = Date.now() - currentStartTime;

    const rawContent = result.primaryResult ?? result.finalOutput ?? '';
    if (rawContent) {
      const msgId = state.addMessage({
        type: 'eamilos',
        content: formatDisplayContent(rawContent),
        agent: 'EamilOS',
        isStreaming: false,
      });

      if (result.files && result.files.length > 0) {
        for (const file of result.files) {
          state.addToolToMessage(msgId, {
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
    state.setAgentStatus('opencode', { status: 'ready' });
    state.setAgentStatus('gemini', { status: 'ready' });
    state.setRunning(false);
  }
}

export function cancel(): void {
  abortRef = true;
  const state = useStore.getState();
  state.setRunning(false);
  state.addMessage({ type: 'system', content: 'Execution cancelled by user.' });
}

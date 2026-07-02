// update.ts — All state transitions. Pure functions only. No side effects.

import type {
  AppModel, Page, AgentMode, Strategy,
  AgentEntry, TerminalEntry, Message, RunSummary,
  ModifiedFile,
} from './model.js';
import { nextMsgId } from './model.js';

// ── Action (Msg) union ───────────────────────────────────────────────────────
export type Msg =
  | { type: 'RESIZE';             width: number; height: number }
  | { type: 'SET_PAGE';           page: Page }
  | { type: 'SET_MODE';           mode: AgentMode }
  | { type: 'SET_STRATEGY';       strategy: Strategy }
  | { type: 'INPUT_CHAR';         char: string }
  | { type: 'INPUT_BACKSPACE' }
  | { type: 'INPUT_DELETE' }
  | { type: 'INPUT_CLEAR' }
  | { type: 'INPUT_RECALL' }
  | { type: 'INPUT_HOME' }
  | { type: 'INPUT_END' }
  | { type: 'INPUT_LEFT' }
  | { type: 'INPUT_RIGHT' }
  | { type: 'SUBMIT' }
  | { type: 'SCROLL_UP';          lines: number }
  | { type: 'SCROLL_DOWN';        lines: number }
  | { type: 'SCROLL_TOP' }
  | { type: 'SCROLL_BOTTOM' }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'CLEAR_CHAT' }
  | { type: 'TICK' }
  | { type: 'NOTIFY';             text: string }
  | { type: 'DETECTION_START' }
  | { type: 'DETECTION_COMPLETE'; agents: AgentEntry[] }
  | { type: 'DETECTION_FAILED';   error: string }
  | { type: 'SESSION_STARTED' }
  | { type: 'SESSION_COMPLETED';  summary: RunSummary }
  | { type: 'SESSION_ERROR';      error: string }
  | { type: 'AGENT_STARTED';      agentId: string }
  | { type: 'AGENT_OUTPUT';       agentId: string; content: string }
  | { type: 'AGENT_COMPLETED';    agentId: string }
  | { type: 'AGENT_ERROR';        agentId: string; error: string }
  | { type: 'AGENT_FALLBACK';     from: string; to: string; reason: string }
  | { type: 'CHANGES_COLLECTED';  files: ModifiedFile[] }
  | { type: 'VALIDATION_STARTED' }
  | { type: 'VALIDATION_PASSED' }
  | { type: 'VALIDATION_FAILED';  errors: string[] }
  | { type: 'CONFLICT_RESOLVED';  path: string; method: string; winner: string }
  | { type: 'TERMINAL_SPAWNED';   entry: TerminalEntry }
  | { type: 'TERMINAL_UPDATED';   agentId: string; lastLine: string; status: TerminalEntry['status'] }
  | { type: 'LOG';                text: string }
  | { type: 'STATUS_TEXT';        text: string };

// ── Helpers ──────────────────────────────────────────────────────────────────
function findCallsign(model: AppModel, agentId: string): string | undefined {
  return model.agents.get(agentId)?.callsign;
}

function makeMsg(
  partial: Omit<Message, 'id' | 'tools' | 'streaming'> &
           Partial<Pick<Message, 'tools' | 'streaming'>>,
): Message {
  return {
    id:        nextMsgId(),
    tools:     [],
    streaming: false,
    ...partial,
  };
}

// ── Main update ───────────────────────────────────────────────────────────────
export function update(model: AppModel, msg: Msg): AppModel {
  switch (msg.type) {

    // ── Geometry ──
    case 'RESIZE':
      return { ...model, width: msg.width, height: msg.height };

    // ── Navigation ──
    case 'SET_PAGE':
      return { ...model, page: msg.page };

    case 'SET_MODE':
      return { ...model, mode: msg.mode };

    case 'SET_STRATEGY':
      return { ...model, strategy: msg.strategy };

    // ── Input editing ──
    case 'INPUT_CHAR': {
      const input = model.input.slice(0, model.cursor) + msg.char + model.input.slice(model.cursor);
      return { ...model, input, cursor: model.cursor + 1 };
    }

    case 'INPUT_BACKSPACE': {
      if (model.cursor === 0) return model;
      const input = model.input.slice(0, model.cursor - 1) + model.input.slice(model.cursor);
      return { ...model, input, cursor: model.cursor - 1 };
    }

    case 'INPUT_DELETE': {
      if (model.cursor >= model.input.length) return model;
      const input = model.input.slice(0, model.cursor) + model.input.slice(model.cursor + 1);
      return { ...model, input };
    }

    case 'INPUT_CLEAR':
      return { ...model, input: '', cursor: 0 };

    case 'INPUT_RECALL':
      return { ...model, input: model.lastPrompt, cursor: model.lastPrompt.length };

    case 'INPUT_HOME':
      return { ...model, cursor: 0 };

    case 'INPUT_END':
      return { ...model, cursor: model.input.length };

    case 'INPUT_LEFT':
      return { ...model, cursor: Math.max(0, model.cursor - 1) };

    case 'INPUT_RIGHT':
      return { ...model, cursor: Math.min(model.input.length, model.cursor + 1) };

    case 'SUBMIT':
      return model; // side effect handled externally

    // ── Scrolling ──
    case 'SCROLL_UP':
      return { ...model, scroll: model.scroll + msg.lines };

    case 'SCROLL_DOWN':
      return { ...model, scroll: Math.max(0, model.scroll - msg.lines) };

    case 'SCROLL_TOP':
      return { ...model, scroll: 999999 };

    case 'SCROLL_BOTTOM':
      return { ...model, scroll: 0 };

    // ── UI toggles ──
    case 'TOGGLE_SIDEBAR':
      return { ...model, sidebarVisible: !model.sidebarVisible };

    case 'CLEAR_CHAT':
      return { ...model, messages: [], runSummary: null, modifiedFiles: [], scroll: 0 };

    case 'TICK':
      return {
        ...model,
        spinFrame:    (model.spinFrame + 1) % 10,
        notification: model.notification, // kept until explicitly cleared
      };

    case 'NOTIFY':
      return { ...model, notification: msg.text };

    // ── Detection ──
    case 'DETECTION_START':
      return { ...model, detectionState: 'detecting', statusText: 'Detecting agents…' };

    case 'DETECTION_COMPLETE': {
      const agents = new Map(model.agents);
      for (const a of msg.agents) agents.set(a.id, a);
      const readyCount = msg.agents.filter(a => a.status === 'ready').length;
      return {
        ...model,
        detectionState: 'complete',
        agents,
        statusText: `${readyCount} agent${readyCount !== 1 ? 's' : ''} ready`,
      };
    }

    case 'DETECTION_FAILED':
      return { ...model, detectionState: 'failed', statusText: `Detection failed: ${msg.error}` };

    // ── Session lifecycle ──
    case 'SESSION_STARTED': {
      const sysMsg = makeMsg({
        type:      'system',
        content:   `Strategy: ${model.strategy} · mode: ${model.mode}`,
        timestamp: Date.now(),
      });
      return {
        ...model,
        running:    true,
        scroll:     0,
        messages:   [...model.messages, sysMsg],
        statusText: 'Running…',
      };
    }

    case 'SESSION_COMPLETED': {
      const { summary } = msg;
      const summaryMsg = makeMsg({
        type:      'run_summary',
        content:   JSON.stringify(summary),
        timestamp: Date.now(),
        validated: summary.validated,
      });
      const updatedSessions = model.sessions.map(s =>
        s.status === 'running'
          ? { ...s, status: 'completed' as const, duration: summary.durationMs, messageCount: model.messages.length }
          : s,
      );
      return {
        ...model,
        running:     false,
        runSummary:  summary,
        messages:    [...model.messages, summaryMsg],
        sessions:    updatedSessions,
        statusText:  summary.validated ? '✓ Completed' : '✗ Failed',
      };
    }

    case 'SESSION_ERROR': {
      const errMsg = makeMsg({
        type:      'error',
        content:   msg.error,
        timestamp: Date.now(),
      });
      const updatedSessions = model.sessions.map(s =>
        s.status === 'running' ? { ...s, status: 'failed' as const } : s,
      );
      return {
        ...model,
        running:    false,
        messages:   [...model.messages, errMsg],
        sessions:   updatedSessions,
        statusText: `Error: ${msg.error.slice(0, 60)}`,
      };
    }

    // ── Agent events ──
    case 'AGENT_STARTED': {
      const agents = new Map(model.agents);
      const a = agents.get(msg.agentId);
      if (a) agents.set(msg.agentId, { ...a, status: 'busy' });
      const m = makeMsg({
        type:      'agent',
        agentId:   msg.agentId,
        callsign:  findCallsign(model, msg.agentId),
        content:   '',
        timestamp: Date.now(),
        streaming: true,
      });
      return { ...model, agents, messages: [...model.messages, m] };
    }

    case 'AGENT_OUTPUT': {
      const messages = [...model.messages];
      let found = false;
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]!;
        if (m.agentId === msg.agentId && m.streaming) {
          messages[i] = { ...m, content: m.content + msg.content };
          found = true;
          break;
        }
      }
      if (!found) {
        messages.push(makeMsg({
          type:      'agent',
          agentId:   msg.agentId,
          callsign:  findCallsign(model, msg.agentId),
          content:   msg.content,
          timestamp: Date.now(),
          streaming: true,
        }));
      }
      return { ...model, messages };
    }

    case 'AGENT_COMPLETED': {
      const agents = new Map(model.agents);
      const a = agents.get(msg.agentId);
      if (a) agents.set(msg.agentId, { ...a, status: 'ready' });
      const messages = model.messages.map(m =>
        m.agentId === msg.agentId && m.streaming ? { ...m, streaming: false } : m,
      );
      return { ...model, agents, messages };
    }

    case 'AGENT_ERROR': {
      const agents = new Map(model.agents);
      const a = agents.get(msg.agentId);
      if (a) agents.set(msg.agentId, { ...a, status: 'ready' });
      const messages = model.messages.map(m =>
        m.agentId === msg.agentId && m.streaming ? { ...m, streaming: false } : m,
      );
      const errMsg = makeMsg({
        type:      'error',
        agentId:   msg.agentId,
        content:   msg.error,
        timestamp: Date.now(),
      });
      return { ...model, agents, messages: [...messages, errMsg] };
    }

    case 'AGENT_FALLBACK': {
      const fbMsg = makeMsg({
        type:      'system',
        content:   `Fallback: ${msg.from} → ${msg.to} (${msg.reason})`,
        timestamp: Date.now(),
      });
      return { ...model, messages: [...model.messages, fbMsg] };
    }

    // ── File changes ──
    case 'CHANGES_COLLECTED':
      return { ...model, modifiedFiles: msg.files };

    case 'VALIDATION_STARTED': {
      const sysMsg = makeMsg({ type: 'system', content: 'Validating changes…', timestamp: Date.now() });
      return { ...model, messages: [...model.messages, sysMsg] };
    }

    case 'VALIDATION_PASSED': {
      const sysMsg = makeMsg({ type: 'system', content: '✓ Validation passed', timestamp: Date.now() });
      return { ...model, messages: [...model.messages, sysMsg] };
    }

    case 'VALIDATION_FAILED': {
      const sysMsg = makeMsg({
        type:      'error',
        content:   `Validation failed: ${msg.errors.join('; ')}`,
        timestamp: Date.now(),
      });
      return { ...model, messages: [...model.messages, sysMsg] };
    }

    case 'CONFLICT_RESOLVED': {
      const arbMsg = makeMsg({
        type:      'arbiter',
        content:   `${msg.path} → ${msg.winner} (${msg.method})`,
        timestamp: Date.now(),
      });
      return { ...model, messages: [...model.messages, arbMsg] };
    }

    // ── Terminals ──
    case 'TERMINAL_SPAWNED':
      return { ...model, terminals: [...model.terminals, msg.entry] };

    case 'TERMINAL_UPDATED': {
      const terminals = model.terminals.map(t =>
        t.agentId === msg.agentId ? { ...t, lastLine: msg.lastLine, status: msg.status } : t,
      );
      return { ...model, terminals };
    }

    // ── Logs ──
    case 'LOG':
      return { ...model, logs: [...model.logs, msg.text].slice(-1000) };

    // ── Status ──
    case 'STATUS_TEXT':
      return { ...model, statusText: msg.text };

    default:
      return model;
  }
}

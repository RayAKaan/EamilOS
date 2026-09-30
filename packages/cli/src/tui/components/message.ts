// message.ts — Message renderer. Chat area runs on BG.BLACK.
// All message lines painted with onChat() to maintain the dark surface.

import type { Message, TranscriptDensity, ToolCall } from '../model.js';
import {
  fit, truncate, wrapPlain,
  sanitiseLine, visibleWidth,
} from '../terminal/text.js';
import { styled, BOLD, DIM, FG, BG, RESET } from '../terminal/ansi.js';
import { colourFor, spinAt, onChat } from '../theme.js';

// ── Timestamp ─────────────────────────────────────────────────────────────────
function ts(t: number): string {
  const d  = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return styled(`${hh}:${mm}:${ss}`, DIM, FG.BRIGHT_BLACK);
}

// ── Section header ────────────────────────────────────────────────────────────
function sectionHeader(
  label: string,
  colour: string,
  timestamp: number,
  width: number,
): string {
  const tsStr = ts(timestamp);
  const tsW   = 10;
  const arrow = styled('▸ ', DIM, FG.BRIGHT_BLACK);
  const lbl   = styled(label, BOLD, colour);
  const lblW  = visibleWidth('▸ ' + label + ' ');
  const ruleW = Math.max(1, width - lblW - tsW);
  const rule  = styled('─'.repeat(ruleW), DIM, FG.BRIGHT_BLACK);
  return onChat(fit(arrow + lbl + ' ' + rule + ' ' + tsStr, width));
}

// ── User ──────────────────────────────────────────────────────────────────────
export function renderUserMsg(msg: Message, width: number): string[] {
  const header = sectionHeader('you', FG.BRIGHT_YELLOW, msg.timestamp, width);
  const indent = '  ';
  const iw     = Math.max(0, width - indent.length);
  const body   = wrapPlain(msg.content, iw).map(l =>
    onChat(fit(indent + styled(sanitiseLine(l, iw), FG.BRIGHT_YELLOW), width)),
  );
  return [header, ...body, onChat(fit('', width))];
}

// ── Agent ─────────────────────────────────────────────────────────────────────
function toolStatus(tool: ToolCall, spinFrame: number): { mark: string; colour: string; label: string } {
  if (tool.status === 'running') return { mark: spinAt(spinFrame), colour: FG.YELLOW, label: 'running' };
  if (tool.status === 'failed') return { mark: '✖', colour: FG.RED, label: 'failed' };
  if (tool.status === 'done') return { mark: '✓', colour: FG.GREEN, label: 'done' };
  return { mark: '○', colour: FG.BRIGHT_BLACK, label: 'pending' };
}

function renderToolCard(tool: ToolCall, width: number, spinFrame: number, density: TranscriptDensity): string[] {
  if (density === 'hidden') return [];
  const state = toolStatus(tool, spinFrame);
  const header = onChat(fit('  ' + styled(state.mark + '  Tool / ' + tool.name, BOLD, state.colour), width));
  const raw = tool.result ?? tool.args ?? '';
  const lines = raw.split(/\r?\n/).map(sanitiseLine).filter(Boolean);
  const limit = density === 'expanded' ? 16 : 8;
  const shown = lines.length > limit ? [...lines.slice(0, Math.ceil(limit / 2)), '… ' + String(lines.length - limit) + ' lines omitted …', ...lines.slice(-Math.floor(limit / 2))] : lines;
  const body = shown.map(line => onChat(fit('    ' + styled(line, DIM, FG.WHITE), width)));
  const footer = onChat(fit('    ' + styled(state.label + (tool.lines ? ' · ' + tool.lines + ' lines' : ''), DIM, FG.BRIGHT_BLACK), width));
  return [header, ...body, footer];
}

export function renderAgentMsg(msg: Message, width: number, spinFrame: number, density: TranscriptDensity = 'normal'): string[] {
  const agentId = msg.agentId ?? 'agent';
  const colour = colourFor(agentId);
  const label = msg.callsign ? msg.callsign + ' · ' + agentId : agentId;
  const lines: string[] = [sectionHeader(label, colour, msg.timestamp, width)];
  if (msg.content.trim()) {
    const iw = Math.max(0, width - 2);
    for (const l of wrapPlain(msg.content, iw)) {
      if (/\[.*\]\(http/.test(l)) continue;
      lines.push(onChat(fit('  ' + styled(sanitiseLine(l, iw), FG.WHITE), width)));
    }
  }
  for (const tool of msg.tools) lines.push(...renderToolCard(tool, width, spinFrame, density));
  if (msg.streaming) lines.push(onChat(fit('  ' + styled(spinAt(spinFrame), colour) + ' ' + styled('streaming…', DIM, FG.BRIGHT_BLACK), width)));
  lines.push(onChat(fit('', width)));
  return lines;
}

// ── System ────────────────────────────────────────────────────────────────────
export function renderSystemMsg(msg: Message, width: number): string[] {
  const content = sanitiseLine(msg.content, width - 8);
  return [
    onChat(fit(
      '  ' + styled('sys', DIM, FG.BRIGHT_BLACK)
      + '  ' + styled(content, DIM, FG.WHITE),
      width,
    )),
    onChat(fit('', width)),
  ];
}

// ── Error ─────────────────────────────────────────────────────────────────────
export function renderErrorMsg(msg: Message, width: number): string[] {
  const indent = '  ';
  const iw     = Math.max(0, width - indent.length - 4);
  const label  = styled('✖ ', BOLD, FG.RED);
  const body   = wrapPlain(msg.content, iw);
  const lines  = body.map((l, i) =>
    onChat(fit(
      indent + (i === 0 ? label : '  ') + styled(sanitiseLine(l, iw), FG.RED),
      width,
    )),
  );
  return [...lines, onChat(fit('', width))];
}

// ── Arbiter ───────────────────────────────────────────────────────────────────
export function renderArbiterMsg(msg: Message, width: number): string[] {
  const content = sanitiseLine(msg.content, width - 12);
  return [
    onChat(fit(
      '  ' + styled('⊕', FG.MAGENTA)
      + styled('  arbiter  ', DIM, FG.BRIGHT_BLACK)
      + styled(content, FG.MAGENTA),
      width,
    )),
    onChat(fit('', width)),
  ];
}

// ── Run summary ───────────────────────────────────────────────────────────────
export function renderRunSummary(msg: Message, width: number): string[] {
  interface Summary {
    strategy: string; agentUsed: string; durationMs: number;
    fileCount: number; validated: boolean; errors: string[];
  }
  let s: Summary = {
    strategy: '?', agentUsed: '?', durationMs: 0,
    fileCount: 0, validated: false, errors: [],
  };
  try { s = JSON.parse(msg.content) as Summary; } catch { /* ok */ }

  const header     = sectionHeader('run complete', FG.CYAN, msg.timestamp, width);
  const resultMark = s.validated
    ? styled('✔  validated', BOLD, FG.GREEN)
    : styled('✖  failed',    BOLD, FG.RED);

  const kv = (k: string, v: string) =>
    onChat(fit(
      '  ' + styled(k.padEnd(11), DIM, FG.BRIGHT_BLACK) + v,
      width,
    ));

  const rows = [
    kv('strategy',  styled(s.strategy,                              FG.CYAN)),
    kv('agent',     styled(s.agentUsed ?? '—',                     FG.BRIGHT_WHITE)),
    kv('duration',  styled(`${(s.durationMs / 1000).toFixed(1)}s`, FG.BRIGHT_WHITE)),
    kv('files',     styled(String(s.fileCount),                     FG.BRIGHT_WHITE)),
    kv('result',    resultMark),
  ];

  if (s.errors.length > 0) {
    rows.push(kv('errors', styled(String(s.errors.length), FG.RED)));
    for (const e of s.errors.slice(0, 3)) {
      rows.push(onChat(fit('    ' + styled(e.slice(0, width - 6), FG.RED), width)));
    }
  }

  return [header, ...rows, onChat(fit('', width))];
}

// ── Dispatcher ────────────────────────────────────────────────────────────────
export function renderMessage(
  msg: Message,
  width: number,
  spinFrame: number,
  density: TranscriptDensity = 'normal',
): string[] {
  switch (msg.type) {
    case 'user':        return renderUserMsg(msg, width);
    case 'agent':       return renderAgentMsg(msg, width, spinFrame, density);
    case 'system':      return renderSystemMsg(msg, width);
    case 'error':       return renderErrorMsg(msg, width);
    case 'arbiter':     return renderArbiterMsg(msg, width);
    case 'run_summary': return renderRunSummary(msg, width);
    default:            return [];
  }
}

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
function toolKind(name: string): { icon: string; label: string } {
  const n = name.toLowerCase();
  if (n.includes('terminal') || n.includes('bash') || n.includes('shell') || n.includes('exec')) return { icon: '⏱', label: 'terminal' };
  if (n.includes('diff') || n.includes('edit') || n.includes('write')) return { icon: '±', label: 'diff' };
  if (n.includes('search') || n.includes('grep') || n.includes('glob')) return { icon: '⌕', label: 'search' };
  if (n.includes('web') || n.includes('fetch') || n.includes('browser')) return { icon: '◌', label: 'web' };
  if (n.includes('read') || n.includes('file') || n.includes('cat')) return { icon: '▤', label: 'read' };
  return { icon: '·', label: 'tool' };
}

function toolStatus(tool: ToolCall, spinFrame: number): { mark: string; colour: string; label: string } {
  if (tool.status === 'running') return { mark: spinAt(spinFrame), colour: FG.YELLOW, label: 'running' };
  if (tool.status === 'failed') return { mark: '✖', colour: FG.RED, label: 'failed' };
  if (tool.status === 'done') return { mark: '✓', colour: FG.GREEN, label: 'done' };
  return { mark: '○', colour: FG.BRIGHT_BLACK, label: 'pending' };
}

function boxLine(prefix: string, body: string, suffix: string, width: number): string {
  const inner = Math.max(8, width - 4);
  return onChat(fit(prefix + ' ' + truncate(body, inner) + suffix, width));
}

function renderToolCard(tool: ToolCall, width: number, spinFrame: number, density: TranscriptDensity): string[] {
  if (density === 'hidden') return [];
  const state = toolStatus(tool, spinFrame);
  const kind = toolKind(tool.name);
  const inner = Math.max(8, width - 4);
  const title = kind.label === 'terminal' ? (tool.args || tool.name) : tool.name;
  const titleLine = '  ┌─ ' + styled(state.mark + ' ' + kind.icon + ' ' + truncate(title, inner - 10), BOLD, state.colour) + ' '.repeat(Math.max(0, inner - visibleWidth(title) - 8)) + '┐';
  const bodyRaw = tool.result ?? tool.args ?? '';
  const bodyLines = bodyRaw.split(/\r?\n/).map(sanitiseLine).filter(Boolean);
  const limit = density === 'expanded' ? 14 : 6;
  const shown = bodyLines.length > limit
    ? [...bodyLines.slice(0, Math.ceil(limit / 2)), '… +' + String(bodyLines.length - limit) + ' lines', ...bodyLines.slice(-Math.floor(limit / 2))]
    : bodyLines;
  const body = shown.map(line => boxLine('  │', styled(truncate(line, inner - 2), DIM, FG.WHITE), ' │', width));
  if (body.length === 0 && kind.label === 'terminal' && tool.args) body.push(boxLine('  │', styled('$ ' + tool.args, DIM, FG.WHITE), ' │', width));
  const footerText = state.label + (tool.lines ? ' · ' + tool.lines + ' lines' : '');
  return [
    titleLine,
    ...body,
    boxLine('  └─', styled(footerText, DIM, state.colour), ' ─', width),
  ];
}

function renderCollapsedReadOnly(tools: ToolCall[], width: number): string[] {
  const count = tools.length;
  const names = tools.slice(0, 3).map(t => toolKind(t.name).label).join(', ');
  const more = count > 3 ? ' +' + String(count - 3) : '';
  return [onChat(fit('  ' + styled('↳ ', DIM, FG.BRIGHT_BLACK) + styled(String(count) + ' read-only calls', BOLD, FG.WHITE) + styled('  ' + names + more + ' · Ctrl+O to expand', DIM, FG.BRIGHT_BLACK), width))];
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
  if (density !== 'hidden') {
    let i = 0;
    while (i < msg.tools.length) {
      const tool = msg.tools[i]!;
      const readOnly = ['read','search','web'].includes(toolKind(tool.name).label);
      if (density === 'normal' && readOnly) {
        const group: ToolCall[] = [];
        while (i < msg.tools.length && ['read','search','web'].includes(toolKind(msg.tools[i]!.name).label)) group.push(msg.tools[i++]!);
        if (group.length >= 2) lines.push(...renderCollapsedReadOnly(group, width));
        else lines.push(...renderToolCard(group[0]!, width, spinFrame, density));
      } else {
        lines.push(...renderToolCard(tool, width, spinFrame, density));
        i++;
      }
    }
  }
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

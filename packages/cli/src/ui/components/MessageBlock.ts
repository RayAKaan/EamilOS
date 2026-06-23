/**
 * EamilOS TUI — Message box renderers
 * Flat layout, no borders, pure Blessed.
 */
import blessed from 'blessed';
import type { Message, ToolCall } from '../types/ui.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function clamp(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max - 1) + '>';
}

function wrapLines(text: string, width: number): string[] {
  if (width < 2) return [text.slice(0, 2)];
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    if (raw.length === 0) { lines.push(''); continue; }
    let remaining = raw;
    while (remaining.length > width) {
      lines.push(remaining.slice(0, width));
      remaining = remaining.slice(width);
    }
    lines.push(remaining);
  }
  return lines;
}

// ─── Height per message (must match renderer exactly) ──────────────────────

export function messageHeight(msg: Message, termWidth: number): number {
  const contentW = Math.max(termWidth - 4, 10);
  switch (msg.type) {
    case 'user':
      return 1 + wrapLines(msg.content, contentW).length + 1;
    case 'opencode':
    case 'gemini': {
      const cLines = msg.content ? wrapLines(msg.content, contentW).length : 0;
      return 1 + cLines + (msg.tools?.length ?? 0) + (msg.isStreaming ? 1 : 0) + 1;
    }
    case 'system':
    case 'error':
      return 1 + wrapLines(msg.content, contentW).length + 1;
    case 'graph-stats':
      return 10;
    default:
      return 3;
  }
}

// ─── Theme colors ──────────────────────────────────────────────────────────

const HDR: Record<string, blessed.Widgets.Color> = {
  user:       'green',
  opencode:   'cyan',
  gemini:     'magenta',
  system:     'yellow',
  error:      'red',
  'graph-stats': 'blue',
};

const HDR_LABEL: Record<string, string> = {
  user:       'YOU',
  opencode:   'OPENCODE',
  gemini:     'GEMINI',
  system:     'SYS',
  error:      'ERROR',
  'graph-stats': 'SUMMARY',
};

// ─── Renderers ─────────────────────────────────────────────────────────────

type Parent = blessed.Widgets.BoxElement;

function addText(
  parent: blessed.Widgets.Node,
  top: number,
  left: number,
  content: string,
  fg: blessed.Widgets.Color,
  bold = false,
): void {
  blessed.text({ parent, top, left, content, style: { fg, bold } });
}

function addHdr(
  parent: Parent,
  top: number,
  label: string,
  time: string,
  color: blessed.Widgets.Color,
  termWidth: number,
): void {
  const avail = Math.max(termWidth - 6 - label.length - time.length, 4);
  const ruler = '\u2500'.repeat(avail);
  addText(parent, top, 1, ` ${label}  ${ruler}  ${time}`, color, true);
}

function addSep(parent: Parent, top: number, termWidth: number): void {
  addText(parent, top, 0, ''.padEnd(termWidth, '\u2500'), 'gray');
}

// ── User ──────────────────────────────────────────────────────────────────

function renderUser(
  parent: Parent,
  msg: Message,
  termWidth: number,
  top: number,
): void {
  const cw = Math.max(termWidth - 4, 10);
  const lines = wrapLines(msg.content, cw);
  const h = 1 + lines.length + 1;

  addHdr(parent, top, 'YOU', formatTime(msg.timestamp), 'green', termWidth);
  for (let i = 0; i < lines.length; i++) {
    addText(parent, top + 1 + i, 2, lines[i] ?? '', 'white');
  }
  addSep(parent, top + h - 1, termWidth);
}

// ── Agent ─────────────────────────────────────────────────────────────────

function renderAgent(
  parent: Parent,
  msg: Message,
  termWidth: number,
  top: number,
): void {
  const isOC = msg.type === 'opencode';
  const color = isOC ? 'cyan' as const : 'magenta' as const;
  const label = isOC ? 'OPENCODE' : 'GEMINI';
  const cw = Math.max(termWidth - 4, 10);
  const cLines = msg.content ? wrapLines(msg.content, cw) : [];
  const tools = msg.tools ?? [];
  const stream = msg.isStreaming ? 1 : 0;
  const h = 1 + cLines.length + tools.length + stream + 1;

  addHdr(parent, top, label, formatTime(msg.timestamp), color, termWidth);

  let y = top + 1;
  for (const line of cLines) {
    addText(parent, y++, 2, line, 'white');
  }

  for (const tool of tools) {
    const icon = tool.status === 'done' ? '[+]'
      : tool.status === 'failed' ? '[-]'
      : tool.status === 'running' ? '[~]' : '[ ]';
    const fg = tool.status === 'done' ? 'green' as const
      : tool.status === 'failed' ? 'red' as const
      : tool.status === 'running' ? 'yellow' as const : 'gray' as const;
    const name = tool.name.padEnd(8).slice(0, 8);
    const args = clamp(tool.args, Math.max(cw - 20, 20));
    const suffix = tool.lines != null ? `  (${tool.lines} lines)` : '';

    addText(parent, y, 2, icon, fg, true);
    addText(parent, y, 6, name, 'white');
    addText(parent, y, 15, args + suffix, 'gray');
    y++;
  }

  if (msg.isStreaming) {
    addText(parent, y, 2, `[......] ${isOC ? 'opencode' : 'gemini'} working...`, color);
  }

  addSep(parent, top + h - 1, termWidth);
}

// ── System / error ─────────────────────────────────────────────────────────

function renderSystem(
  parent: Parent,
  msg: Message,
  termWidth: number,
  top: number,
): void {
  const isErr = msg.type === 'error';
  const color = isErr ? 'red' as const : 'yellow' as const;
  const label = isErr ? 'ERROR' : 'SYS';
  const cw = Math.max(termWidth - 4, 10);
  const lines = wrapLines(msg.content, cw);
  const h = 1 + lines.length + 1;

  addHdr(parent, top, label, formatTime(msg.timestamp), color, termWidth);
  for (let i = 0; i < lines.length; i++) {
    addText(parent, top + 1 + i, 2, lines[i] ?? '', isErr ? 'red' : 'white');
  }
  addSep(parent, top + h - 1, termWidth);
}

// ── Graph stats ───────────────────────────────────────────────────────────

interface StatsPayload {
  strategy: string; duration: string; toolsUsed: number;
  nodes: number; edges: number; validated: boolean;
}

function renderGraphStats(
  parent: Parent,
  msg: Message,
  termWidth: number,
  top: number,
): void {
  let stats: StatsPayload = { strategy: '?', duration: '?', toolsUsed: 0, nodes: 0, edges: 0, validated: false };
  try { stats = JSON.parse(msg.content); } catch { /* defaults */ }

  const h = 10;
  addHdr(parent, top, 'SUMMARY', formatTime(msg.timestamp), 'blue', termWidth);

  const rows: Array<[string, string, blessed.Widgets.Color]> = [
    ['  Strategy   :', stats.strategy,             'white'],
    ['  Duration   :', stats.duration,              'white'],
    ['  Tools used :', String(stats.toolsUsed),     'white'],
    ['  Graph nodes:', String(stats.nodes),         'cyan'],
    ['  Graph edges:', String(stats.edges),         'cyan'],
    ['  Result     :', stats.validated ? 'VALIDATED' : 'NOT VALIDATED', stats.validated ? 'green' : 'red'],
  ];

  rows.forEach(([label, value, fg], i) => {
    addText(parent, top + 1 + i, 1, label, 'gray');
    addText(parent, top + 1 + i, 17, value, fg, i === 5);
  });

  addSep(parent, top + h - 1, termWidth);
}

// ─── Main export ──────────────────────────────────────────────────────────

export function renderMessageBox(
  parent: Parent,
  msg: Message,
  termWidth: number,
  yOffset: number,
): void {
  switch (msg.type) {
    case 'user':        return renderUser(parent, msg, termWidth, yOffset);
    case 'opencode':
    case 'gemini':      return renderAgent(parent, msg, termWidth, yOffset);
    case 'system':
    case 'error':       return renderSystem(parent, msg, termWidth, yOffset);
    case 'graph-stats': return renderGraphStats(parent, msg, termWidth, yOffset);
  }
}

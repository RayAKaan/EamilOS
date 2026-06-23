/**
 * Pure text renderer.
 * Every "row" is a plain string that gets written to a blessed text element
 * in a single full-screen box.  No nested boxes, no borders anywhere.
 */

import type { Message, ToolCall, AgentInfo, GraphStats, ExecutionStrategy } from './types/ui.js';

// ─── Palette (xterm-256 / basic names that blessed understands) ────────────

export const C = {
  reset:    '{/}',
  // agent colours
  cyan:     '{cyan-fg}',
  mag:      '{magenta-fg}',
  // ui chrome
  green:    '{green-fg}',
  yellow:   '{yellow-fg}',
  blue:     '{#5f87ff-fg}',
  red:      '{red-fg}',
  // neutral
  white:    '{white-fg}',
  gray:     '{#606060-fg}',
  dimgray:  '{#404040-fg}',
  // bold helpers
  bold:     '{bold}',
  boldEnd:  '{/bold}',
} as const;

function c(color: string, text: string): string {
  return `{${color}-fg}${text}{/}`;
}
function bold(text: string): string { return `{bold}${text}{/bold}`; }
function dim(text:  string): string { return c('240', text); }

// ─── Time ──────────────────────────────────────────────────────────────────

function ts(timestamp: number): string {
  const d  = new Date(timestamp);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return dim(`${hh}:${mm}`);
}

// ─── Layout helpers ────────────────────────────────────────────────────────

/** Repeat a character n times */
export function rep(ch: string, n: number): string {
  return n > 0 ? ch.repeat(n) : '';
}

/** Strip all {tag} sequences to measure visible length */
function visLen(s: string): number {
  return s.replace(/\{[^}]*\}/g, '').length;
}

/** Right-align `right` so total visible width = w, given `left` is already placed */
function rightAlign(left: string, right: string, w: number): string {
  const gap = w - visLen(left) - visLen(right);
  return left + rep(' ', Math.max(gap, 1)) + right;
}

/** Wrap plain text to width, return array of lines */
function wrap(text: string, w: number): string[] {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    if (raw.length === 0) { out.push(''); continue; }
    let s = raw;
    while (s.length > w) { out.push(s.slice(0, w)); s = s.slice(w); }
    out.push(s);
  }
  return out;
}

// ─── Message → lines ──────────────────────────────────────────────────────

const TOOL_ICON: Record<string, string> = {
  pending: dim('[ ]'),
  running: c('yellow', '[~]'),
  done:    c('green',  '[+]'),
  failed:  c('red',    '[-]'),
};

function renderTool(tool: ToolCall, indent: number, w: number): string[] {
  const icon    = TOOL_ICON[tool.status] ?? dim('[ ]');
  const name    = c('white', tool.name.slice(0, 10).padEnd(10));
  const suffix  = tool.lines != null ? dim(` (${tool.lines}L)`) : '';
  const maxArgs = w - indent - 16 - (tool.lines != null ? 8 : 0);
  const args    = dim(tool.args.slice(0, Math.max(maxArgs, 10)));
  return [rep(' ', indent) + icon + ' ' + name + ' ' + args + suffix];
}

// ── user ───────────────────────────────────────────────────────────────────

export function renderUser(msg: Message, w: number): string[] {
  const ruler = dim(rep('\u2500', Math.max(w - 12, 4)));
  const header = rightAlign(bold(c('green', 'you')) + '  ' + ruler, ts(msg.timestamp), w);
  const lines  = wrap(msg.content, w - 4);
  return [
    header,
    ...lines.map((l) => '    ' + c('white', l)),
    '',
  ];
}

// ── agent ──────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ['|', '/', '-', '\\'];
let spinIdx = 0;
export function tickSpinner(): void { spinIdx = (spinIdx + 1) % 4; }
export function spinnerChar(): string { return SPINNER_FRAMES[spinIdx] ?? '|'; }

export function renderAgent(msg: Message, w: number, frame: number): string[] {
  const isOC   = msg.agent === 'opencode' || msg.type === 'opencode';
  const color  = isOC ? 'cyan' : 'magenta';
  const label  = isOC ? 'opencode' : 'gemini';
  const ruler  = dim(rep('\u2500', Math.max(w - label.length - 10, 4)));
  const header = rightAlign(bold(c(color, label)) + '  ' + ruler, ts(msg.timestamp), w);

  const out: string[] = [header];

  if (msg.content.trim()) {
    const lines = wrap(msg.content, w - 4);
    out.push(...lines.map((l) => '    ' + c('white', l)));
  }

  for (const tool of msg.tools ?? []) {
    out.push(...renderTool(tool, 4, w));
  }

  if (msg.isStreaming) {
    const sp = SPINNER_FRAMES[frame % 4] ?? '|';
    out.push('    ' + dim(sp + ' ' + sp + ' ' + sp) + '  ' + dim(label + ' working...'));
  }

  out.push('');
  return out;
}

// ── system / error ─────────────────────────────────────────────────────────

export function renderSystem(msg: Message, w: number): string[] {
  const isErr  = msg.type === 'error';
  const color  = isErr ? 'red' : 'yellow';
  const label  = isErr ? 'err' : 'sys';
  const ruler  = dim(rep('\u2500', Math.max(w - label.length - 10, 4)));
  const header = rightAlign(bold(c(color, label)) + '  ' + ruler, ts(msg.timestamp), w);

  const lines  = wrap(msg.content, w - 4);
  return [
    header,
    ...lines.map((l) => '    ' + (isErr ? c('red', l) : dim(l))),
    '',
  ];
}

// ── graph stats ─────────────────────────────────────────────────────────────

interface StatPayload {
  strategy: string; duration: string; toolsUsed: number;
  nodes: number; edges: number; validated: boolean;
}

export function renderGraphStats(msg: Message, w: number): string[] {
  let p: StatPayload = { strategy: '?', duration: '?', toolsUsed: 0, nodes: 0, edges: 0, validated: false };
  try { p = JSON.parse(msg.content) as StatPayload; } catch { /* ok */ }

  const ruler  = dim(rep('\u2500', Math.max(w - 12, 4)));
  const header = bold(c('blue', 'summary')) + '  ' + ruler;

  const row = (label: string, value: string, vc: string) =>
    '    ' + dim(label.padEnd(14)) + c(vc, value);

  return [
    header,
    row('strategy',    p.strategy,                    'white'),
    row('duration',    p.duration,                    'white'),
    row('tools used',  String(p.toolsUsed),           'white'),
    row('graph nodes', String(p.nodes),               'cyan'),
    row('graph edges', String(p.edges),               'cyan'),
    row('result',      p.validated ? 'validated' : 'not validated',
                       p.validated ? 'green' : 'red'),
    '',
  ];
}

// ── welcome ─────────────────────────────────────────────────────────────────

export function renderWelcome(w: number, h: number): string[] {
  const lines: string[] = [];
  const padTop = Math.max(Math.floor(h / 2) - 8, 0);

  for (let i = 0; i < padTop; i++) lines.push('');

  const centre = (s: string) => {
    const vl = visLen(s);
    const pad = Math.max(Math.floor((w - vl) / 2), 0);
    return rep(' ', pad) + s;
  };

  lines.push(centre(bold(c('cyan', 'EamilOS'))));
  lines.push(centre(dim('multi-agent AI orchestrator')));
  lines.push('');
  lines.push(centre(dim(rep('\u2500', Math.min(w - 4, 50)))));
  lines.push('');
  lines.push(centre(c('cyan',    'opencode') + dim('  +  ') + c('magenta', 'gemini cli')));
  lines.push('');
  lines.push(centre(dim('strategies')));
  lines.push('');
  lines.push(centre(c('cyan', '[1]') + dim(' opencode-first   ') + c('cyan', '[2]') + dim(' gemini-first')));
  lines.push(centre(c('cyan', '[3]') + dim(' parallel         ') + c('cyan', '[4]') + dim(' swarm')));
  lines.push('');
  lines.push(centre(dim('type a task and press enter')));

  return lines;
}

// ── status bar (single line) ────────────────────────────────────────────────

function agentTag(info: AgentInfo, name: string, color: string): string {
  const dot = info.status === 'offline' ? dim('[-]')
            : info.status === 'busy'    ? c('yellow', '[~]')
            : c('green', '[+]');
  const ver = info.version ? dim(' ' + info.version) : '';
  return dot + ' ' + c(color, name) + ver;
}

export function renderStatusBar(
  w: number,
  oc: AgentInfo, gem: AgentInfo,
  strategy: ExecutionStrategy,
  graphStats: GraphStats,
  isRunning: boolean,
  version: string,
): string {
  const left = bold(c('cyan', 'EamilOS')) + '  ' + dim(version)
    + '  ' + dim(rep('\u2502', 1)) + '  '
    + (isRunning ? c('yellow', 'running') : c('green', 'ready'));

  const centre = agentTag(oc, 'opencode', 'cyan')
    + '   ' + agentTag(gem, 'gemini', 'magenta');

  const right = dim('strategy:') + c('cyan', strategy)
    + '  ' + dim('nodes:') + c('white', String(graphStats.nodes))
    + '  ' + dim('edges:') + c('white', String(graphStats.edges));

  // Place left, centre (roughly), right
  const leftLen   = visLen(left);
  const centreLen = visLen(centre);
  const rightLen  = visLen(right);
  const mid       = Math.max(Math.floor((w - centreLen) / 2) - leftLen, 2);
  const after     = Math.max(w - leftLen - mid - centreLen - rightLen, 2);

  return left + rep(' ', mid) + centre + rep(' ', after) + right;
}

// ── strategy bar (single line) ──────────────────────────────────────────────

const STRATS: ExecutionStrategy[] = ['opencode-first', 'gemini-first', 'parallel', 'swarm'];

export function renderStrategyBar(current: ExecutionStrategy): string {
  const parts = STRATS.map((s, i) => {
    const tag = `[${i + 1}] ${s}`;
    return s === current ? bold(c('cyan', tag)) : dim(tag);
  });
  return dim('strategy  ') + parts.join(dim('   '));
}

// ── hint bar ────────────────────────────────────────────────────────────────

export function renderHintBar(): string {
  const sep = dim('  |  ');
  return [
    dim('up') + ' repeat',
    dim('1-4') + ' strategy',
    dim('ctrl+g') + ' graph',
    dim('ctrl+l') + ' clear',
    dim('ctrl+c') + ' exit',
  ].join(sep);
}

// ── graph panel (single line) ────────────────────────────────────────────────

export function renderGraphLine(stats: GraphStats): string {
  const parts: string[] = [
    bold(c('blue', 'graphify')),
    dim('nodes:')    + c('cyan',  String(stats.nodes)),
    dim('edges:')    + c('cyan',  String(stats.edges)),
    dim('strategy:') + c('white', stats.strategy),
  ];
  if (stats.toolsUsed != null)
    parts.push(dim('tools:') + c('white', String(stats.toolsUsed)));
  if (stats.duration != null)
    parts.push(dim('duration:') + c('white', (stats.duration / 1000).toFixed(1) + 's'));
  return parts.join(dim('   |   '));
}

// ── message dispatcher ───────────────────────────────────────────────────────

export function messageToLines(msg: Message, w: number, spinFrame: number): string[] {
  switch (msg.type) {
    case 'user':        return renderUser(msg, w);
    case 'opencode':
    case 'gemini':      return renderAgent(msg, w, spinFrame);
    case 'system':
    case 'error':       return renderSystem(msg, w);
    case 'graph-stats': return renderGraphStats(msg, w);
    default:            return [];
  }
}

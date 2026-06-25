/**
 * EamilOS TUI — render.ts
 *
 * Design language:
 *   Surgical. Dense but breathable. Every pixel earns its place.
 *   Inspired by tools that professionals pay for because they respect their time.
 *   Not a chat app wearing a terminal costume — a real orchestration surface.
 *
 * Colour logic:
 *   One warm accent (amber) for the user's own input.
 *   One cool accent (teal) for the EamilOS kernel / system chrome.
 *   Violet for agent output — distinct from both, never confused.
 *   Everything else lives in a four-stop gray ramp.
 *   No RGB rainbows. No green "success" banners. Status via shape, not colour.
 */

import type {
  Message,
  ToolCall,
  AgentInfo,
  GraphStats,
  ExecutionStrategy,
} from './types/ui.js';

// ─── Colour palette ────────────────────────────────────────────────────────

const K = {
  // Kernel / chrome
  teal:    '#00c8a0',   // EamilOS brand — teal-green
  tealDim: '#006e58',   // dimmed teal for rules

  // Agent voices
  ocBlue:  '#38bdf8',   // opencode — sky blue
  gemVio:  '#a78bfa',   // gemini   — violet

  // User input
  amber:   '#fbbf24',   // user prompt — warm amber
  amberDim:'#78530a',

  // Semantic
  ok:      '#34d399',   // subtle mint — validation pass
  warn:    '#fb923c',   // orange — warning / running
  err:     '#f87171',   // soft red — error

  // Neutral ramp
  g0:      'white',     // primary content
  g1:      '#d4d4d4',   // secondary
  g2:      '#737373',   // tertiary / labels
  g3:      '#404040',   // dividers / very dim
  g4:      '#262626',   // near-invisible chrome
} as const;

// ─── Helpers ───────────────────────────────────────────────────────────────

function fg(hex: string, text: string): string {
  return `{${hex}-fg}${text}{/}`;
}

function bold(t: string): string { return `{bold}${t}{/bold}`; }

export function rep(ch: string, n: number): string {
  const count = Math.max(0, Math.floor(n));
  return count > 0 ? ch.repeat(count) : '';
}

/** Visible length — strip all blessed {tag} sequences */
function vl(s: string): number {
  return s.replace(/\{[^}]*\}/g, '').length;
}

/** Pad string to visible width with trailing spaces */
function padTo(s: string, w: number): string {
  const gap = w - vl(s);
  return s + rep(' ', Math.max(gap, 0));
}

/** Place right-hand content flush to terminal edge */
function rightAlign(left: string, right: string, w: number): string {
  const gap = w - vl(left) - vl(right);
  return left + rep(' ', Math.max(gap, 1)) + right;
}

/** Wrap plain text at visible width w */
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

/** HH:MM:SS timestamp — dim */
function stamp(ts: number): string {
  const d  = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return fg(K.g3, `${hh}:${mm}:${ss}`);
}

// ─── Spinner ───────────────────────────────────────────────────────────────

// Braille-based — smoother than ASCII, unmistakably "computing"
const SPIN_FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
let _spinIdx = 0;
export function tickSpinner(): void { _spinIdx = (_spinIdx + 1) % SPIN_FRAMES.length; }
export function spinChar(frame?: number): string {
  const idx = frame !== undefined ? frame % SPIN_FRAMES.length : _spinIdx;
  return SPIN_FRAMES[idx] ?? '⠋';
}

// ─── Section header ────────────────────────────────────────────────────────
//
// ╸ LABEL ─────────────────────────────────────── HH:MM:SS ╺
//
// The heavy end-caps (╸╺) anchor the ruler visually.
// Label gets bold + its accent colour.
// Timestamp is dim-gray, flush right.

function sectionRule(
  label: string,
  accent: string,
  ts: number,
  w: number,
): string {
  const tsStr  = stamp(ts);
  const left   = fg(K.g3, '╸') + ' ' + bold(fg(accent, label)) + ' ';
  const right  = ' ' + tsStr + ' ' + fg(K.g3, '╺');
  const rLen   = Math.max(w - vl(left) - vl(right), 2);
  const rule   = fg(K.g3, rep('─', rLen));
  return left + rule + right;
}

// ─── Tool call rows ────────────────────────────────────────────────────────
//
//   ○  read_file      src/index.ts
//   ◐  write_file     src/auth.ts                        +142
//   ●  run_command    npm test                   (done)
//   ✗  lint           eslint failed

const TOOL_DOT: Record<string, string> = {
  pending: fg(K.g3,   '○'),
  running: fg(K.warn, '◐'),
  done:    fg(K.ok,   '●'),
  failed:  fg(K.err,  '✗'),
};

function renderTool(tool: ToolCall, w: number): string[] {
  const dot    = TOOL_DOT[tool.status] ?? fg(K.g3, '○');
  const name   = fg(K.g1, tool.name.padEnd(14).slice(0, 14));
  const argMax = Math.max(w - 22, 10);
  const args   = fg(K.g2, tool.args.slice(0, argMax));
  const lines  = tool.lines != null ? fg(K.g3, ` +${tool.lines}`) : '';
  const first  = `   ${dot}  ${name}  ${args}${lines}`;
  const out    = [first];
  if (tool.result && (tool.status === 'done' || tool.status === 'failed')) {
    const r = fg(tool.status === 'done' ? K.g2 : K.err, tool.result.slice(0, w - 10));
    out.push(`        ${fg(K.g3, '└─')} ${r}`);
  }
  return out;
}

// ─── User message ──────────────────────────────────────────────────────────

export function renderUser(msg: Message, w: number): string[] {
  const rule  = sectionRule('you', K.amber, msg.timestamp, w);
  const lines = wrap(msg.content, w - 4);
  return [
    rule,
    ...lines.map(l => `   ${fg(K.amber, l)}`),
    '',
  ];
}

// ─── Agent message ─────────────────────────────────────────────────────────

export function renderAgent(msg: Message, w: number, frame: number): string[] {
  const isOC    = msg.agent === 'opencode' || msg.type === 'opencode';
  const accent  = isOC ? K.ocBlue : K.gemVio;
  const label   = isOC ? 'opencode' : 'gemini';

  const rule = sectionRule(label, accent, msg.timestamp, w);
  const out: string[] = [rule];

  if (msg.content.trim()) {
    const lines = wrap(msg.content, w - 4);
    out.push(...lines.map(l => `   ${fg(K.g1, l)}`));
  }

  for (const tool of msg.tools ?? []) {
    out.push(...renderTool(tool, w));
  }

  if (msg.isStreaming) {
    const sp = spinChar(frame);
    out.push(`   ${fg(accent, sp)} ${fg(K.g2, 'processing...')}`);
  }

  out.push('');
  return out;
}

// ─── System / error message ────────────────────────────────────────────────

export function renderSystem(msg: Message, w: number): string[] {
  const isErr  = msg.type === 'error';
  const accent = isErr ? K.err : K.g2;
  const label  = isErr ? 'error' : 'sys';

  const rule  = sectionRule(label, accent, msg.timestamp, w);
  const lines = wrap(msg.content, w - 4);
  return [
    rule,
    ...lines.map(l => `   ${fg(isErr ? K.err : K.g2, l)}`),
    '',
  ];
}

// ─── Execution summary ─────────────────────────────────────────────────────
//
// Rendered as a compact receipt at the end of each run.
// Two-column when terminal >= 90 wide.

interface SummaryPayload {
  strategy:   string;
  duration:   string;
  toolsUsed:  number;
  nodes:      number;
  edges:      number;
  validated:  boolean;
  agentUsed?: string;
}

export function renderSummary(msg: Message, w: number): string[] {
  let p: SummaryPayload = {
    strategy: '?', duration: '?', toolsUsed: 0,
    nodes: 0, edges: 0, validated: false,
  };
  try { p = JSON.parse(msg.content) as SummaryPayload; } catch { /* ok */ }

  const rule = sectionRule('run complete', K.teal, msg.timestamp, w);

  const resultMark = p.validated
    ? bold(fg(K.ok,  '✓')) + fg(K.g1, ' validated')
    : bold(fg(K.err, '✗')) + fg(K.g1, ' not validated');

  const kv = (k: string, v: string) =>
    `   ${fg(K.g2, k.padEnd(12))}${v}`;

  const rows: string[] = [
    kv('strategy',   fg(K.g1, p.strategy)),
    kv('agent',      fg(K.g1, p.agentUsed ?? '—')),
    kv('duration',   fg(K.g1, p.duration)),
    kv('files',      fg(K.g1, String(p.toolsUsed))),
    kv('graph',      fg(K.g1, `${p.nodes} nodes`) + fg(K.g3, '  ·  ') + fg(K.g1, `${p.edges} edges`)),
    kv('result',     resultMark),
  ];

  // Two-column layout if wide enough
  if (w >= 90) {
    const packed: string[] = [];
    const half = Math.floor(w / 2);
    for (let i = 0; i < rows.length; i += 2) {
      const l = padTo(rows[i]!, half);
      const r = rows[i + 1] ?? '';
      packed.push(l + r);
    }
    return [rule, ...packed, ''];
  }

  return [rule, ...rows, ''];
}

// ─── Welcome screen ────────────────────────────────────────────────────────

export function renderWelcome(w: number, h: number): string[] {
  const lines: string[] = [];
  const padTop = Math.max(Math.floor(h / 2) - 11, 1);
  for (let i = 0; i < padTop; i++) lines.push('');

  const ctr = (s: string) => rep(' ', Math.max(Math.floor((w - vl(s)) / 2), 0)) + s;

  // Logo — the two accents side by side
  lines.push(ctr(
    bold(fg(K.teal, 'E')) +
    bold(fg(K.g0,   'amil')) +
    bold(fg(K.teal, 'OS'))
  ));
  lines.push(ctr(fg(K.g2, 'multi-agent AI execution kernel')));
  lines.push('');

  // Thin rule
  lines.push(ctr(fg(K.g4, rep('─', Math.min(w - 8, 56)))));
  lines.push('');

  // Agent roster
  lines.push(ctr(
    fg(K.ocBlue, '◆') + fg(K.g2, ' opencode') +
    fg(K.g3,     '   ╱   ') +
    fg(K.gemVio, '◆') + fg(K.g2, ' gemini cli')
  ));
  lines.push('');

  // Strategy legend
  lines.push(ctr(fg(K.g3, 'strategies')));
  lines.push('');
  lines.push(ctr(
    fg(K.g3,  '[1]') + fg(K.g2, ' opencode-first   ') +
    fg(K.g3,  '[2]') + fg(K.g2, ' gemini-first')
  ));
  lines.push(ctr(
    fg(K.g3,  '[3]') + fg(K.g2, ' parallel         ') +
    fg(K.g3,  '[4]') + fg(K.g2, ' swarm')
  ));
  lines.push('');
  lines.push(ctr(fg(K.g3, '─────────────────────────────')));
  lines.push('');
  lines.push(ctr(fg(K.g2, 'describe your goal and press ') + fg(K.g1, 'enter')));

  return lines;
}

// ─── Status bar — top chrome ───────────────────────────────────────────────
//
//  EamilOS v1.4  │  ◆ opencode kernel   ◆ gemini kernel  │  swarm  │  ● ready

function agentBadge(info: AgentInfo, name: string, accent: string): string {
  const dot = info.status === 'offline' ? fg(K.g3,   '◇')
            : info.status === 'busy'    ? fg(K.warn,  '◈')
            :                            fg(accent,   '◆');
  const ver = info.version
    ? fg(K.g3, ' ' + info.version.slice(0, 8))
    : '';
  return dot + ' ' + fg(accent, name) + ver;
}

export function renderStatusBar(
  w:          number,
  oc:         AgentInfo,
  gem:        AgentInfo,
  strategy:   ExecutionStrategy,
  graphStats: GraphStats,
  isRunning:  boolean,
  version:    string,
): string {
  const sep  = fg(K.g4, '  │  ');

  const mark = bold(fg(K.teal, 'EamilOS')) + fg(K.g3, ` v${version}`);
  const agents = agentBadge(oc, 'opencode', K.ocBlue) +
                 fg(K.g4, '   ') +
                 agentBadge(gem, 'gemini', K.gemVio);
  const strat  = fg(K.g3, 'mode:') + fg(K.teal, strategy);
  const state  = isRunning
    ? fg(K.warn, spinChar()) + fg(K.warn, ' running')
    : fg(K.ok,   '●') + fg(K.g2, ' ready');
  const graph  = graphStats.nodes > 0
    ? sep + fg(K.g3, 'g:') + fg(K.g2, `${graphStats.nodes}n ${graphStats.edges}e`)
    : '';

  const left  = ' ' + mark + sep + agents;
  const right  = strat + sep + state + graph + ' ';
  const gap    = w - vl(left) - vl(right);
  return left + rep(' ', Math.max(gap, 2)) + right;
}

// ─── Graph panel — multi-line ──────────────────────────────────────────────

export function renderGraphPanel(stats: GraphStats, w: number): string[] {
  const header = fg(K.g3, '╸') + ' ' + bold(fg(K.teal, 'graph')) + ' ' +
    fg(K.g3, rep('─', Math.max(w - 12, 2))) + fg(K.g3, '╺');

  const kv = (k: string, v: string) =>
    `   ${fg(K.g2, k.padEnd(11))}${fg(K.g1, v)}`;

  const rows = [
    kv('nodes',    String(stats.nodes)),
    kv('edges',    String(stats.edges)),
    kv('strategy', stats.strategy),
  ];
  if (stats.toolsUsed != null) rows.push(kv('files',   String(stats.toolsUsed)));
  if (stats.duration   != null) rows.push(kv('time',    (stats.duration / 1000).toFixed(2) + 's'));
  if (stats.validated  != null) rows.push(kv('result',
    stats.validated ? fg(K.ok, '✓ validated') : fg(K.err, '✗ not validated')
  ));

  return [header, ...rows];
}

// For backwards compat with the single-line graph in old index.ts
export function renderGraphLine(stats: GraphStats): string {
  return renderGraphPanel(stats, 80).join('  ');
}

// ─── Strategy bar — bottom chrome ─────────────────────────────────────────

const ALL_STRATS: ExecutionStrategy[] = [
  'opencode-first', 'gemini-first', 'parallel', 'swarm',
];

export function renderStrategyBar(current: ExecutionStrategy): string {
  return ALL_STRATS.map((s, i) => {
    const key   = fg(K.g3, `[${i + 1}]`);
    const label = s === current
      ? bold(fg(K.teal, s))
      : fg(K.g2, s);
    return key + ' ' + label;
  }).join(fg(K.g3, '   '));
}

// ─── Running state bar ─────────────────────────────────────────────────────

export function renderRunningBar(frame: number): string {
  const sp = spinChar(frame);
  return (
    ' ' + fg(K.warn, sp) + '  ' +
    fg(K.g2, 'agents working') +
    fg(K.g3, '   ·   ') +
    fg(K.g3, 'ctrl+c') + fg(K.g3, ' to cancel')
  );
}

// ─── Hint bar ─────────────────────────────────────────────────────────────

export function renderHintBar(): string {
  const key = (k: string, v: string) => fg(K.g3, k) + fg(K.g4, ':') + fg(K.g3, v);
  const dot = fg(K.g4, '  ·  ');
  return (
    ' ' + [
      key('↑',       'recall'),
      key('1–4',     'strategy'),
      key('ctrl+g',  'graph'),
      key('ctrl+l',  'clear'),
      key('ctrl+c',  'exit'),
      key('pg↑↓',   'scroll'),
    ].join(dot)
  );
}

// ─── Message dispatcher ────────────────────────────────────────────────────

export function messageToLines(msg: Message, w: number, spinFrame: number): string[] {
  switch (msg.type) {
    case 'user':        return renderUser(msg, w);
    case 'opencode':
    case 'gemini':      return renderAgent(msg, w, spinFrame);
    case 'system':
    case 'error':       return renderSystem(msg, w);
    case 'graph-stats': return renderSummary(msg, w);
    default:            return [];
  }
}

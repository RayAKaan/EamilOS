/**
 * EamilOS TUI — render.ts  (v2)
 *
 * What changed from OpenCode study:
 *   1. Sidebar panel: live agent status, callsign registry, graph stats, session info.
 *      OpenCode uses a right panel for file tree / diff. EamilOS uses it for
 *      agent identity + execution state — the unique thing EamilOS knows about.
 *   2. Section headers: ╸── LABEL ─── HH:MM:SS  (borrowed from OpenCode's
 *      clean turn-divider pattern, adapted with heavy end-caps for identity).
 *   3. Arbiter message type: new 'arbiter' section renders conflict resolution
 *      events with a ⊕ tool-style row and diff3 / vote / identical resolution.
 *   4. Run summary: two-column receipt at the bottom of a completed run.
 *   5. Centering fix: plain-text measurement for all centered strings.
 *      Hex tags ({#rrggbb-fg}) with hyphens can confuse blessed's width counter.
 *      We track visible length separately so centering is always pixel-perfect.
 *   6. Status bar: plain-text gap calculation to avoid tag miscounting.
 */

import type {
  Message, ToolCall, AgentInfo, GraphStats, ExecutionStrategy,
} from './types/ui.js';

// ─── Palette ───────────────────────────────────────────────────────────────
// Named blessed colors avoid the hex-hyphen tag parsing bug.

const K = {
  teal:   'cyan',           // EamilOS brand (nearest named)
  oc:     'cyan',           // opencode
  gem:    'magenta',        // gemini
  amber:  'yellow',         // user
  ok:     'green',
  warn:   'yellow',
  err:    'red',
  g0:     'white',
  g1:     '#d4d4d4',
  g2:     '#737373',
  g3:     '#404040',
  g4:     '#262626',
} as const;

// ─── Tag helpers ───────────────────────────────────────────────────────────

function fg(color: string, text: string): string {
  return `{${color}-fg}${text}{/}`;
}
function bold(t: string): string { return `{bold}${t}{/bold}`; }

export function rep(ch: string, n: number): string {
  const count = Math.max(0, Math.floor(n));
  return count > 0 ? ch.repeat(count) : '';
}

/** Visible length: strip all blessed {tag} sequences */
function vl(s: string): number {
  return s.replace(/\{[^}]*\}/g, '').length;
}

/** Timestamp HH:MM:SS */
function stamp(ts: number): string {
  const d  = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return fg(K.g3, `${hh}:${mm}:${ss}`);
}

// ─── Spinner ───────────────────────────────────────────────────────────────

const SPIN = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
let _spinIdx = 0;
export function tickSpinner(): void { _spinIdx = (_spinIdx + 1) % SPIN.length; }
export function spinChar(frame?: number): string {
  const i = frame !== undefined ? frame % SPIN.length : _spinIdx;
  return SPIN[i] ?? '⠋';
}

// ─── Section header ────────────────────────────────────────────────────────
// ╸── LABEL ──────────────────────── HH:MM:SS

function sectionRule(label: string, labelPlain: string, accent: string, ts: number, w: number): string {
  const tsStr = stamp(ts);
  const tsLen = 8 + 2; // HH:MM:SS + spaces
  const left  = fg(K.g3, '╸── ') + bold(fg(accent, label)) + ' ';
  const leftLen = 4 + labelPlain.length + 1;
  const ruleLen = Math.max(w - leftLen - tsLen - 1, 2);
  return left + fg(K.g3, rep('─', ruleLen)) + ' ' + tsStr;
}

// ─── Tool rows ────────────────────────────────────────────────────────────

const TOOL_DOT: Record<string, string> = {
  pending: fg(K.g3,   '○'),
  running: fg(K.warn, '◐'),
  done:    fg(K.ok,   '●'),
  failed:  fg(K.err,  '✗'),
};

function renderTool(tool: ToolCall, w: number): string[] {
  const dot    = TOOL_DOT[tool.status] ?? fg(K.g3, '○');
  const name   = fg(K.g0, tool.name.padEnd(12).slice(0, 12));
  const argMax = Math.max(w - 20, 10);
  const args   = fg(K.g2, tool.args.slice(0, argMax));
  const lines  = tool.lines != null ? fg(K.g3, ` +${tool.lines}`) : '';
  const first  = `  ${dot}  ${name}  ${args}${lines}`;
  const out    = [first];
  if (tool.result && (tool.status === 'done' || tool.status === 'failed')) {
    const r = fg(tool.status === 'done' ? K.g2 : K.err, tool.result.slice(0, w - 10));
    out.push(`        ${fg(K.g3, '└─')} ${r}`);
  }
  return out;
}

// ─── User message ──────────────────────────────────────────────────────────

export function renderUser(msg: Message, w: number): string[] {
  const rule = sectionRule('you', 'you', K.amber, msg.timestamp, w);
  const lines = wrapText(msg.content, w - 4);
  return [rule, ...lines.map(l => `   ${fg(K.amber, l)}`), ''];
}

function wrapText(text: string, w: number): string[] {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    if (!raw) { out.push(''); continue; }
    let s = raw;
    while (s.length > w) { out.push(s.slice(0, w)); s = s.slice(w); }
    out.push(s);
  }
  return out;
}

// ─── Agent message ─────────────────────────────────────────────────────────

export function renderAgent(msg: Message, w: number, frame: number): string[] {
  const isOC   = msg.agent === 'opencode' || msg.type === 'opencode';
  const accent = isOC ? K.oc : K.gem;
  const label  = isOC ? 'opencode' : 'gemini';
  const rule   = sectionRule(label, label, accent, msg.timestamp, w);
  const out: string[] = [rule];

  if (msg.content.trim()) {
    out.push(...wrapText(msg.content, w - 4).map(l => `   ${fg(K.g1, l)}`));
  }
  for (const tool of msg.tools ?? []) {
    out.push(...renderTool(tool, w));
  }
  if (msg.isStreaming) {
    out.push(`   ${fg(accent, spinChar(frame))} ${fg(K.g2, 'processing...')}`);
  }
  out.push('');
  return out;
}

// ─── Arbiter message — conflict resolution event ───────────────────────────
//
// Emitted by SwarmOrchestrator when ConflictArbiter resolves a file conflict.
// msg.content is JSON: { path, method, callsign, reason }

export interface ArbiterPayload {
  path:      string;
  method:    'identical' | 'auto-merge' | 'vote' | 'sole';
  callsign?: string;
  reason?:   string;
}

export function renderArbiter(msg: Message, w: number): string[] {
  let p: ArbiterPayload = { path: '?', method: 'sole' };
  try { p = JSON.parse(msg.content) as ArbiterPayload; } catch { /* ok */ }

  const rule = sectionRule('arbiter', 'arbiter', K.g2, msg.timestamp, w);

  const methodLabel: Record<string, string> = {
    identical:  'identical — single write',
    'auto-merge': 'auto-merge',
    vote:       'quality vote',
    sole:       'sole candidate',
  };

  const icon     = fg(K.g3, '⊕');
  const pathStr  = fg(K.g2, p.path.slice(0, Math.max(w - 24, 10)));
  const mLabel   = fg(K.g3, methodLabel[p.method] ?? p.method);
  const first    = `  ${icon}  ${fg(K.g0, 'conflict'.padEnd(10))}  ${pathStr}  ${mLabel}`;
  const out      = [rule, first];

  if (p.reason) {
    const r = fg(K.g2, p.reason.slice(0, w - 10));
    out.push(`        ${fg(K.g3, '└─')} ${r}`);
  }
  out.push('');
  return out;
}

// ─── System / error ────────────────────────────────────────────────────────

export function renderSystem(msg: Message, w: number): string[] {
  const isErr  = msg.type === 'error';
  const accent = isErr ? K.err : K.g2;
  const label  = isErr ? 'error' : 'sys';
  const rule   = sectionRule(label, label, accent, msg.timestamp, w);
  return [rule, ...wrapText(msg.content, w - 4).map(l => `   ${fg(isErr ? K.err : K.g2, l)}`), ''];
}

// ─── Run summary (graph-stats) ─────────────────────────────────────────────

interface SummaryPayload {
  strategy:    string;
  duration:    string;
  toolsUsed:   number;
  nodes:       number;
  edges:       number;
  validated:   boolean;
  agentUsed?:  string;
  conflicts?:  number;
}

export function renderSummary(msg: Message, w: number): string[] {
  let p: SummaryPayload = {
    strategy: '?', duration: '?', toolsUsed: 0,
    nodes: 0, edges: 0, validated: false,
  };
  try { p = JSON.parse(msg.content) as SummaryPayload; } catch { /* ok */ }

  const rule = sectionRule('run complete', 'run complete', K.teal, msg.timestamp, w);

  const ok = bold(fg(K.ok,  '✓')) + fg(K.g1, ' validated');
  const no = bold(fg(K.err, '✗')) + fg(K.g1, ' not validated');
  const resultMark = p.validated ? ok : no;

  const kv = (k: string, v: string) =>
    `   ${fg(K.g2, k.padEnd(12))}${v}`;

  const conflictsLabel = p.conflicts
    ? fg(K.ok, `${p.conflicts} resolved`)
    : fg(K.g3, 'none');

  const rows: string[] = [
    kv('strategy',   fg(K.g1, p.strategy)),
    kv('agents',     fg(K.g1, p.agentUsed ?? '—')),
    kv('duration',   fg(K.g1, p.duration)),
    kv('files',      fg(K.g1, String(p.toolsUsed))),
    kv('conflicts',  conflictsLabel),
    kv('graph',      fg(K.g1, `${p.nodes} nodes`) + fg(K.g3, '  ·  ') + fg(K.g1, `${p.edges} edges`)),
    kv('result',     resultMark),
  ];

  // Two-column layout at width >= 90
  if (w >= 90) {
    const packed: string[] = [];
    const half = Math.floor(w / 2);
    for (let i = 0; i < rows.length; i += 2) {
      const l = rows[i]! + rep(' ', Math.max(half - vl(rows[i]!), 0));
      const r = rows[i + 1] ?? '';
      packed.push(l + r);
    }
    return [rule, ...packed, ''];
  }
  return [rule, ...rows, ''];
}

// ─── Welcome screen ────────────────────────────────────────────────────────
// Uses ctrPlain() to avoid hex-tag centering bugs.

function ctrPlain(plain: string, tagged: string, w: number): string {
  const pad = Math.max(Math.floor((w - plain.length) / 2), 0);
  return rep(' ', pad) + tagged;
}

export function renderWelcome(w: number, h: number): string[] {
  const lines: string[] = [];
  const padTop = Math.max(Math.floor(h / 2) - 11, 1);
  for (let i = 0; i < padTop; i++) lines.push('');

  lines.push(ctrPlain('EamilOS',
    bold(fg('cyan', 'E')) + bold(fg('white', 'amil')) + bold(fg('cyan', 'OS')), w));
  lines.push(ctrPlain('multi-agent AI execution kernel',
    fg('gray', 'multi-agent AI execution kernel'), w));
  lines.push('');

  const rLen = Math.min(w - 8, 48);
  lines.push(ctrPlain(rep('─', rLen), fg(K.g4, rep('─', rLen)), w));
  lines.push('');

  lines.push(ctrPlain('◆ opencode   ╱   ◆ gemini cli',
    fg('cyan', '◆') + fg(K.g2, ' opencode') +
    fg(K.g3, '   ╱   ') +
    fg('magenta', '◆') + fg(K.g2, ' gemini cli'), w));
  lines.push('');

  lines.push(ctrPlain('strategies', fg(K.g3, 'strategies'), w));
  lines.push('');

  lines.push(ctrPlain('[1] opencode-first   [2] gemini-first',
    fg(K.g3, '[1]') + fg(K.g2, ' opencode-first   ') +
    fg(K.g3, '[2]') + fg(K.g2, ' gemini-first'), w));
  lines.push(ctrPlain('[3] parallel         [4] swarm',
    fg(K.g3, '[3]') + fg(K.g2, ' parallel         ') +
    fg(K.g3, '[4]') + fg(K.g2, ' swarm'), w));
  lines.push('');
  lines.push(ctrPlain('──────────────────────────────', fg(K.g4, '──────────────────────────────'), w));
  lines.push('');
  lines.push(ctrPlain('describe your goal and press enter',
    fg(K.g2, 'describe your goal and press ') + fg('white', 'enter'), w));

  return lines;
}

// ─── Status bar ────────────────────────────────────────────────────────────

function agentBadge(info: AgentInfo, name: string, accent: string): string {
  const dot = info.status === 'offline' ? fg(K.g3,   '◇')
            : info.status === 'busy'    ? fg('yellow', '◈')
            :                            fg(accent,   '◆');
  const ver = info.version ? fg(K.g3, ' ' + info.version.slice(0, 8)) : '';
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
  const sep = fg(K.g4, '  │  ');

  const mark   = bold(fg('cyan', 'EamilOS')) + fg(K.g3, ` v${version}`);
  const agents = agentBadge(oc, 'opencode', K.oc) + fg(K.g4, '   ') + agentBadge(gem, 'gemini', K.gem);
  const strat  = fg(K.g4, 'mode:') + fg('cyan', strategy);
  const state  = isRunning
    ? fg('yellow', spinChar()) + fg('yellow', ' running')
    : fg('green',  '●') + fg(K.g2, ' ready');
  const graph  = graphStats.nodes > 0
    ? sep + fg(K.g3, 'g:') + fg(K.g2, `${graphStats.nodes}n ${graphStats.edges}e`)
    : '';

  // Plain-text measurement avoids hex-tag miscounting in gap calculation
  const leftPlain  = ` EamilOS v${version}  │  ◆ opencode${oc.version ? ' ' + oc.version.slice(0,8) : ''}   ◆ gemini${gem.version ? ' ' + gem.version.slice(0,8) : ''}`;
  const rightPlain = `mode:${strategy}  │  ● ready${graphStats.nodes > 0 ? `  │  g:${graphStats.nodes}n ${graphStats.edges}e` : ''} `;
  const gap        = Math.max(w - leftPlain.length - rightPlain.length, 2);

  const left  = ' ' + mark + sep + agents;
  const right = strat + sep + state + graph + ' ';
  return left + rep(' ', gap) + right;
}

// ─── Sidebar content (right panel) ─────────────────────────────────────────
//
// OpenCode's right panel shows file tree / diff.
// EamilOS's right panel shows agent identity, callsigns, live session stats.
// Returns an array of lines for the sidebar box.

export interface CallsignMap { [callsign: string]: string }

export interface TerminalPanelInfo {
  callsign: string;
  agentId: string;
  mode: 'communication_only' | 'unrestricted_execution' | 'communication' | 'execution';
}

export interface SidebarData {
  oc:              AgentInfo;
  gem:             AgentInfo;
  callsigns:       CallsignMap;
  graphStats:      GraphStats;
  messageCount:    number;
  toolCount:       number;
  conflictCount:   number;
  strategy:        ExecutionStrategy;
  activeTerminals?: TerminalPanelInfo[];
}

export function renderSidebar(data: SidebarData, w: number): string[] {
  const sec = (title: string) => [
    fg(K.g3, title.toUpperCase().slice(0, w).padEnd(w, ' ')),
  ];
  const kv  = (k: string, v: string, vc: string) =>
    fg(K.g2, k.slice(0, 10).padEnd(10)) + fg(vc, v.slice(0, Math.max(w - 11, 4)));
  const sep = () => [fg(K.g4, rep('─', w))];

  const lines: string[] = [];

  // agents
  lines.push(...sec('agents'));
  const ocDot  = data.oc.status  === 'offline' ? fg(K.g3, '◇') : data.oc.status  === 'busy' ? fg('yellow', '◈') : fg('cyan', '◆');
  const gemDot = data.gem.status === 'offline' ? fg(K.g3, '◇') : data.gem.status === 'busy' ? fg('yellow', '◈') : fg('magenta', '◆');
  lines.push(ocDot  + ' ' + kv('opencode', data.oc.status,  data.oc.status  === 'busy' ? 'yellow' : data.oc.status  === 'offline' ? K.g3 : 'green'));
  lines.push(gemDot + ' ' + kv('gemini',   data.gem.status, data.gem.status === 'busy' ? 'yellow' : data.gem.status === 'offline' ? K.g3 : 'green'));
  lines.push(...sep());

  // callsigns — the EamilOS-unique feature
  const signs = Object.entries(data.callsigns);
  if (signs.length > 0) {
    lines.push(...sec('callsigns'));
    for (const [sign, id] of signs.slice(0, 4)) {
      const accentColor = id.includes('opencode') ? K.oc : id.includes('gemini') ? K.gem : K.g2;
      lines.push(fg(K.g3, sign.padEnd(6)) + ' ' + fg(accentColor, id.slice(0, Math.max(w - 8, 4))));
    }
    lines.push(...sep());
  }

  // graph
  lines.push(...sec('graph'));
  lines.push(kv('nodes',    String(data.graphStats.nodes),   'white'));
  lines.push(kv('edges',    String(data.graphStats.edges),   'white'));
  lines.push(...sep());

  // terminals
  const terms = data.activeTerminals;
  if (terms && terms.length > 0) {
    lines.push(...sec('terminals'));
    for (const t of terms.slice(0, 3)) {
      const isExec = t.mode === 'execution' || t.mode === 'unrestricted_execution';
      const modeIcon = isExec ? fg('green', '⚡') : fg('yellow', '◇');
      const modeLabel = isExec ? 'U' : 'C';
      lines.push(modeIcon + ' ' + kv(t.callsign.padEnd(4), modeLabel, isExec ? 'green' : 'yellow'));
    }
    lines.push(...sep());
  }

  // session
  lines.push(...sec('session'));
  lines.push(kv('messages', String(data.messageCount),       'white'));
  lines.push(kv('tools',    String(data.toolCount),          'white'));
  lines.push(kv('conflicts',data.conflictCount > 0 ? String(data.conflictCount) + ' ok' : 'none',
    data.conflictCount > 0 ? 'green' : K.g3));
  lines.push(kv('mode',     data.strategy,                   'cyan'));

  return lines;
}

// ─── Strategy bar ──────────────────────────────────────────────────────────

const ALL_STRATS: ExecutionStrategy[] = [
  'opencode-first', 'gemini-first', 'parallel', 'swarm',
];

export function renderStrategyBar(current: ExecutionStrategy): string {
  return ALL_STRATS.map((s, i) => {
    const key   = fg(K.g3, `[${i + 1}]`);
    const label = s === current ? bold(fg('cyan', s)) : fg(K.g2, s);
    return key + ' ' + label;
  }).join(fg(K.g3, '   '));
}

// ─── Running bar ───────────────────────────────────────────────────────────

export function renderRunningBar(frame: number): string {
  return (
    ' ' + fg('yellow', spinChar(frame)) + '  ' +
    fg(K.g2, 'agents working') +
    fg(K.g3, '   ·   ') +
    fg(K.g3, 'ctrl+c') + fg(K.g3, ' to cancel')
  );
}

// ─── Hint bar ──────────────────────────────────────────────────────────────

export function renderHintBar(): string {
  const pair = (k: string, v: string) => fg(K.g3, k) + fg(K.g4, ':') + fg(K.g3, v);
  const dot  = fg(K.g4, '  ·  ');
  return ' ' + [
    pair('↑',      'recall'),
    pair('tab',    'strategy'),
    pair('ctrl+alt+g', 'sidebar'),
    pair('ctrl+l', 'clear'),
    pair('ctrl+c', 'exit'),
    pair('pg↑↓',  'scroll'),
  ].join(dot);
}

// ─── Graph line (legacy compat) ────────────────────────────────────────────

export function renderGraphLine(stats: GraphStats): string {
  return [
    bold(fg('cyan', 'graph')),
    fg(K.g2, 'nodes:') + fg('white', String(stats.nodes)),
    fg(K.g2, 'edges:') + fg('white', String(stats.edges)),
    fg(K.g2, 'strategy:') + fg('white', stats.strategy),
  ].join(fg(K.g3, '   │   '));
}

// ─── Message dispatcher ────────────────────────────────────────────────────

export function messageToLines(msg: Message, w: number, spinFrame: number): string[] {
  switch (msg.type) {
    case 'user':        return renderUser(msg, w);
    case 'opencode':
    case 'gemini':
    case 'eamilos':     return renderAgent(msg, w, spinFrame);
    case 'arbiter':     return renderArbiter(msg, w);
    case 'system':
    case 'error':       return renderSystem(msg, w);
    case 'graph-stats': return renderSummary(msg, w);
    default:            return [];
  }
}

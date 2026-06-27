import type { TuiState, TuiMessage, AgentUiInfo, PageId, StrategyId } from './types.js';
import { theme, ansi, ansiBg, bold, dim, underline, ANSI } from './theme.js';
import { stripAnsi, width, padEndVisible, truncate, wrap } from './text.js';

const SEP = ansi(theme.border, ' ┃ ');
const HSEP = ansi(theme.border, ' ────────────────────────────────────────────────────────── ');

function section(title: string, w: number): string {
  const t = bold(ansi(theme.accent, ` ${title} `));
  const line = ansi(theme.border, '─'.repeat(Math.max(2, w - width(t) - 2)));
  return ansi(theme.border, '╭─') + t + line;
}

function subsection(title: string, w: number): string {
  const t = bold(ansi(theme.accent2, ` ${title} `));
  const line = ansi(theme.border, '─'.repeat(Math.max(2, w - width(t) - 2)));
  return ansi(theme.border, '├─') + t + line;
}

function renderPageHeader(page: PageId, w: number): string {
  const pages: PageId[] = ['chat', 'logs', 'agents', 'sessions', 'terminals'];
  const parts = pages.map((p, i) => {
    const num = ansi(theme.muted, `${i + 1}`);
    const name = p === page ? bold(ansi(theme.accent, p)) : ansi(theme.muted, p);
    return `${num}${name}`;
  });
  return ansi(theme.border, '│ ') + parts.join(ansi(theme.border, ' │ ')) + ansi(theme.border, ' │');
}

function renderMessages(state: TuiState, sw: number, mw: number): string[] {
  const lines: string[] = [];
  const msgs = state.messages;

  for (const msg of msgs) {
    if (msg.isSystem) {
      lines.push(ansi(theme.muted, `  ${msg.content}`));
      continue;
    }
    if (msg.isError) {
      lines.push(ansi(theme.err, `  ✗ ${msg.content}`));
      continue;
    }
    if (msg.isUser) {
      lines.push('');
      lines.push(ansi(theme.warn, `  ── You ──`));
      for (const l of wrap(msg.content, mw)) {
        lines.push(ansi(theme.text, `  ${l}`));
      }
      continue;
    }
    if (msg.agentId) {
      const agent = state.agents.find(a => a.id === msg.agentId);
      const label = agent?.name ?? msg.agentId;
      const accent = msg.agentId === 'opencode' ? theme.accent : theme.accent2;
      lines.push('');
      lines.push(ansi(accent, `  ── ${label} ──`));
      for (const l of wrap(msg.content, mw)) {
        lines.push(ansi(theme.text, `  ${l}`));
      }
      if (msg.isStreaming) {
        lines.push(ansi(theme.muted, `  ● processing...`));
      }
    }
  }
  return lines;
}

function renderChatPage(state: TuiState, w: number, h: number): string[] {
  const sidebarW = state.sidebarVisible ? 28 : 0;
  const mw = Math.max(40, w - sidebarW - 4);
  const bodyH = h - 9;

  const pageHeader = renderPageHeader('chat', w);
  const strategyBar = renderStrategyBar(state.strategy, w);
  const msgs = renderMessages(state, sidebarW, mw);

  const visible = msgs.slice(-bodyH);
  const lines: string[] = [pageHeader, strategyBar, ''];

  if (visible.length === 0) {
    const welcome = renderWelcome(w - sidebarW - 4);
    lines.push(...welcome);
  } else {
    lines.push(...visible);
  }

  return lines;
}

function renderWelcome(w: number): string[] {
  const lines: string[] = [];
  const title = bold(ansi(theme.accent, 'EamilOS')) + ansi(theme.text, ' multi-agent AI execution kernel');
  lines.push(padEndVisible(title, w));
  lines.push('');
  lines.push(ansi(theme.muted, padEndVisible('~ type a goal and press Enter to begin ~', w)));
  lines.push('');
  lines.push(ansi(theme.border, padEndVisible(`  Strategies: [1] single  [2] single-fallback  [3] fallback  [4] swarm  [5] manual`, w)));
  return lines;
}

function renderLogsPage(state: TuiState, w: number, h: number): string[] {
  const pageHeader = renderPageHeader('logs', w);
  const bodyH = h - 7;
  const lines: string[] = [pageHeader, ''];

  const logs = state.logs.slice(-bodyH);
  for (const entry of logs) {
    const label = entry.level === 'ERROR' ? ansi(theme.err, 'ERR') :
                  entry.level === 'WARN' ? ansi(theme.warn, 'WRN') :
                  ansi(theme.muted, 'INF');
    lines.push(` ${label} ${ansi(theme.muted, entry.message)}`);
  }
  return lines;
}

function renderAgentsPage(state: TuiState, w: number, h: number): string[] {
  const pageHeader = renderPageHeader('agents', w);
  const lines: string[] = [pageHeader, ''];

  for (const agent of state.agents) {
    const statusColor = agent.status === 'available' ? theme.ok :
                        agent.status === 'busy' ? theme.warn :
                        agent.status === 'failed' ? theme.err : theme.muted;
    const dot = agent.status === 'available' ? '◆' :
                agent.status === 'busy' ? '◈' :
                agent.status === 'failed' ? '✗' : '◇';
    const statusStr = ansi(statusColor, dot);
    const nameStr = bold(ansi(theme.text, agent.name));
    const kindStr = ansi(theme.muted, `(${agent.kind})`);
    const verStr = agent.version ? ansi(theme.muted, ` v${agent.version}`) : '';
    lines.push(` ${statusStr} ${nameStr} ${kindStr}${verStr}`);
    if (agent.error) {
      lines.push(`   ${ansi(theme.err, agent.error)}`);
    }
  }

  if (state.agents.length === 0) {
    lines.push(ansi(theme.muted, ' No agents detected yet.'));
  }
  return lines;
}

function renderSessionsPage(state: TuiState, w: number, h: number): string[] {
  const pageHeader = renderPageHeader('sessions', w);
  const lines: string[] = [pageHeader, ''];

  for (const s of state.sessions) {
    const statusColor = s.status === 'completed' ? theme.ok :
                        s.status === 'failed' ? theme.err : theme.warn;
    const icon = s.status === 'completed' ? '✓' : s.status === 'failed' ? '✗' : '●';
    const goalStr = truncate(s.goal, w - 30);
    const stratStr = ansi(theme.muted, s.strategy);
    const countStr = ansi(theme.muted, `${s.messageCount} msgs`);
    lines.push(` ${ansi(statusColor, icon)} ${goalStr}  ${stratStr}  ${countStr}`);
  }

  if (state.sessions.length === 0) {
    lines.push(ansi(theme.muted, ' No sessions yet.'));
  }
  return lines;
}

function renderTerminalsPage(state: TuiState, w: number, h: number): string[] {
  const pageHeader = renderPageHeader('terminals', w);
  const lines: string[] = [pageHeader, ''];

  for (const t of state.terminals) {
    const statusColor = t.status === 'running' ? theme.warn :
                        t.status === 'done' ? theme.ok :
                        t.status === 'failed' ? theme.err : theme.muted;
    const icon = t.status === 'running' ? '◐' :
                 t.status === 'done' ? '●' :
                 t.status === 'failed' ? '✗' : '○';
    const callsignStr = bold(ansi(theme.text, t.callsign));
    const agentIdStr = ansi(theme.muted, t.agentId);
    const modeStr = ansi(theme.muted, t.mode);
    const lastLine = t.lastLine ? ` ${ansi(theme.muted, truncate(t.lastLine, w - 35))}` : '';
    lines.push(` ${ansi(statusColor, icon)} ${callsignStr} ${SEP} ${agentIdStr} ${SEP} ${modeStr}${lastLine}`);
  }

  if (state.terminals.length === 0) {
    lines.push(ansi(theme.muted, ' No active terminals.'));
  }
  return lines;
}

function renderStrategyBar(current: StrategyId, w: number): string {
  const strats: StrategyId[] = ['single', 'single-fallback', 'fallback', 'swarm', 'manual'];
  const parts = strats.map((s, i) => {
    const key = ansi(theme.muted, `[Shift+${i + 1}]`);
    const label = s === current ? bold(ansi(theme.accent, s)) : ansi(theme.muted, s);
    return `${key} ${label}`;
  });
  return ansi(theme.border, '│ ') + parts.join(ansi(theme.border, ' │ ')) + ansi(theme.border, ' │');
}

function renderSidebar(state: TuiState, h: number): string[] {
  const lines: string[] = [];
  const sw = 28;

  lines.push('');
  lines.push(ansi(theme.border, padEndVisible('╭─ AGENTS ─────────────────────────╮', sw)));

  for (const agent of state.agents) {
    const statusColor = agent.status === 'available' ? theme.ok :
                        agent.status === 'busy' ? theme.warn :
                        agent.status === 'failed' ? theme.err : theme.muted;
    const dot = agent.status === 'available' ? '◆' :
                agent.status === 'busy' ? '◈' :
                agent.status === 'failed' ? '✗' : '◇';
    const aName = truncate(agent.name, sw - 8);
    lines.push(ansi(theme.border, '│') + ` ${ansi(statusColor, dot)} ${aName}${' '.repeat(Math.max(1, sw - width(aName) - 8))}` + ansi(theme.border, '│'));
  }

  lines.push(ansi(theme.border, padEndVisible('╰──────────────────────────────────╯', sw)));

  if (state.modifiedFiles.length > 0) {
    lines.push('');
    lines.push(ansi(theme.border, padEndVisible('╭─ FILES ───────────────────────────╮', sw)));

    for (const f of state.modifiedFiles.slice(0, 5)) {
      const icon = f.status === 'applied' ? ansi(theme.ok, '✓') :
                   f.status === 'failed' ? ansi(theme.err, '✗') : ansi(theme.muted, '○');
      const fName = truncate(f.path, sw - 8);
      lines.push(ansi(theme.border, '│') + ` ${icon} ${fName}${' '.repeat(Math.max(1, sw - width(fName) - 8))}` + ansi(theme.border, '│'));
    }

    if (state.modifiedFiles.length > 5) {
      lines.push(ansi(theme.border, '│') + ansi(theme.muted, ` ${' '.repeat(sw - 10)}+${state.modifiedFiles.length - 5} more`) + ansi(theme.border, '│'));
    }

    lines.push(ansi(theme.border, padEndVisible('╰──────────────────────────────────╯', sw)));
  }

  lines.push('');
  lines.push(ansi(theme.border, padEndVisible('╭─ VALIDATION ──────────────────────╮', sw)));
  if (state.graph.validated) {
    lines.push(ansi(theme.border, '│') + ansi(theme.ok, `  ✓ All checks passed${' '.repeat(sw - 24)}`) + ansi(theme.border, '│'));
  } else {
    const errStr = state.errorCount > 0 ? ansi(theme.err, ` ${state.errorCount} errors`) : '';
    const warnStr = state.warnCount > 0 ? ansi(theme.warn, ` ${state.warnCount} warnings`) : '';
    const valStr = errStr || warnStr || ansi(theme.muted, ' pending');
    lines.push(ansi(theme.border, '│') + ` ${valStr}${' '.repeat(Math.max(1, sw - width(valStr) - 5))}` + ansi(theme.border, '│'));
  }
  lines.push(ansi(theme.border, padEndVisible('╰──────────────────────────────────╯', sw)));

  if (state.sessions.length > 0) {
    const last = state.sessions[state.sessions.length - 1];
    lines.push('');
    lines.push(ansi(theme.border, padEndVisible('╭─ LAST RUN ──────────────────────────╮', sw)));
    const runStatus = last.status === 'completed' ? ansi(theme.ok, '✓ completed') :
                      last.status === 'failed' ? ansi(theme.err, '✗ failed') : ansi(theme.warn, '● running');
    lines.push(ansi(theme.border, '│') + ` ${runStatus}${' '.repeat(Math.max(1, sw - width(runStatus) - 5))}` + ansi(theme.border, '│'));
    const goalLine = truncate(last.goal, sw - 6);
    lines.push(ansi(theme.border, '│') + ` ${ansi(theme.muted, goalLine)}${' '.repeat(Math.max(1, sw - width(goalLine) - 6))}` + ansi(theme.border, '│'));
    lines.push(ansi(theme.border, padEndVisible('╰──────────────────────────────────╯', sw)));
  }

  return lines;
}

function renderStatusBar(state: TuiState, w: number): string {
  const url = ansi(theme.muted, 'https://eamilos.dev');
  const version = ansi(theme.muted, 'v1.7.0');

  const running = state.isRunning
    ? ansi(theme.warn, '● running')
    : ansi(theme.ok, '● ready');

  const agentCount = ansi(theme.muted, `${state.agents.filter(a => a.status === 'available').length} agents`);

  const left = ` ${version} ${SEP} ${agentCount} ${SEP} ${running}`;
  const right = `${url} `;

  const gap = ' '.repeat(Math.max(2, w - width(left) - width(right)));
  return ansi(theme.bg3, ` ${left}${gap}${right}`);
}

function renderInputBox(state: TuiState, w: number): string {
  const prefix = ansi(theme.accent, ' ▸ ');
  const input = state.inputValue || ansi(theme.muted, 'Type a goal and press Enter...');
  const maxInput = w - width(prefix) - 4;
  return prefix + truncate(input, maxInput) + ' ';
}

export function render(state: TuiState): string {
  const w = state.terminalWidth;
  const h = state.terminalHeight;

  const sidebarW = state.sidebarVisible ? 28 : 0;
  const mainW = Math.max(40, w - sidebarW - 2);
  const bodyH = Math.max(5, h - 8);

  let mainLines: string[] = [];

  switch (state.activePage) {
    case 'chat':
      mainLines = renderChatPage(state, w, h);
      break;
    case 'logs':
      mainLines = renderLogsPage(state, w, h);
      break;
    case 'agents':
      mainLines = renderAgentsPage(state, w, h);
      break;
    case 'sessions':
      mainLines = renderSessionsPage(state, w, h);
      break;
    case 'terminals':
      mainLines = renderTerminalsPage(state, w, h);
      break;
  }

  const sidebarLines = state.sidebarVisible ? renderSidebar(state, h) : [];

  const bodyLines: string[] = [];
  const maxBody = Math.max(mainLines.length, sidebarLines.length);
  for (let i = 0; i < maxBody && bodyLines.length < bodyH; i++) {
    const main = mainLines[i] ?? '';
    const side = sidebarLines[i] ?? '';
    const combo = padEndVisible(main, mainW + 2) + ansi(theme.border, '┃') + side;
    bodyLines.push(combo);
  }

  const frame: string[] = [
    ANSI.clear + ANSI.cursorHome,
    renderPageHeader(state.activePage, w),
    renderStrategyBar(state.strategy, w),
    ...bodyLines.slice(0, bodyH),
    renderInputBox(state, w),
    renderStatusBar(state, w),
  ];

  return frame.join('\n');
}

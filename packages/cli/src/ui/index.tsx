/**
 * EamilOS TUI — index.tsx  (v2)
 *
 * Layout (OpenCode-inspired):
 *
 *   ┌ status bar ────────────────────────────────────────────────────────┐
 *   ├ thin rule ─────────────────────────────────────────────────────────┤
 *   │                                         │                          │
 *   │  message feed (scrollable)              │  sidebar (200px)         │
 *   │                                         │  agents / callsigns /    │
 *   │                                         │  graph / session stats   │
 *   │                                         │                          │
 *   ├ strategy bar ──────────────────────────────────────────────────────┤
 *   ├ prompt row  ▸ textbox ─────────────────────────────────────────── [enter] │
 *   └ hint bar ──────────────────────────────────────────────────────────┘
 *
 * Key OpenCode lessons applied:
 *   - Sidebar for context-panel info (they use file tree; we use agent state)
 *   - Tab to cycle strategy (they use Tab to cycle agent; same slot)
 *   - ctrl+alt+g toggles the sidebar (they use sidebar_toggle keybind)
 *   - Section headers have timestamp flush-right (they show timestamps below msgs)
 *   - Running state disables input and shows a spinner bar (same pattern)
 *   - Delayed second render for dimension accuracy on startup
 *   - No console.log while blessed owns stdout
 */

import blessed from 'blessed';
import { useStore }          from './state/store.js';
import { AdaptiveMultiplexer } from '../multi-agent/index.js';
import { run, cancel, detectAndTrackAgents } from './hooks/useOrchestrator.js';
import { checkAgentStatus }  from './hooks/useAgentStatus.js';
import {
  messageToLines,
  renderStatusBar,
  renderStrategyBar,
  renderHintBar,
  renderSidebar,
  renderWelcome,
  renderRunningBar,
  renderGraphLine,
  tickSpinner,
  spinChar,
  rep,
  type SidebarData,
  type CallsignMap,
} from './render.js';
import type { ExecutionStrategy } from './types/ui.js';

const VERSION = '1.6.0';
const SIDEBAR_W = 22;   // chars; sidebar visible width
const CHROME_TOP = 2;   // status + rule
const CHROME_BOT = 3;   // strategy + prompt + hint

const STRATS: ExecutionStrategy[] = [
  'opencode-first', 'gemini-first', 'parallel', 'swarm',
];

// ─── Screen ────────────────────────────────────────────────────────────────

const screen = blessed.screen({
  smartCSR:      true,
  fullUnicode:   true,
  autoPadding:   false,
  title:         'EamilOS',
  resizeTimeout: 60,
  dockBorders:   false,
  ignoreLocked:  ['C-c'],
});

let W = (screen.width  as number) || 120;
let H = (screen.height as number) || 30;

// Callsign map — updated when CallsignRegistry assigns names during init
let _callsigns: CallsignMap = {};
export function setCallsigns(map: CallsignMap): void {
  _callsigns = map;
  scheduleRender();
}

// ─── Layout helpers ────────────────────────────────────────────────────────

function msgW(): number {
  const state = useStore.getState();
  return state.showGraphPanel
    ? Math.max(W - SIDEBAR_W - 1, 40)
    : W;
}

function layout() {
  const showSidebar = useStore.getState().showGraphPanel;
  const hintRow     = H - 1;
  const promptRow   = H - 2;
  const stratRow    = H - 3;
  const feedTop     = CHROME_TOP;
  const feedH       = Math.max(stratRow - feedTop, 4);
  const feedW       = showSidebar ? Math.max(W - SIDEBAR_W - 1, 40) : W;

  return { showSidebar, hintRow, promptRow, stratRow, feedTop, feedH, feedW };
}

// ─── Blessed elements — created once, repositioned each render ─────────────

function mkText(top: number | string): blessed.Widgets.TextElement {
  return blessed.text({
    parent: screen, top, left: 0, width: '100%', height: 1, tags: true,
  });
}

const elStatus   = mkText(0);
const elRule1    = mkText(1);
const elStrat    = mkText(0);  // positioned in render()
const elPromptBg = mkText(0);  // running bar or empty line behind textbox
const elHint     = mkText(0);

// Scrollable message feed
const msgBox = blessed.box({
  parent:      screen,
  top:         CHROME_TOP,
  left:        0,
  width:       '100%',
  height:      Math.max(H - CHROME_TOP - CHROME_BOT, 4),
  tags:        true,
  scrollable:  true,
  alwaysScroll:true,
  mouse:       true,
  style:       { scrollbar: { bg: '#333333' } },
  scrollbar:   { ch: '┃', style: { fg: '#3a3a3a' }, track: { bg: '#1a1a1a' } },
});

// Sidebar box
const sideBox = blessed.box({
  parent:  screen,
  top:     CHROME_TOP,
  left:    0,     // set in render()
  width:   SIDEBAR_W,
  height:  Math.max(H - CHROME_TOP - CHROME_BOT, 4),
  tags:    true,
  style:   { border: { fg: '#262626' } },
  border:  { type: 'line' },
});

// Sidebar divider line between feed and sidebar
const sideRule = blessed.text({
  parent: screen,
  top:    CHROME_TOP,
  left:   0,   // set in render()
  width:  1,
  height: Math.max(H - CHROME_TOP - CHROME_BOT, 4),
  tags:   true,
  content: '',
});

// Prompt glyph
const promptGlyph = blessed.text({
  parent: screen, tags: true, top: 0, left: 0, width: 3, height: 1,
  content: ' {bold}{cyan-fg}▸{/}{/bold} ',
});

// Textbox
const textbox = blessed.textbox({
  parent:       screen,
  top:          0,
  left:         3,
  width:        '100%-13',
  height:       1,
  inputOnFocus: true,
  style:        { fg: '#d4d4d4', focus: { fg: 'white' } },
});

// Enter hint
const enterHint = blessed.text({
  parent:  screen,
  tags:    true,
  top:     0,
  left:    '100%-10',
  width:   10,
  height:  1,
  content: '{#404040-fg} [enter] {/}',
  align:   'right',
});

// ─── Slash-command popup menu ──────────────────────────────────────────────

const COMMANDS = [
  { cmd: '/strategy', desc: 'Set strategy' },
  { cmd: '/s',        desc: 'Shorthand for /strategy' },
  { cmd: '/multiplex', desc: 'Show terminal panes' },
  { cmd: '/mx',       desc: 'Shorthand for /multiplex' },
  { cmd: '/agents',   desc: 'Show detected agents' },
  { cmd: '/clear',    desc: 'Clear messages' },
  { cmd: '/help',     desc: 'Show this help' },
];

const MAX_VISIBLE = 4;

const cmdPopup = blessed.list({
  parent:          screen,
  top:             1,
  left:            0,
  width:           '100%',
  height:          Math.min(COMMANDS.length, MAX_VISIBLE) + 2,
  hidden:          true,
  keys:            true,
  vi:              true,
  mouse:           true,
  scrollbar:       { ch: '▐', track: { bg: '#333' }, style: { bg: '#569cd6' } },
  scrollable:      true,
  border:          { type: 'line', fg: '#569cd6' },
  style:           {
    selected: { bg: '#264f78', fg: 'white' },
    item:     { fg: '#d4d4d4' },
    header:   { fg: '#569cd6' },
  },
  items:           COMMANDS.map(c => `  {bold}${c.cmd}{/bold}`),
});

let cmdPopupItems: typeof COMMANDS = [];

function showCommandMenu(filter: string): void {
  const lower = filter.toLowerCase();
  cmdPopupItems = COMMANDS.filter(c => c.cmd.toLowerCase().startsWith(lower));
  if (cmdPopupItems.length === 0 || lower === '') {
    cmdPopup.hide();
    screen.render();
    return;
  }
  cmdPopup.setItems(cmdPopupItems.map(c => `  {bold}${c.cmd}{/bold}`));
  cmdPopup.height = Math.min(cmdPopupItems.length, MAX_VISIBLE) + 2;
  cmdPopup.select(0);
  cmdPopup.show();
  screen.render();
}

function hideCommandMenu(): void {
  cmdPopup.hide();
  screen.render();
}

// ─── Spinner ───────────────────────────────────────────────────────────────

let spinFrame = 0;
let spinTimer: ReturnType<typeof setInterval> | null = null;

function startSpin(): void {
  if (spinTimer) return;
  spinTimer = setInterval(() => {
    spinFrame = (spinFrame + 1) % 10;
    tickSpinner();
    partialRefresh();
  }, 80);
}

function stopSpin(): void {
  if (!spinTimer) return;
  clearInterval(spinTimer);
  spinTimer = null;
}

// ─── Build message content ─────────────────────────────────────────────────

function buildMessages(feedW: number, feedH: number): string {
  const state = useStore.getState();
  const msgs  = state.messages;
  const inner = Math.max(feedW - 2, 20);

  if (msgs.length === 0) {
    return renderWelcome(inner, feedH).join('\n');
  }

  const lines: string[] = [];
  for (const msg of msgs) {
    lines.push(...messageToLines(msg, inner, spinFrame));
  }
  return lines.join('\n');
}

// ─── Build sidebar content ─────────────────────────────────────────────────

function buildSidebar(sideW: number): string {
  const state = useStore.getState();
  const msgs  = state.messages;

  let toolCount = 0;
  let conflictCount = 0;
  for (const m of msgs) {
    toolCount += (m.tools ?? []).length;
    if (m.type === 'arbiter') conflictCount++;
  }

  const data: SidebarData = {
    oc:              state.agentStatus.opencode,
    gem:             state.agentStatus.gemini,
    callsigns:       _callsigns,
    graphStats:      state.graphStats,
    messageCount:    msgs.length,
    toolCount,
    conflictCount,
    strategy:        state.currentStrategy,
    activeTerminals: state.activeTerminals.length > 0 ? state.activeTerminals : undefined,
  };

  return renderSidebar(data, Math.max(sideW - 2, 8)).join('\n');
}

// ─── Full render ───────────────────────────────────────────────────────────

function render(): void {
  W = (screen.width  as number) || 120;
  H = (screen.height as number) || 30;

  const state = useStore.getState();
  const L     = layout();

  // Status bar
  elStatus.setContent(renderStatusBar(
    W, state.agentStatus.opencode, state.agentStatus.gemini,
    state.currentStrategy, state.graphStats, state.isRunning, VERSION,
  ));

  // Top rule
  elRule1.top = 1;
  elRule1.setContent('{#262626-fg}' + rep('─', W) + '{/}');

  // Message feed
  msgBox.top    = L.feedTop;
  msgBox.height = L.feedH;
  msgBox.width  = L.feedW;
  msgBox.setContent(buildMessages(L.feedW, L.feedH));
  msgBox.setScrollPerc(100);

  // Sidebar
  if (L.showSidebar) {
    const sideLeft = L.feedW;
    sideRule.top  = L.feedTop;
    sideRule.left = sideLeft;
    sideRule.height = L.feedH;
    sideRule.setContent('{#262626-fg}' + '│\n'.repeat(L.feedH) + '{/}');
    sideRule.hidden = false;

    sideBox.top    = L.feedTop;
    sideBox.left   = sideLeft + 1;
    sideBox.width  = SIDEBAR_W;
    sideBox.height = L.feedH;
    sideBox.setContent(buildSidebar(SIDEBAR_W));
    sideBox.hidden = false;
  } else {
    sideRule.hidden = true;
    sideBox.hidden  = true;
  }

  // Strategy bar
  elStrat.top = L.stratRow;
  elStrat.setContent(' ' + renderStrategyBar(state.currentStrategy));

  // Prompt / running row
  if (state.isRunning) {
    promptGlyph.hidden = true;
    textbox.hidden     = true;
    enterHint.hidden   = true;
    elPromptBg.top = L.promptRow;
    elPromptBg.setContent(renderRunningBar(spinFrame));
    startSpin();
  } else {
    stopSpin();
    promptGlyph.hidden = false;
    textbox.hidden     = false;
    enterHint.hidden   = false;
    promptGlyph.top = L.promptRow;
    textbox.top     = L.promptRow;
    textbox.width   = Math.max(W - 14, 20) as unknown as number & `${number}%`;
    enterHint.top   = L.promptRow;
    elPromptBg.top  = L.promptRow;
    elPromptBg.setContent('');
  }

  // Hint bar
  elHint.top = L.hintRow;
  elHint.setContent(renderHintBar());

  screen.render();
}

// ─── Partial refresh (spinner only) ────────────────────────────────────────

function partialRefresh(): void {
  const state = useStore.getState();
  if (state.isRunning) {
    elPromptBg.setContent(renderRunningBar(spinFrame));
  }
  // Re-render message feed for streaming updates
  const L = layout();
  msgBox.setContent(buildMessages(L.feedW, L.feedH));
  msgBox.setScrollPerc(100);
  screen.render();
}

// ─── Store subscription ────────────────────────────────────────────────────

let renderPending = false;
function scheduleRender(): void {
  if (renderPending) return;
  renderPending = true;
  setImmediate(() => { renderPending = false; render(); });
}

// ─── Commands ────────────────────────────────────────────────────────────────

const STRAT_NAMES: Record<string, ExecutionStrategy> = {
  '1':                'opencode-first',
  'opencode-first':   'opencode-first',
  'opencode':         'opencode-first',
  'oc':               'opencode-first',
  '2':                'gemini-first',
  'gemini-first':     'gemini-first',
  'gemini':           'gemini-first',
  'gm':               'gemini-first',
  '3':                'parallel',
  'parallel':         'parallel',
  'par':              'parallel',
  '4':                'swarm',
  'swarm':            'swarm',
};

function handleCommand(input: string): void {
  const parts = input.slice(1).trim().split(/\s+/);
  const cmd   = parts[0]?.toLowerCase();
  const arg   = parts.slice(1).join(' ');

  switch (cmd) {
    case 's':
    case 'strategy':
    case 'strat': {
      if (!arg) {
        useStore.getState().addMessage({
          type: 'system',
          content: 'Usage: /strategy <name>  (opencode-first, gemini-first, parallel, swarm)',
        });
        return;
      }
      const strat = STRAT_NAMES[arg.toLowerCase()];
      if (!strat) {
        useStore.getState().addMessage({ type: 'error', content: `Unknown strategy: ${arg}` });
        return;
      }
      useStore.getState().setStrategy(strat);
      useStore.getState().addMessage({ type: 'system', content: `Strategy → ${strat}` });
      render();
      break;
    }
    case 'multiplex':
    case 'mx':
    case 'terminals': {
      const state = useStore.getState();
      const terms = state.activeTerminals;
      if (!terms || terms.length === 0) {
        useStore.getState().addMessage({ type: 'system', content: 'No active terminals. Run a task to spawn agent terminals.' });
        return;
      }
      const lines = terms.map(t =>
        `  ${t.callsign.padEnd(8)} ${t.agentId.padEnd(14)} mode: ${t.mode === 'unrestricted_execution' ? '⚡ UNRESTRICTED' : '◇ COMMUNICATION_ONLY'}`
      );
      useStore.getState().addMessage({ type: 'system', content: 'Active Terminals:\n' + lines.join('\n') });
      break;
    }
    case 'agents':
    case 'agent': {
      const state = useStore.getState();
      const terms = state.activeTerminals;
      if (!terms || terms.length === 0) {
        useStore.getState().addMessage({ type: 'system', content: 'No agents detected. Run "eamilos multi doctor" from CLI to check.' });
        return;
      }
      const lines = terms.map(t =>
        `  ${t.agentId.padEnd(14)} ${t.callsign.padEnd(8)} mode: ${t.mode === 'unrestricted_execution' ? '⚡ U' : '◇ C'}`
      );
      const env = AdaptiveMultiplexer.detectEnvironment();
      useStore.getState().addMessage({ type: 'system', content: `Detected Agents (env: ${env}):\n` + lines.join('\n') });
      break;
    }
    case 'clear':
      useStore.getState().clearMessages();
      render();
      break;
    case 'h':
    case 'help':
    default:
      useStore.getState().addMessage({
        type: 'system',
        content: [
          'Commands:',
          '  /strategy <name>   Set strategy (opencode-first, gemini-first, parallel, swarm)',
          '  /s <name>          Shorthand for /strategy',
          '  /multiplex         Show active terminal panes and their modes',
          '  /agents            Show detected CLI agents with callsigns',
          '  /clear             Clear messages',
          '  /help              Show this help',
          '',
          'Keys:',
          '  Tab / Shift+Tab    Cycle strategy forward / backward',
          '  Ctrl+Alt+G         Toggle sidebar',
          '  Ctrl+L             Clear messages',
          '  Ctrl+C             Cancel / exit',
          '  ↑ / ↓              Recall / clear prompt',
          '  PgUp / PgDn        Scroll messages',
        ].join('\n'),
      });
      render();
      break;
  }
}

// ─── Keys ──────────────────────────────────────────────────────────────────

function bindKeys(): void {
  // Cancel / exit
  screen.key('C-c', () => {
    if (useStore.getState().isRunning) cancel();
    else shutdown();
  });

  // Clear messages
  screen.key('C-l', () => {
    useStore.getState().clearMessages();
    render();
  });

  // Toggle sidebar (ctrl+alt+g — avoids VS Code ctrl+g conflict)
  screen.key('C-M-g', () => {
    useStore.getState().toggleGraphPanel();
    render();
  });

  // Tab to cycle strategy (OpenCode: agent_cycle maps to Tab) — hide popup if open
  textbox.key('tab', () => {
    hideCommandMenu();
    if (textbox.getValue().length > 0) return;
    const cur  = useStore.getState().currentStrategy;
    const idx  = STRATS.indexOf(cur);
    const next = STRATS[(idx + 1) % STRATS.length]!;
    useStore.getState().setStrategy(next);
    render();
  });

  // Shift+Tab to cycle backward
  screen.key('S-tab', () => {
    const cur  = useStore.getState().currentStrategy;
    const idx  = STRATS.indexOf(cur);
    const prev = STRATS[(idx - 1 + STRATS.length) % STRATS.length]!;
    useStore.getState().setStrategy(prev);
    render();
  });

  // ─── Command popup keys ──────────────────────────────────────────────────
  // Detect `/` typing to show/hide popup
  textbox.on('keypress', () => {
    const val = textbox.getValue();
    if (val.startsWith('/')) {
      showCommandMenu(val);
    } else {
      hideCommandMenu();
    }
  });

  // Popup navigation via textbox keys
  textbox.key('up', () => {
    if (!cmdPopup.hidden) {
      cmdPopup.up(1);
      screen.render();
      return;
    }
    const last = useStore.getState().lastPrompt;
    if (last) { textbox.setValue(last); screen.render(); }
  });
  textbox.key('down', () => {
    if (!cmdPopup.hidden) {
      cmdPopup.down(1);
      screen.render();
      return;
    }
    textbox.clearValue(); screen.render();
  });

  // Escape hides popup
  screen.key('escape', () => {
    if (!cmdPopup.hidden) hideCommandMenu();
  });

  // Slash commands + popup select
  textbox.key('enter', () => {
    const val = textbox.getValue().trim();

    // Popup selection
    if (!cmdPopup.hidden && cmdPopupItems.length > 0) {
      const sel = cmdPopup.selected;
      const item = cmdPopupItems[sel];
      if (item) {
        textbox.clearValue();
        screen.render();
        handleCommand(item.cmd);
      }
      hideCommandMenu();
      return;
    }

    if (!val) return;
    textbox.clearValue();
    screen.render();
    if (val.startsWith('/')) {
      handleCommand(val);
      return;
    }
    run(val).catch((e: unknown) => {
      useStore.getState().addMessage({ type: 'error', content: String(e) });
      useStore.getState().setRunning(false);
    });
  });

  // Scroll
  screen.key('pageup',   () => { msgBox.scroll(-Math.floor(H / 2)); screen.render(); });
  screen.key('pagedown', () => { msgBox.scroll( Math.floor(H / 2)); screen.render(); });
  screen.key('home',     () => { msgBox.setScrollPerc(0);   screen.render(); });
  screen.key('end',      () => { msgBox.setScrollPerc(100); screen.render(); });
}

// ─── Shutdown ──────────────────────────────────────────────────────────────

function shutdown(): void {
  stopSpin();
  try { screen.destroy(); } catch { /* ok */ }
  process.exit(0);
}

// ─── Main ──────────────────────────────────────────────────────────────────

function main(): void {
  // Suppress console output — blessed owns stdout
  const _origLog = console.log;
  console.log = () => {};
  process.on('exit', () => { console.log = _origLog; });

  useStore.getState().setTerminalSize(W, H);
  useStore.subscribe(scheduleRender);

  screen.on('resize', () => {
    W = (screen.width  as number) || 120;
    H = (screen.height as number) || 30;
    useStore.getState().setTerminalSize(W, H);
    render();
  });

  bindKeys();
  render();
  // Second render after terminal reports true dimensions
  setTimeout(render, 100);
  textbox.focus();

  // Async agent detection — doesn't block first paint
  Promise.resolve().then(() => checkAgentStatus());
  Promise.resolve().then(() => detectAndTrackAgents());

  process.stdin.resume();
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);
}

main();

export function startUI(): Promise<void> {
  return new Promise(() => {});
}

// Auto-start when run directly
const isMain = process.argv[1]?.includes('eamilos-ui') || process.argv[1]?.includes('dist');
if (isMain) { startUI(); }

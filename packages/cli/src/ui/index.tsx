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
 *   - ctrl+g toggles the sidebar (they use sidebar_toggle keybind)
 *   - Section headers have timestamp flush-right (they show timestamps below msgs)
 *   - Running state disables input and shows a spinner bar (same pattern)
 *   - Delayed second render for dimension accuracy on startup
 *   - No console.log while blessed owns stdout
 */

import blessed from 'blessed';
import { useStore }          from './state/store.js';
import { run, cancel }       from './hooks/useOrchestrator.js';
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
    oc:            state.agentStatus.opencode,
    gem:           state.agentStatus.gemini,
    callsigns:     _callsigns,
    graphStats:    state.graphStats,
    messageCount:  msgs.length,
    toolCount,
    conflictCount,
    strategy:      state.currentStrategy,
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

  // Toggle sidebar (ctrl+g — same slot as OpenCode's sidebar_toggle)
  screen.key('C-g', () => {
    useStore.getState().toggleGraphPanel();
    render();
  });

  // Submit
  textbox.key('enter', () => {
    const val = textbox.getValue().trim();
    if (!val) return;
    textbox.clearValue();
    screen.render();
    run(val).catch((e: unknown) => {
      useStore.getState().addMessage({ type: 'error', content: String(e) });
      useStore.getState().setRunning(false);
    });
  });

  // History (OpenCode: history_previous / history_next)
  textbox.key('up', () => {
    const last = useStore.getState().lastPrompt;
    if (last) { textbox.setValue(last); screen.render(); }
  });
  textbox.key('down', () => { textbox.clearValue(); screen.render(); });

  // Tab to cycle strategy (OpenCode: agent_cycle maps to Tab)
  textbox.key('tab', () => {
    if (textbox.getValue().length > 0) return;
    const cur  = useStore.getState().currentStrategy;
    const idx  = STRATS.indexOf(cur);
    const next = STRATS[(idx + 1) % STRATS.length]!;
    useStore.getState().setStrategy(next);
    render();
  });

  // Number keys 1-4 for strategy
  STRATS.forEach((strat, i) => {
    textbox.key(String(i + 1), () => {
      if (textbox.getValue().length === 0) {
        useStore.getState().setStrategy(strat);
        render();
      }
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

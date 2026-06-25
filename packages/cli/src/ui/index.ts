/**
 * EamilOS TUI — index.ts
 *
 * Layout map (rows, top → bottom):
 *
 *   0        ┌ status bar ─────────────────────────────────────────────────┐
 *   1        ├ thin rule ──────────────────────────────────────────────────┤
 *   2…H-6   │ scrollable message area                                     │
 *   H-5      ├ [graph panel — 3 rows when ctrl+g, hidden otherwise] ──────┤
 *   H-4      ├ thin rule ──────────────────────────────────────────────────┤
 *   H-3      ├ strategy bar ───────────────────────────────────────────────┤
 *   H-2      ├ input row (prompt ▸ textbox ▸ [enter]) / running bar ───────┤
 *   H-1      └ hint bar ───────────────────────────────────────────────────┘
 *
 * Philosophy:
 *   - All chrome is Text elements created ONCE, content swapped each frame.
 *   - No Box borders anywhere. Dividers are plain ─ characters in text.
 *   - Scroll via msgBox.scroll(); never destroy/recreate.
 *   - Spinner ticks via setInterval, partial refresh only on that path.
 *   - Full render on store change, debounced by setImmediate.
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
  renderGraphPanel,
  renderWelcome,
  renderRunningBar,
  tickSpinner,
  spinChar,
  rep,
} from './render.js';
import type { ExecutionStrategy } from './types/ui.js';

const VERSION = '1.4.0';
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
});

let W = (screen.width  as number) || 120;
let H = (screen.height as number) || 30;

// ─── Layout constants ──────────────────────────────────────────────────────

const CHROME_TOP    = 2;   // rows consumed at top (status + rule)
const CHROME_BOTTOM = 4;   // rows consumed at bottom (rule + strategy + input + hint)
const GRAPH_ROWS    = 4;   // rows used by expanded graph panel (+1 rule)

// ─── Helper: make a full-width text row ───────────────────────────────────

function row(top: number | string): blessed.Widgets.TextElement {
  return blessed.text({
    parent: screen,
    top,
    left:   0,
    width:  '100%',
    height: 1,
    tags:   true,
    style:  { fg: 'white' },
  });
}

// ─── Chrome elements — created once, content swapped each frame ────────────

const elStatus   = row(0);          // status bar
const elRule1    = row(1);          // top divider

// Graph panel — 3 text rows + 1 rule, hidden unless ctrl+g
const elGraph0   = row(0);          // graph header — position set in render()
const elGraph1   = row(0);          // graph rows
const elGraph2   = row(0);
const elGraph3   = row(0);
const elRuleG    = row(0);          // rule below graph

const elRuleBot  = row(0);          // rule above strategy
const elStrategy = row(0);          // strategy bar
const elInput    = row(0);          // running bar OR blank row behind textbox
const elHint     = row(0);          // hint bar

// ─── Scrollable message area ───────────────────────────────────────────────

const msgBox = blessed.box({
  parent:      screen,
  top:         CHROME_TOP,
  left:        0,
  width:       '100%',
  tags:        true,
  scrollable:  true,
  alwaysScroll:true,
  keys:        false,
  vi:          false,
  mouse:       true,
  style:       { scrollbar: { bg: '#333333' } },
  scrollbar:   {
    ch:    '┃',
    style: { fg: '#404040' },
    track: { bg: '#1a1a1a' },
  },
});

// ─── Input area — textbox + decorators ────────────────────────────────────
//
//  ▸  █cursor█___________________________________________  enter
//
// ▸ is the prompt glyph; the enter hint floats flush-right.

const promptGlyph = blessed.text({
  parent:  screen,
  tags:    true,
  top:     0,          // set in render()
  left:    0,
  width:   4,
  height:  1,
  content: ' {#00c8a0-fg}{bold}▸{/bold}{/} ',
});

const textbox = blessed.textbox({
  parent:       screen,
  top:          0,         // set in render()
  left:         4,
  width:        '100%-14',
  height:       1,
  inputOnFocus: true,
  style:        {
    fg:    '#d4d4d4',
    focus: { fg: 'white' },
  },
});

const enterHint = blessed.text({
  parent:  screen,
  tags:    true,
  top:     0,         // set in render()
  left:    '100%-10',
  width:   10,
  height:  1,
  content: '{#404040-fg} [enter] {/}',
  align:   'right',
});

// ─── Spinner ───────────────────────────────────────────────────────────────

let spinFrame  = 0;
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

// ─── Layout helper ────────────────────────────────────────────────────────

function layout(): {
  msgTop:    number;
  msgHeight: number;
  showGraph: boolean;
  graphTop:  number;
  ruleBot:   number;
  stratRow:  number;
  inputRow:  number;
  hintRow:   number;
} {
  const showGraph = useStore.getState().showGraphPanel;
  const graphRows = showGraph ? GRAPH_ROWS : 0;

  const hintRow   = H - 1;
  const inputRow  = H - 2;
  const stratRow  = H - 3;
  const ruleBot   = H - 4;
  const graphTop  = ruleBot - graphRows;   // = H-4-GRAPH_ROWS when shown, ignored when hidden
  const msgHeight = Math.max(ruleBot - CHROME_TOP - graphRows, 4);

  return {
    msgTop:    CHROME_TOP,
    msgHeight,
    showGraph,
    graphTop,
    ruleBot,
    stratRow,
    inputRow,
    hintRow,
  };
}

// ─── Content builders ─────────────────────────────────────────────────────

function buildMessages(): string {
  const state = useStore.getState();
  const msgs  = state.messages;
  const inner = Math.max(W - 2, 20);

  if (msgs.length === 0) {
    return renderWelcome(inner, layout().msgHeight).join('\n');
  }

  const lines: string[] = [];
  for (const msg of msgs) {
    lines.push(...messageToLines(msg, inner, spinFrame));
  }
  return lines.join('\n');
}

// ─── Full render ──────────────────────────────────────────────────────────

function render(): void {
  W = (screen.width  as number) || 120;
  H = (screen.height as number) || 30;

  const state = useStore.getState();
  const L     = layout();

  // ── Status bar
  elStatus.setContent(
    renderStatusBar(
      W,
      state.agentStatus.opencode,
      state.agentStatus.gemini,
      state.currentStrategy,
      state.graphStats,
      state.isRunning,
      VERSION,
    )
  );

  // ── Top divider
  elRule1.top = 1;
  elRule1.setContent('{#262626-fg}' + rep('─', W) + '{/}');

  // ── Message area
  msgBox.top    = L.msgTop;
  msgBox.height = L.msgHeight;
  msgBox.width  = W;
  msgBox.setContent(buildMessages());
  msgBox.setScrollPerc(100);

  // ── Graph panel
  if (L.showGraph) {
    const gLines = renderGraphPanel(state.graphStats, W);
    // Pad to 4 rows
    while (gLines.length < 4) gLines.push('');

    elGraph0.top = L.graphTop;     elGraph0.hidden = false;
    elGraph1.top = L.graphTop + 1; elGraph1.hidden = false;
    elGraph2.top = L.graphTop + 2; elGraph2.hidden = false;
    elGraph3.top = L.graphTop + 3; elGraph3.hidden = false;
    elRuleG.top  = L.ruleBot - 1;  elRuleG.hidden  = false;

    elGraph0.setContent(gLines[0] ?? '');
    elGraph1.setContent(gLines[1] ?? '');
    elGraph2.setContent(gLines[2] ?? '');
    elGraph3.setContent(gLines[3] ?? '');
    elRuleG.setContent('{#262626-fg}' + rep('─', W) + '{/}');
  } else {
    elGraph0.hidden = true;
    elGraph1.hidden = true;
    elGraph2.hidden = true;
    elGraph3.hidden = true;
    elRuleG.hidden  = true;
  }

  // ── Bottom rule
  elRuleBot.top = L.ruleBot;
  elRuleBot.setContent('{#262626-fg}' + rep('─', W) + '{/}');

  // ── Strategy bar
  elStrategy.top = L.stratRow;
  elStrategy.setContent(' ' + renderStrategyBar(state.currentStrategy));

  // ── Input row
  if (state.isRunning) {
    // Hide interactive elements, show running bar
    promptGlyph.hidden = true;
    textbox.hidden     = true;
    enterHint.hidden   = true;
    elInput.top = L.inputRow;
    elInput.setContent(renderRunningBar(spinFrame));
    startSpin();
  } else {
    stopSpin();
    promptGlyph.hidden = false;
    textbox.hidden     = false;
    enterHint.hidden   = false;
    promptGlyph.top  = L.inputRow;
    textbox.top      = L.inputRow;
    enterHint.top    = L.inputRow;
    textbox.width    = Math.max(W - 14, 20);
    elInput.top = L.inputRow;
    elInput.setContent('');
  }

  // ── Hint bar
  elHint.top = L.hintRow;
  elHint.setContent(renderHintBar());

  screen.render();
}

// ─── Partial refresh — spinner tick only ──────────────────────────────────

function partialRefresh(): void {
  const state = useStore.getState();
  if (state.isRunning) {
    elInput.setContent(renderRunningBar(spinFrame));
  }
  msgBox.setContent(buildMessages());
  msgBox.setScrollPerc(100);
  screen.render();
}

// ─── Store subscription — debounced by setImmediate ───────────────────────

let renderPending = false;
function scheduleRender(): void {
  if (renderPending) return;
  renderPending = true;
  setImmediate(() => {
    renderPending = false;
    render();
  });
}

// ─── Key bindings ─────────────────────────────────────────────────────────

function bindKeys(): void {
  // ── Global
  screen.key('C-c', () => {
    if (useStore.getState().isRunning) cancel();
    else shutdown();
  });
  screen.key('C-l', () => {
    useStore.getState().clearMessages();
    render();
  });
  screen.key('C-g', () => {
    useStore.getState().toggleGraphPanel();
    render();
  });

  // ── Submit
  textbox.key('enter', () => {
    const val = textbox.getValue().trim();
    if (!val) return;
    textbox.clearValue();
    screen.render();
    run(val).catch((e: unknown) => {
      useStore.getState().addMessage({
        type: 'error',
        content: String(e),
      });
      useStore.getState().setRunning(false);
    });
  });

  // ── History recall
  textbox.key('up', () => {
    const last = useStore.getState().lastPrompt;
    if (last) { textbox.setValue(last); screen.render(); }
  });
  textbox.key('down', () => { textbox.clearValue(); screen.render(); });

  // ── Strategy quick-select (1-4, only when input is empty)
  STRATS.forEach((strat, i) => {
    textbox.key(String(i + 1), () => {
      if (textbox.getValue().length === 0) {
        useStore.getState().setStrategy(strat);
        render();
      }
    });
  });

  // ── Scroll
  screen.key('pageup',   () => { msgBox.scroll(-Math.floor(H / 2)); screen.render(); });
  screen.key('pagedown', () => { msgBox.scroll( Math.floor(H / 2)); screen.render(); });
  screen.key('home',     () => { msgBox.setScrollPerc(0);   screen.render(); });
  screen.key('end',      () => { msgBox.setScrollPerc(100); screen.render(); });
}

// ─── Shutdown ─────────────────────────────────────────────────────────────

function shutdown(): void {
  stopSpin();
  try { screen.destroy(); } catch { /* ok */ }
  process.exit(0);
}

// ─── Main ─────────────────────────────────────────────────────────────────

function main(): void {
  useStore.getState().setTerminalSize(W, H);

  // Subscribe to store — full render on any state change
  useStore.subscribe(scheduleRender);

  screen.on('resize', () => {
    W = (screen.width  as number) || 120;
    H = (screen.height as number) || 30;
    useStore.getState().setTerminalSize(W, H);
    render();
  });

  bindKeys();
  render();
  textbox.focus();

  // Async agent detection — won't block initial render
  Promise.resolve().then(() => checkAgentStatus());

  process.stdin.resume();
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);
}

main();

export function startUI(): Promise<void> {
  return new Promise(() => {});
}

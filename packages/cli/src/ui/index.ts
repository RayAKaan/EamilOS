/**
 * EamilOS TUI  ·  blessed  ·  flat layout  ·  no boxes
 */

import blessed from 'blessed';
import { useStore }        from './state/store.js';
import { run, cancel }     from './hooks/useOrchestrator.js';
import { checkAgentStatus} from './hooks/useAgentStatus.js';
import {
  messageToLines,
  renderStatusBar,
  renderStrategyBar,
  renderHintBar,
  renderGraphLine,
  renderWelcome,
  tickSpinner,
  rep,
} from './render.js';
import type { ExecutionStrategy } from './types/ui.js';

const VERSION = '1.4.0';
const STRATS: ExecutionStrategy[] = ['opencode-first', 'gemini-first', 'parallel', 'swarm'];

// ─── Screen ────────────────────────────────────────────────────────────────

const screen = blessed.screen({
  smartCSR:     true,
  fullUnicode:  true,
  autoPadding:  false,
  title:        'EamilOS',
  resizeTimeout: 60,
});

// ─── Static layout elements ─────────────────────────────────────────────────
// We create these ONCE and update their content each frame.
// This avoids the destroy/recreate cycle entirely.

function makeLine(
  top: number | string,
  fg: string = 'white',
  bold = false,
): blessed.Widgets.TextElement {
  return blessed.text({
    parent: screen,
    top,
    left:   0,
    width:  '100%',
    height: 1,
    tags:   true,
    style:  { fg, bold },
  });
}

// We'll size these after we know the terminal dimensions.
let W = (screen.width  as number) || 120;
let H = (screen.height as number) || 30;

// ── chrome elements (always visible) ───────────────────────────────────────

const elStatus   = makeLine(0);                    // row 0  : status bar
const elDivider1 = makeLine(1, '240');             // row 1  : thin divider
const elStrategy = makeLine('100%-4', 'gray');     // 3rd from bottom
const elDivider2 = makeLine('100%-3', '240');      // 2nd from bottom (thin)
const elInput    = makeLine('100%-2');             // 2nd from bottom : input row
const elHint     = makeLine('100%-1', '240');      // very bottom: hints

// optional graph panel — shown just above strategy
const elGraph    = makeLine('100%-5', 'blue');
const elDivGraph = makeLine('100%-4', '240');      // divider below graph

// ── scrollable message area ─────────────────────────────────────────────────

const msgBox = blessed.box({
  parent:      screen,
  top:         2,
  left:        0,
  width:       '100%',
  tags:        true,
  scrollable:  true,
  alwaysScroll:true,
  keys:        true,
  vi:          false,
  mouse:       true,
  style:       { scrollbar: { bg: 'gray' } },
  scrollbar:   { ch: '\u2502', style: { fg: 'gray' } },
});

// ── input textbox ───────────────────────────────────────────────────────────

const promptEl = blessed.text({
  parent: screen,
  tags:   true,
  top:    '100%-2',
  left:   0,
  width:  3,
  height: 1,
  content: '{cyan-fg}{bold}>{/bold}{/}',
});

const textbox = blessed.textbox({
  parent:       screen,
  top:          '100%-2',
  left:         3,
  width:        '100%-12',
  height:       1,
  inputOnFocus: true,
  style:        { fg: 'white' },
});

const enterHint = blessed.text({
  parent:  screen,
  tags:    true,
  top:     '100%-2',
  left:    '100%-9',
  width:   9,
  height:  1,
  content: '{#404040-fg}[enter]{/}',
  align:   'right',
});

// ── spinner state ───────────────────────────────────────────────────────────

let spinFrame   = 0;
let spinTimer:   ReturnType<typeof setInterval> | null = null;

function startSpin(): void {
  if (spinTimer) return;
  spinTimer = setInterval(() => {
    spinFrame = (spinFrame + 1) % 4;
    tickSpinner();
    partialRefresh();
  }, 120);
}

function stopSpin(): void {
  if (spinTimer) { clearInterval(spinTimer); spinTimer = null; }
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function getLayout(): {
  msgTop: number; msgH: number;
  showGraph: boolean;
} {
  const showGraph = useStore.getState().showGraphPanel;
  const graphRows = showGraph ? 2 : 0;
  const msgTop    = 2;
  const msgH      = Math.max(H - 2 - graphRows - 1, 4);
  return { msgTop, msgH, showGraph };
}

function buildMsgContent(): string {
  const state  = useStore.getState();
  const msgs   = state.messages;
  const inner  = Math.max(W - 2, 20);

  if (msgs.length === 0) {
    return renderWelcome(inner, getLayout().msgH).join('\n');
  }

  const allLines: string[] = [];
  for (const msg of msgs) {
    allLines.push(...messageToLines(msg, inner, spinFrame));
  }
  return allLines.join('\n');
}

/** Full re-render of every element */
function render(): void {
  W = (screen.width  as number) || 120;
  H = (screen.height as number) || 30;

  const state   = useStore.getState();
  const layout  = getLayout();

  // ── status bar
  elStatus.setContent(
    renderStatusBar(W,
      state.agentStatus.opencode,
      state.agentStatus.gemini,
      state.currentStrategy,
      state.graphStats,
      state.isRunning,
      VERSION,
    )
  );
  elDivider1.setContent('{#282828-fg}' + rep('\u2500', W) + '{/}');
  elDivider1.top = 1;

  // ── message box bounds
  msgBox.top    = layout.msgTop;
  msgBox.height = layout.msgH;
  msgBox.width  = W;
  msgBox.setContent(buildMsgContent());
  msgBox.setScrollPerc(100);

  // ── graph panel
  if (layout.showGraph) {
    elGraph.top    = H - 5;
    elDivGraph.top = H - 4;
    elGraph.hidden    = false;
    elDivGraph.hidden = false;
    elGraph.setContent('  ' + renderGraphLine(state.graphStats));
    elDivGraph.setContent('{#282828-fg}' + rep('\u2500', W) + '{/}');
  } else {
    elGraph.hidden    = true;
    elDivGraph.hidden = true;
  }

  // ── strategy bar and divider
  elDivider2.top = H - 4;
  elDivider2.setContent('{#282828-fg}' + rep('\u2500', W) + '{/}');
  elStrategy.top = H - 3;
  elStrategy.setContent('  ' + renderStrategyBar(state.currentStrategy));

  // ── input area
  if (state.isRunning) {
    promptEl.hidden  = true;
    textbox.hidden   = true;
    enterHint.hidden = true;
    elInput.top = H - 2;
    elInput.setContent(
      '  {yellow-fg}' + ['|', '/', '-', '\\'][spinFrame] + '{/}  ' +
      '{#606060-fg}agents working   ctrl+c to cancel{/}'
    );
    startSpin();
  } else {
    stopSpin();
    elInput.top = H - 2;
    elInput.setContent('');
    promptEl.top  = H - 2;
    textbox.top   = H - 2;
    enterHint.top = H - 2;
    promptEl.hidden  = false;
    textbox.hidden   = false;
    enterHint.hidden = false;
    textbox.width = Math.max(W - 12, 20);
  }

  // ── hint bar
  elHint.top = H - 1;
  elHint.setContent('  ' + renderHintBar());

  screen.render();
}

/** Cheap refresh during spinner — only updates streaming content */
function partialRefresh(): void {
  const state = useStore.getState();

  if (state.isRunning) {
    elInput.setContent(
      '  {yellow-fg}' + ['|', '/', '-', '\\'][spinFrame] + '{/}  ' +
      '{#606060-fg}agents working   ctrl+c to cancel{/}'
    );
  }

  msgBox.setContent(buildMsgContent());
  msgBox.setScrollPerc(100);

  screen.render();
}

// ─── Store subscription ─────────────────────────────────────────────────────

let pending = false;
function scheduleRender(): void {
  if (pending) return;
  pending = true;
  setImmediate(() => {
    pending = false;
    render();
  });
}

// ─── Key bindings ───────────────────────────────────────────────────────────

function bindKeys(): void {
  // Global
  screen.key('C-c', () => {
    if (useStore.getState().isRunning) cancel();
    else shutdown();
  });
  screen.key('C-l', () => { useStore.getState().clearMessages(); render(); });
  screen.key('C-g', () => { useStore.getState().toggleGraphPanel(); render(); });

  // Textbox
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

  textbox.key('up', () => {
    const last = useStore.getState().lastPrompt;
    if (last) { textbox.setValue(last); screen.render(); }
  });

  textbox.key('down', () => { textbox.clearValue(); screen.render(); });

  // Strategy shortcuts (only when textbox is empty)
  STRATS.forEach((strat, i) => {
    textbox.key(String(i + 1), () => {
      if (textbox.getValue().length === 0) {
        useStore.getState().setStrategy(strat);
        render();
      }
    });
  });

  // Page scroll in message area
  screen.key('pageup',   () => { msgBox.scroll(-Math.floor(H / 2)); screen.render(); });
  screen.key('pagedown', () => { msgBox.scroll( Math.floor(H / 2)); screen.render(); });
}

// ─── Shutdown ───────────────────────────────────────────────────────────────

function shutdown(): void {
  stopSpin();
  try { screen.destroy(); } catch { /* ok */ }
  process.exit(0);
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main(): void {
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
  textbox.focus();

  checkAgentStatus();

  process.stdin.resume();
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);
}

main();

export function startUI(): Promise<void> {
  return new Promise(() => {});
}

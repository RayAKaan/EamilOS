/**
 * EamilOS TUI Entry Point — Pure Blessed, no JSX
 */
import blessed from 'blessed';
import { useStore } from './state/store.js';
import { run, cancel } from './hooks/useOrchestrator.js';
import { renderMessageBox, getMsgHeight } from './components/MessageBlock.js';
import type { ExecutionStrategy, Message } from './types/ui.js';

// ─── Screen singleton ─────────────────────────────────────────────────────────

const screen = blessed.screen({
  autoPadding: false,
  smartCSR: true,
  resizeTimeout: 100,
  fullUnicode: true,
  title: 'EamilOS',
  dockBorders: false,
  ignoreLocked: ['C-c'],
});

// Keep stdin alive so textbox can receive input
process.stdin.resume();
process.stdin.setRawMode?.(true);

// ─── Constants ────────────────────────────────────────────────────────────────

const STRATEGIES: ExecutionStrategy[] = [
  'opencode-first',
  'gemini-first',
  'parallel',
  'swarm',
];

const VERSION = '1.4.0';

const SPINNER = ['|', '/', '-', '\\'];
let spinnerFrame = 0;
let spinnerTimer: ReturnType<typeof setInterval> | null = null;

// ─── Spinner ──────────────────────────────────────────────────────────────────

function startSpinner(): void {
  if (spinnerTimer) return;
  spinnerTimer = setInterval(() => {
    spinnerFrame = (spinnerFrame + 1) % SPINNER.length;
    try {
      const s = SPINNER[spinnerFrame];
      // Find the spinner text in the input box and update it
      const inputBox = screen.children?.[screen.children.length - 1] as
        | { children?: Array<{ setContent?: (c: string) => void }> }
        | undefined;
      const spinnerChild = (inputBox as any)?.children?.[0];
      if (spinnerChild?.setContent) {
        spinnerChild.setContent(`  ${s} ${s} ${s} Agents working  --  Ctrl+C to cancel`);
      }
    } catch {
      stopSpinner();
    }
  }, 150);
}

function stopSpinner(): void {
  if (spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

function trunc(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '>';
}

function pad(str: string, len: number): string {
  return str.padEnd(len);
}

// ─── Clear screen safely ──────────────────────────────────────────────────────

function clearScreen(): void {
  const children = [...(screen.children ?? [])] as Array<{ destroy?: () => void; detach?: () => void }>;
  for (const child of children) {
    try { child.detach?.(); child.destroy?.(); } catch { /* ignore */ }
  }
}

// ─── Status bar ───────────────────────────────────────────────────────────────

function buildStatusBar(w: number): void {
  const { agentStatus, isRunning, currentStrategy, graphStats } = useStore.getState();

  const dotOC = agentStatus.opencode.status === 'offline' ? 'O' : '*';
  const dotGM = agentStatus.gemini.status === 'offline' ? 'O' : '*';
  const ocVer = agentStatus.opencode.version ?? '?';
  const gmVer = agentStatus.gemini.version ?? '?';
  const statusText = isRunning ? 'RUNNING' : 'READY';

  const left = ` EamilOS ${VERSION} [${statusText}] `;
  const right = ` strategy:${currentStrategy}  nodes:${graphStats.nodes} edges:${graphStats.edges} `;
  const avail = w - left.length - right.length;
  const centerTrunc = ` [${dotOC}]OpenCode v${ocVer}  [${dotGM}]Gemini v${gmVer} `.slice(0, Math.max(avail - 2, 10));

  const bar = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: w,
    height: 1,
    border: { type: 'line' },
    style: { border: { fg: 'gray' } },
  });

  blessed.text({
    parent: bar,
    top: 0,
    left: 0,
    width: w,
    content: trunc(left + centerTrunc + right.padStart(w - left.length - centerTrunc.length, ' '), w),
    style: { fg: 'cyan', bold: true },
  });
}

// ─── Message area ─────────────────────────────────────────────────────────────

function buildMessageArea(w: number, h: number): void {
  const { messages } = useStore.getState();

  if (messages.length === 0) {
    buildWelcome(w, h);
    return;
  }

  const hist = blessed.box({
    parent: screen,
    top: 1,
    left: 0,
    width: w,
    height: h - 1,
    scrollable: true,
    alwaysScroll: true,
  });

  let y = 0;
  for (const msg of messages) {
    renderMessageBox(hist, msg, w, y);
    y += getMsgHeight(msg, w);
  }

  // Scroll to bottom
  setTimeout(() => {
    try { hist.setScrollPerc(100); } catch { /* ignore */ }
  }, 50);
}

// ─── Welcome screen ───────────────────────────────────────────────────────────

function buildWelcome(w: number, h: number): void {
  const container = blessed.box({
    parent: screen,
    top: 1,
    left: 0,
    width: w,
    height: h - 1,
    align: 'center',
    valign: 'middle',
  });

  const boxW = Math.min(w - 8, 52);
  const boxH = 14;
  const boxLeft = Math.max(Math.floor((w - boxW) / 2), 0);
  const boxTop = Math.max(Math.floor((h - boxH) / 2) - 2, 0);

  const inner = blessed.box({
    parent: container,
    top: boxTop,
    left: boxLeft,
    width: boxW,
    height: boxH,
    border: { type: 'line' },
    style: { border: { fg: 'cyan' } },
  });

  const innerW = boxW - 4;
  const lines: Array<[string, blessed.Widgets.Color, boolean]> = [
    [pad('', innerW), 'cyan', false],
    [`  EamilOS  Multi-Agent Orchestrator  `, 'cyan', true],
    [`  v${VERSION}  `, 'cyan', false],
    [pad('', innerW), 'cyan', false],
    [`  OpenCode Agent  +  Gemini CLI Agent  `, 'white', false],
    [`  Graphify Knowledge Graph          `, 'white', false],
    [pad('', innerW), 'white', false],
    [`  Strategies:  `, 'gray', false],
    [`    [1] opencode-first   [2] gemini-first  `, 'gray', false],
    [`    [3] parallel         [4] swarm         `, 'gray', false],
    [pad('', innerW), 'white', false],
    [`  Type a prompt and press Enter to begin  `, 'gray', false],
    [pad('', innerW), 'cyan', false],
  ];

  lines.forEach(([content, fg, bold], i) => {
    blessed.text({
      parent: inner,
      top: i,
      left: 1,
      content,
      style: { fg, bold },
    });
  });
}

// ─── Input area ───────────────────────────────────────────────────────────────

function buildInputArea(w: number, bottomY: number): void {
  const { isRunning, currentStrategy } = useStore.getState();

  // Strategy bar
  const stratBar = blessed.box({
    parent: screen,
    top: bottomY,
    left: 0,
    width: w,
    height: 1,
    border: { type: 'line' },
    style: { border: { fg: 'gray' } },
  });

  const stratStr = STRATEGIES.map((s, i) => {
    const active = s === currentStrategy;
    return `[${i + 1}]${s}`;
  }).join('  ');

  blessed.text({
    parent: stratBar,
    top: 0,
    left: 1,
    content: ` Strategy: ${stratStr}`,
    style: { fg: 'gray' },
  });

  // Input box
  const inputBorderColor: blessed.Widgets.Color = isRunning ? 'yellow' : 'cyan';
  const inputBox = blessed.box({
    parent: screen,
    top: bottomY + 1,
    left: 0,
    width: w,
    height: 1,
    border: { type: 'line' },
    style: { border: { fg: inputBorderColor } },
  });

  if (isRunning) {
    blessed.text({
      parent: inputBox,
      top: 0,
      left: 1,
      content: `  ${SPINNER[0]} ${SPINNER[0]} ${SPINNER[0]} Agents working  --  Ctrl+C to cancel`,
      style: { fg: 'yellow' },
    });
    startSpinner();
  } else {
    stopSpinner();
    blessed.text({
      parent: inputBox,
      top: 0,
      left: 1,
      content: ' >',
      style: { fg: 'cyan', bold: true },
    });

    const textbox = blessed.textbox({
      parent: inputBox,
      left: 4,
      width: Math.max(w - 18, 20),
      height: 1,
      inputOnFocus: true,
      style: { fg: 'white' },
    });

    // Enter to submit
    textbox.key('enter', () => {
      const value = textbox.getValue().trim();
      if (!value) return;
      textbox.clearValue();
      textbox.blur();
      run(value);
    });

    // Up to recall last prompt
    textbox.key('up', () => {
      const last = useStore.getState().lastPrompt;
      if (last) textbox.setValue(last);
    });

    // Down to clear
    textbox.key('down', () => {
      textbox.clearValue();
    });

    // Strategy shortcuts 1-4
    STRATEGIES.forEach((s, i) => {
      textbox.key(String(i + 1), () => {
        if (textbox.getValue().length === 0) {
          useStore.getState().setStrategy(s);
          renderApp();
        }
      });
    });

    textbox.focus();
  }

  // Hint bar
  const hintsBar = blessed.box({
    parent: screen,
    top: bottomY + 2,
    left: 0,
    width: w,
    height: 1,
  });

  blessed.text({
    parent: hintsBar,
    content: trunc('  Up: repeat last  |  1-4: switch strategy  |  Ctrl+L: clear  |  Ctrl+G: graph  |  Ctrl+C: cancel/exit', w),
    style: { fg: 'gray' },
  });
}

// ─── Main render ──────────────────────────────────────────────────────────────

function renderApp(): void {
  try {
    stopSpinner();
    clearScreen();

    const state = useStore.getState();
    const w = state.terminalWidth;
    const h = state.terminalHeight;

    // Status bar
    buildStatusBar(w);

    // Message area (reserve bottom 3 rows for strategy + input + hints)
    const msgAreaHeight = h - 4;
    buildMessageArea(w, msgAreaHeight);

    // Bottom: strategy + input + hints
    const bottomY = h - 3;
    buildInputArea(w, bottomY);

    screen.render();
  } catch (err) {
    console.error('Render error:', err);
  }
}

// ─── Global key bindings (registered once, outside render cycle) ──────────────

screen.key('C-c', () => {
  const state = useStore.getState();
  if (state.isRunning) {
    cancel();
  } else {
    stopSpinner();
    try { screen.destroy(); } catch { /* ignore */ }
    process.exit(0);
  }
});

screen.key('C-l', () => {
  useStore.getState().clearMessages();
  renderApp();
});

screen.key('C-g', () => {
  useStore.getState().toggleGraphPanel();
  renderApp();
});

// ─── Store subscription for live updates ─────────────────────────────────────

let lastRenderHash = '';
let pendingRender = false;

useStore.subscribe(() => {
  if (pendingRender) return;
  pendingRender = true;

  setImmediate(() => {
    pendingRender = false;
    const state = useStore.getState();
    const hash = [
      state.messages.length,
      state.messages[state.messages.length - 1]?.content?.length ?? 0,
      state.isRunning ? 1 : 0,
      state.currentStrategy,
      screen.width,
      screen.height,
    ].join('|');

    if (hash !== lastRenderHash) {
      lastRenderHash = hash;
      renderApp();
    }
  });
});

// ─── Resize handler ───────────────────────────────────────────────────────────

screen.on('resize', () => {
  useStore.getState().setTerminalSize(screen.width as number, screen.height as number);
  renderApp();
});

// ─── Shutdown ─────────────────────────────────────────────────────────────────

function shutdown(): void {
  stopSpinner();
  try { screen.destroy(); } catch { /* ignore */ }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ─── Initialize and start ─────────────────────────────────────────────────────

useStore.getState().setTerminalSize(screen.width as number, screen.height as number);
renderApp();

export function startUI(): Promise<void> {
  return new Promise(() => {});
}

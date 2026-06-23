/**
 * EamilOS TUI — Pure Blessed, no React hooks
 */
import blessed from 'blessed';
import { useStore } from './state/store.js';
import { run, cancel } from './hooks/useOrchestrator.js';
import { renderMessageBox } from './components/MessageBlock.js';
import type { ExecutionStrategy, Message } from './types/ui.js';

const screen = blessed.screen({
  autoPadding: true,
  smartCSR: true,
  resizeTimeout: 100,
  fullUnicode: true,
  title: 'EamilOS',
});

let renderInterval: ReturnType<typeof setInterval> | null = null;
let lastRenderHash = '';

function renderApp(): void {
  const state = useStore.getState();
  const w = state.terminalWidth;
  const h = state.terminalHeight;
  const messages = state.messages;
  const isRunning = state.isRunning;
  const agentStatus = state.agentStatus;
  const strategy = state.currentStrategy;
  const graphStats = state.graphStats;
  const showGraphPanel = state.showGraphPanel;
  const version = '1.4.0';

  if (screen.children) {
    for (const child of screen.children as unknown as Array<{ destroy: () => void }>) {
      try { child.destroy(); } catch { /* ignore */ }
    }
  }

  // Status Bar
  const dotOC = agentStatus.opencode.status === 'offline' ? 'O' : '*';
  const dotGM = agentStatus.gemini.status === 'offline' ? 'O' : '*';
  const ocVer = agentStatus.opencode.version ?? '?';
  const gmVer = agentStatus.gemini.version ?? '?';
  const statusText = isRunning ? 'RUNNING' : 'READY';
  const left = ` EamilOS ${version} [${statusText}] `;
  const center = ` [${dotOC}]OpenCode v${ocVer}  [${dotGM}]Gemini v${gmVer} `;
  const right = ` strategy:${strategy}  nodes:${graphStats.nodes} edges:${graphStats.edges} `;
  const avail = w - left.length - right.length;
  const centerTrunc = center.length > avail - 2 ? center.slice(0, avail - 3) + '>' : center;
  const statusLine = left + centerTrunc + right.padStart(w - left.length - centerTrunc.length, ' ');

  const statusBar = blessed.box({ parent: screen, top: 0, left: 0, width: w, height: 1, border: { type: 'line' }, style: { border: { fg: 'gray' } } });
  blessed.text({ parent: statusBar, top: 0, left: 0, width: w, content: trunc(statusLine, w), fg: 'cyan', bold: true });

  // Message Area
  const histHeight = showGraphPanel ? h - 6 : h - 5;

  if (messages.length === 0) {
    const welcomeBox = blessed.box({ parent: screen, top: 1, left: 0, width: w, height: histHeight, align: 'center', valign: 'middle' });
    const borderBox = blessed.box({ parent: welcomeBox, top: 'center', left: 'center', width: Math.min(w - 4, 50), height: 12, border: { type: 'line' }, style: { border: { fg: 'cyan' } } });
    blessed.text({ parent: borderBox, top: 0, align: 'center', content: pad('', Math.min(w - 8, 46)), fg: 'cyan' });
    blessed.text({ parent: borderBox, top: 1, align: 'center', content: '  EamilOS  Multi-Agent Orchestrator  ', fg: 'cyan', bold: true });
    blessed.text({ parent: borderBox, top: 2, align: 'center', content: `  v${version}  `, fg: 'cyan' });
    blessed.text({ parent: borderBox, top: 4, align: 'center', content: '  OpenCode Agent  +  Gemini CLI Agent  ', fg: 'white' });
    blessed.text({ parent: borderBox, top: 5, align: 'center', content: '  Graphify Knowledge Graph          ', fg: 'white' });
    blessed.text({ parent: borderBox, top: 7, align: 'center', content: '  Strategies: opencode-first | gemini-first | parallel | swarm  ', fg: 'gray' });
    blessed.text({ parent: borderBox, top: 9, align: 'center', content: pad('', Math.min(w - 8, 46)), fg: 'cyan' });
  } else {
    const historyBox = blessed.box({ parent: screen, top: 1, left: 0, width: w, height: histHeight, scrollable: true, alwaysScroll: true });
    let y = 0;
    for (const msg of messages) {
      renderMessageBox(historyBox, msg, w, y);
      y += getMsgHeight(msg);
    }
    historyBox.setScrollPerc(100);
  }

  // Graph Panel
  if (showGraphPanel) {
    const panel = blessed.box({ parent: screen, top: h - 6, left: 0, width: w, height: 1, border: { type: 'line' }, style: { border: { fg: 'blue' } } });
    blessed.text({ parent: panel, content: `  GRAPHIFY  |  nodes: ${graphStats.nodes}  |  edges: ${graphStats.edges}  |  strategy: ${graphStats.strategy}  `, fg: 'blue', bold: true });
  }

  // Input Area
  const inputTop = h - (showGraphPanel ? 5 : 4);
  const inputArea = blessed.box({ parent: screen, top: inputTop, left: 0, width: w, height: 4 });

  const stratBar = blessed.box({ parent: inputArea, top: 0, left: 0, width: w, height: 1, border: { type: 'line' }, style: { border: { fg: 'gray' } } });
  blessed.text({ parent: stratBar, content: '  Strategy: [1]opencode-first  [2]gemini-first  [3]parallel  [4]swarm', fg: 'gray' });

  const inputBox = blessed.box({ parent: inputArea, top: 1, left: 0, width: w, height: 1, border: { type: 'line' }, style: { border: { fg: isRunning ? 'yellow' : 'cyan' } } });

  if (isRunning) {
    let frame = 0;
    const spinnerFrames = ['/', '-', '\\', '|'];
    blessed.text({ parent: inputBox, content: `  ${spinnerFrames[0]} ${spinnerFrames[0]} ${spinnerFrames[0]} Agents working  --  Ctrl+C to cancel`, fg: 'yellow' });
    const spinnerId = setInterval(() => {
      frame = (frame + 1) % 4;
      try {
        const el = inputBox.children?.[0] as { setContent: (c: string) => void } | undefined;
        el?.setContent(`  ${spinnerFrames[frame]} ${spinnerFrames[frame]} ${spinnerFrames[frame]} Agents working  --  Ctrl+C to cancel`);
      } catch { clearInterval(spinnerId); }
    }, 150);
  } else {
    blessed.text({ parent: inputBox, content: ' >', fg: 'cyan', bold: true });
    const input = blessed.textbox({ parent: inputBox, left: 3, width: w - 18, height: 1, style: { fg: 'white' }, inputOnFocus: true });

    input.key('enter', () => {
      const val = input.getValue().trim();
      if (!val) return;
      input.clearValue();
      input.blur();
      run(val);
      renderApp();
    });
    input.key('up', () => {
      const last = useStore.getState().lastPrompt;
      if (last) input.setValue(last);
    });
    input.key('down', () => { input.clearValue(); });
    ['1', '2', '3', '4'].forEach((num, i) => {
      input.key(num, () => {
        const strat: ExecutionStrategy[] = ['opencode-first', 'gemini-first', 'parallel', 'swarm'];
        useStore.getState().setStrategy(strat[i]);
        renderApp();
      });
    });
    input.focus();
  }

  blessed.text({ parent: inputArea, top: 2, left: 2, content: '  Up: repeat last  |  1-4: switch strategy  |  Ctrl+L: clear  |  Ctrl+G: graph  |  Ctrl+C: exit', fg: 'gray' });

  // Key handlers
  screen.unkey('C-c'); screen.unkey('C-l'); screen.unkey('C-g');
  screen.key('C-c', () => {
    if (useStore.getState().isRunning) { cancel(); renderApp(); }
    else { screen.destroy(); process.exit(0); }
  });
  screen.key('C-l', () => { useStore.getState().clearMessages(); renderApp(); });
  screen.key('C-g', () => { useStore.getState().toggleGraphPanel(); renderApp(); });

  screen.render();
}

function getMsgHeight(msg: Message): number {
  if (msg.type === 'user') return 2;
  if (msg.type === 'opencode' || msg.type === 'gemini') return 2 + (msg.tools?.length ?? 0) + (msg.isStreaming ? 1 : 0) + (msg.content.length > 0 ? 1 : 0);
  if (msg.type === 'system' || msg.type === 'error') return 2;
  if (msg.type === 'graph-stats') return 8;
  return 1;
}

function trunc(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max - 1) + '>';
}

function pad(str: string, len: number): string {
  return str.padEnd(len);
}

function initTerminalSize(): void {
  useStore.getState().setTerminalSize(screen.width, screen.height);
}

function startRenderLoop(): void {
  if (renderInterval) return;
  renderInterval = setInterval(() => {
    const state = useStore.getState();
    const hash = `${state.messages.length}|${state.isRunning}|${state.terminalWidth}|${state.terminalHeight}`;
    if (hash !== lastRenderHash) {
      lastRenderHash = hash;
      renderApp();
    }
  }, 100);
}

initTerminalSize();
renderApp();

screen.on('resize', () => {
  initTerminalSize();
  renderApp();
});

startRenderLoop();
process.stdin.resume();
process.on('SIGTERM', () => {
  if (renderInterval) clearInterval(renderInterval);
  try { screen.destroy(); } catch { /* ignore */ }
  process.exit(0);
});

export function startUI(): Promise<void> {
  return new Promise(() => {});
}

/**
 * EamilOS TUI — Borderless, plain text output
 */
import pkg from 'blessed';
const { screen, box, text, textbox } = pkg;
import { useStore } from './state/store.js';
import { run, cancel } from './hooks/useOrchestrator.js';
import type { ExecutionStrategy } from './types/ui.js';

// ─── Screen ────────────────────────────────────────────────────────────────────

const mainScreen = screen({
  autoPadding: false,
  smartCSR: true,
  resizeTimeout: 100,
  fullUnicode: true,
  title: 'EamilOS',
  dockBorders: false,
  ignoreLocked: ['C-c'],
});

process.stdin.resume();
process.stdin.setRawMode?.(true);

// ─── Constants ────────────────────────────────────────────────────────────────

const STRATEGIES: ExecutionStrategy[] = [
  'opencode-first',
  'gemini-first',
  'parallel',
  'swarm',
];
const SPINNER = ['|', '/', '-', '\\'];
const VERSION = '1.4.0';

let spinnerFrame = 0;
let spinnerTimer: ReturnType<typeof setInterval> | null = null;

// ─── Utilities ────────────────────────────────────────────────────────────────

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return h + ':' + m + ':' + s;
}

function trunc(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '>';
}

function pad(str: string, len: number): string {
  return str.padEnd(len);
}

function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    if (raw.length === 0) { lines.push(''); continue; }
    let remaining = raw;
    while (remaining.length > width) {
      lines.push(remaining.slice(0, width));
      remaining = remaining.slice(width);
    }
    if (remaining) lines.push(remaining);
  }
  return lines;
}

// ─── Layout dimensions ────────────────────────────────────────────────────────

const BOTTOM_H = 3; // strategy + input + hints

// ─── Render text lines ────────────────────────────────────────────────────────

function renderTextLines(
  container: ReturnType<typeof box>,
  lines: Array<{ text: string; fg?: string; bold?: boolean; dim?: boolean }>,
  startY: number,
  width: number,
  leftPad: number = 0
): number {
  let y = startY;
  for (const line of lines) {
    text({
      parent: container,
      top: y++,
      left: leftPad,
      width: width - leftPad,
      content: trunc(line.text, width - leftPad),
      style: {
        fg: (line.fg as 'cyan' | 'white' | 'gray' | 'green' | 'magenta' | 'yellow' | 'red' | 'blue') ?? 'white',
        bold: line.bold ?? false,
        dim: line.dim ?? false,
      },
    });
  }
  return y;
}

// ─── Main render ──────────────────────────────────────────────────────────────

function render(): void {
  const state = useStore.getState();
  const w = mainScreen.width as number;
  const h = mainScreen.height as number;
  const messages = state.messages;
  const isRunning = state.isRunning;

  // Clear
  const children = [...(mainScreen.children ?? [])] as Array<{ destroy?: () => void; detach?: () => void }>;
  for (const child of children) {
    try { child.detach?.(); child.destroy?.(); } catch { /* ignore */ }
  }

  // ── Status bar (row 0) ────────────────────────────────────────────────────
  const dotOC = state.agentStatus.opencode.status === 'offline' ? 'O' : '*';
  const dotGM = state.agentStatus.gemini.status === 'offline' ? 'O' : '*';
  const ocVer = state.agentStatus.opencode.version ?? '?';
  const gmVer = state.agentStatus.gemini.version ?? '?';
  const runLabel = isRunning ? 'RUNNING' : 'READY';

  const left = ' EamilOS ' + VERSION + ' [' + runLabel + '] ';
  const right = ' [' + dotOC + ']OpenCode v' + ocVer + '  [' + dotGM + ']Gemini v' + gmVer + '  strategy:' + state.currentStrategy + '  nodes:' + state.graphStats.nodes + ' edges:' + state.graphStats.edges;
  const statusLine = left + right.padStart(w - left.length, ' ');

  text({
    parent: mainScreen,
    top: 0,
    left: 0,
    width: w,
    content: trunc(statusLine, w),
    style: { fg: 'cyan', bold: true },
  });

  // ── Message area (rows 1 to h-BOTTOM_H-1) ─────────────────────────────────
  const msgEnd = h - BOTTOM_H;
  const msgHeight = msgEnd - 1;

  const msgBox = box({
    parent: mainScreen,
    top: 1,
    left: 0,
    width: w,
    height: msgHeight,
    scrollable: true,
    alwaysScroll: true,
  });

  if (messages.length === 0) {
    // Welcome screen
    const innerW = Math.min(w - 6, 50);
    const boxLeft = Math.max(Math.floor((w - innerW) / 2), 2);
    const boxTop = Math.max(Math.floor((msgHeight - 14) / 2), 2);

    renderTextLines(msgBox, [
      { text: pad('', innerW), fg: 'cyan' },
      { text: '  EamilOS  Multi-Agent Orchestrator', fg: 'cyan', bold: true },
      { text: '  v' + VERSION, fg: 'cyan' },
      { text: pad('', innerW), fg: 'cyan' },
      { text: '  OpenCode Agent  +  Gemini CLI Agent', fg: 'white' },
      { text: '  Graphify Knowledge Graph', fg: 'white' },
      { text: pad('', innerW), fg: 'white' },
      { text: '  Strategies:', fg: 'gray' },
      { text: '    [1] opencode-first   [2] gemini-first', fg: 'gray' },
      { text: '    [3] parallel         [4] swarm', fg: 'gray' },
      { text: pad('', innerW), fg: 'white' },
      { text: '  Type a prompt and press Enter', fg: 'gray' },
      { text: pad('', innerW), fg: 'cyan' },
    ], boxTop, w, boxLeft);
  } else {
    let y = 0;
    for (const msg of messages) {
      const ts = fmtTime(msg.timestamp);
      const innerW = w - 4;
      const contentLines = wrapText(msg.content ?? '', innerW);
      const tools = msg.tools ?? [];

      switch (msg.type) {
        case 'user': {
          y = renderTextLines(msgBox, [
            { text: ' YOU ' + '-'.repeat(innerW) + ' ' + ts, fg: 'green', bold: true },
          ], y, w, 0);
          for (const l of contentLines) {
            y = renderTextLines(msgBox, [{ text: ' ' + l, fg: 'white' }], y, w, 0);
          }
          y++;
          break;
        }
        case 'opencode':
        case 'gemini': {
          const color = msg.type === 'opencode' ? 'cyan' : 'magenta';
          const label = msg.type.toUpperCase();
          y = renderTextLines(msgBox, [
            { text: ' ' + label + ' ' + '-'.repeat(innerW) + ' ' + ts, fg: color, bold: true },
          ], y, w, 0);
          for (const l of contentLines) {
            y = renderTextLines(msgBox, [{ text: ' ' + l, fg: 'white' }], y, w, 0);
          }
          for (const tool of tools) {
            const icon = tool.status === 'done' ? '[+]' : tool.status === 'failed' ? '[-]' : tool.status === 'running' ? '[~]' : '[ ]';
            const iconFg = tool.status === 'done' ? 'green' : tool.status === 'failed' ? 'red' : tool.status === 'running' ? 'yellow' : 'gray';
            y = renderTextLines(msgBox, [
              { text: icon + ' ' + tool.name.padEnd(8) + trunc(tool.args, innerW - 14), fg: iconFg },
            ], y, w, 0);
          }
          if (msg.isStreaming) {
            y = renderTextLines(msgBox, [
              { text: ' [.....] ' + msg.type + ' working...', fg: color },
            ], y, w, 0);
          }
          y++;
          break;
        }
        case 'system':
        case 'error': {
          const color = msg.type === 'error' ? 'red' : 'yellow';
          const label = msg.type === 'error' ? 'ERROR' : 'SYS';
          y = renderTextLines(msgBox, [
            { text: ' ' + label + ' ' + '-'.repeat(innerW) + ' ' + ts, fg: color, bold: true },
          ], y, w, 0);
          for (const l of contentLines) {
            y = renderTextLines(msgBox, [{ text: ' ' + l, fg: color }], y, w, 0);
          }
          y++;
          break;
        }
        case 'graph-stats': {
          let stats: Record<string, unknown> = {};
          try { stats = JSON.parse(msg.content); } catch { /* ignore */ }
          const dur = typeof stats.duration === 'string' ? stats.duration as string : String(((stats.duration as number) ?? 0) / 1000) + 's';
          const result = (stats.validated as boolean) ? 'VALIDATED' : 'NOT VALIDATED';
          const resultFg = (stats.validated as boolean) ? 'green' : 'red';
          y = renderTextLines(msgBox, [
            { text: ' EXECUTION SUMMARY ' + '-'.repeat(Math.max(innerW - 19, 0)), fg: 'blue', bold: true },
          ], y, w, 0);
          y = renderTextLines(msgBox, [
            { text: '  Strategy   : ' + ((stats.strategy as string) ?? '?'), fg: 'white' },
            { text: '  Duration   : ' + dur, fg: 'white' },
            { text: '  Tools used : ' + String((stats.toolsUsed as number) ?? 0), fg: 'white' },
            { text: '  Graph nodes: ' + String((stats.nodes as number) ?? 0), fg: 'cyan' },
            { text: '  Graph edges: ' + String((stats.edges as number) ?? 0), fg: 'cyan' },
            { text: '  Result     : ' + result, fg: resultFg, bold: true },
          ], y, w, 0);
          y++;
          break;
        }
      }

      if (y >= msgHeight - 2) break;
    }
  }

  setTimeout(() => {
    try { msgBox.setScrollPerc(100); } catch { /* ignore */ }
  }, 50);

  // ── Strategy bar (row h-3) ────────────────────────────────────────────────
  const stratY = msgEnd;
  text({
    parent: mainScreen,
    top: stratY,
    left: 0,
    width: w,
    content: ' Strategy: ' + STRATEGIES.map((s, i) => '[' + (i + 1) + ']' + s).join('  '),
    style: { fg: 'gray' },
  });

  // ── Input row (row h-2) ───────────────────────────────────────────────────
  const inputY = stratY + 1;

  if (isRunning) {
    text({
      parent: mainScreen,
      top: inputY,
      left: 0,
      width: w,
      content: '  ' + SPINNER[spinnerFrame] + ' ' + SPINNER[spinnerFrame] + ' ' + SPINNER[spinnerFrame] + ' agents working  --  Ctrl+C to cancel',
      style: { fg: 'yellow' },
    });
    if (spinnerTimer) clearInterval(spinnerTimer);
    spinnerTimer = setInterval(() => {
      spinnerFrame = (spinnerFrame + 1) % SPINNER.length;
      try {
        const kids = (mainScreen.children ?? []) as Array<{ top?: number; setContent?: (c: string) => void }>;
        const el = kids.find(c => c.top === inputY);
        if (el?.setContent) {
          el.setContent('  ' + SPINNER[spinnerFrame] + ' ' + SPINNER[spinnerFrame] + ' ' + SPINNER[spinnerFrame] + ' agents working  --  Ctrl+C to cancel');
        }
      } catch {
        if (spinnerTimer) clearInterval(spinnerTimer);
      }
    }, 120);
  } else {
    if (spinnerTimer) { clearInterval(spinnerTimer); spinnerTimer = null; }
    text({
      parent: mainScreen,
      top: inputY,
      left: 0,
      width: w,
      content: ' >',
      style: { fg: 'cyan', bold: true },
    });

    const tb = textbox({
      parent: mainScreen,
      top: inputY,
      left: 3,
      width: Math.max(w - 6, 20),
      height: 1,
      inputOnFocus: true,
      style: { fg: 'white' },
    });

    tb.key('enter', () => {
      const val = tb.getValue().trim();
      if (!val) return;
      tb.clearValue();
      run(val);
    });

    tb.key('up', () => {
      const last = useStore.getState().lastPrompt;
      if (last) tb.setValue(last);
    });

    tb.key('down', () => {
      tb.clearValue();
    });

    STRATEGIES.forEach((s, i) => {
      tb.key(String(i + 1), () => {
        if (tb.getValue().length === 0) {
          useStore.getState().setStrategy(s);
          render();
        }
      });
    });

    tb.focus();
  }

  // ── Hints (row h-1) ───────────────────────────────────────────────────────
  const hintsY = inputY + 1;
  text({
    parent: mainScreen,
    top: hintsY,
    left: 0,
    width: w,
    content: trunc('  Up: repeat last  |  1-4: switch strategy  |  Ctrl+L: clear  |  Ctrl+G: graph  |  Ctrl+C: cancel/exit', w),
    style: { fg: 'gray', dim: true },
  });

  mainScreen.render();
}

// ─── Global keys ──────────────────────────────────────────────────────────────

mainScreen.key('C-c', () => {
  const st = useStore.getState();
  if (st.isRunning) { cancel(); render(); }
  else { if (spinnerTimer) clearInterval(spinnerTimer); try { mainScreen.destroy(); } catch { /* ignore */ } process.exit(0); }
});

mainScreen.key('C-l', () => {
  useStore.getState().clearMessages();
  render();
});

mainScreen.key('C-g', () => {
  useStore.getState().toggleGraphPanel();
  render();
});

// ─── Store subscription ───────────────────────────────────────────────────────

let lastHash = '';
let pending = false;

useStore.subscribe(() => {
  if (pending) return;
  pending = true;
  setImmediate(() => {
    pending = false;
    const st = useStore.getState();
    const hash = [
      st.messages.length,
      st.messages[st.messages.length - 1]?.content?.length ?? 0,
      st.isRunning ? 1 : 0,
      st.showGraphPanel ? 1 : 0,
      st.currentStrategy,
    ].join('|');
    if (hash !== lastHash) { lastHash = hash; render(); }
  });
});

// ─── Resize ───────────────────────────────────────────────────────────────────

mainScreen.on('resize', () => {
  const w = mainScreen.width as number;
  const h = mainScreen.height as number;
  useStore.getState().setTerminalSize(w, h);
  render();
});

// ─── Shutdown ─────────────────────────────────────────────────────────────────

function shutdown(): void {
  if (spinnerTimer) clearInterval(spinnerTimer);
  try { mainScreen.destroy(); } catch { /* ignore */ }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ─── Start / Export ────────────────────────────────────────────────────────────

export async function startUI(): Promise<void> {
  useStore.getState().setTerminalSize(mainScreen.width as number, mainScreen.height as number);
  render();
  console.log('EamilOS TUI started. Type a prompt and press Enter. Ctrl+C to exit.');
}

// Auto-start when run directly (not imported)
const isMain = process.argv[1] && (process.argv[1].includes('eamilos-ui') || process.argv[1].includes('dist'));
if (isMain) { startUI(); }

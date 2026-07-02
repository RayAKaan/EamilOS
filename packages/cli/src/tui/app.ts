import type { AppModel } from './model.js';
import { initialModel } from './model.js';
import { update } from './update.js';
import type { Msg } from './update.js';
import { buildFrame } from './view.js';
import { enterFullScreen, exitFullScreen, getTerminalSize, writeFrame, installCrashRecovery, onResize } from './terminal/surface.js';
import { startInput } from './terminal/input.js';
import type { KeyEvent } from './terminal/input.js';
import { tickSpin } from './theme.js';
import { startConsoleCapture, stopConsoleCapture, drainCapturedLogs } from './services/consoleCapture.js';
import { runAgentDetection, assignCallsigns } from './services/agentDetection.js';
import type { AgentEntry } from './model.js';
import { runSession } from './services/sessionBridge.js';

const VALID_STRATEGIES = ['single', 'single-fallback', 'fallback', 'swarm', 'manual'];

export function normalizeStrategyForSession(s: string): string {
  if (VALID_STRATEGIES.includes(s)) return s;
  return 'single-fallback';
}

export class EamilOSTuiApp {
  private model: AppModel;
  private frameInterval: ReturnType<typeof setInterval> | null = null;
  private logInterval: ReturnType<typeof setInterval> | null = null;
  private stopInput: (() => void) | null = null;
  private stopResize: (() => void) | null = null;
  private running = false;

  constructor() {
    const size = getTerminalSize();
    this.model = initialModel(size.width, size.height);
  }

  private dispatch(msg: Msg): void {
    this.model = update(this.model, msg);
  }

  private getModel(): AppModel {
    return this.model;
  }

  private onLog(text: string): void {
    this.dispatch({ type: 'LOG', text });
  }

  async start(): Promise<void> {
    startConsoleCapture();
    enterFullScreen();
    installCrashRecovery();

    this.stopResize = onResize((size) => {
      this.dispatch({ type: 'RESIZE', width: size.width, height: size.height });
    });

    this.stopInput = startInput((event: KeyEvent) => {
      this.handleKey(event);
    });

    this.frameInterval = setInterval(() => {
      this.renderFrame();
    }, 50);

    this.logInterval = setInterval(() => {
      const logs = drainCapturedLogs();
      for (const log of logs) {
        this.dispatch({ type: 'LOG', text: log });
      }
    }, 250);

    this.dispatch({ type: 'DETECTION_START' });

    try {
      const rawAgents = await runAgentDetection();
      const agents = assignCallsigns(rawAgents);
      this.dispatch({ type: 'DETECTION_COMPLETE', agents });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.dispatch({ type: 'DETECTION_FAILED', error: msg });
    }

    this.renderFrame();
  }

  private handleKey(event: KeyEvent): void {
    switch (event.type) {
      case 'char': {
        if (this.model.running) break;
        if (event.char >= '1' && event.char <= '5') {
          const pages: any[] = ['chat', 'logs', 'agents', 'sessions', 'terminals'];
          this.dispatch({ type: 'SET_PAGE', page: pages[parseInt(event.char) - 1] });
        } else {
          this.dispatch({ type: 'INPUT_CHAR', char: event.char });
        }
        break;
      }

      case 'enter': {
        if (this.model.running) break;
        const prompt = this.model.input.trim();
        if (!prompt) break;
        this.dispatch({ type: 'INPUT_CLEAR' });
        this.startSession(prompt);
        break;
      }

      case 'backspace':
        this.dispatch({ type: 'INPUT_BACKSPACE' });
        break;

      case 'escape':
        this.stop();
        break;

      case 'ctrl': {
        switch (event.key) {
          case 'c':
            if (this.model.running) {
              this.cancelSession();
            } else {
              this.stop();
            }
            break;
          case 's':
            this.dispatch({ type: 'TOGGLE_SIDEBAR' });
            break;
          case 'l':
            this.dispatch({ type: 'CLEAR_CHAT' });
            break;
          case 'p':
            this.dispatch({ type: 'INPUT_RECALL' });
            break;
        }
        break;
      }

      case 'tab': {
        const strats = ['single', 'single-fallback', 'fallback', 'swarm', 'manual'] as const;
        const idx = strats.indexOf(this.model.strategy);
        const next = strats[(idx + 1) % strats.length]!;
        this.dispatch({ type: 'SET_STRATEGY', strategy: next });
        break;
      }

      case 'pageup':
        this.dispatch({ type: 'SCROLL_UP', lines: 10 });
        break;

      case 'pagedown':
        this.dispatch({ type: 'SCROLL_DOWN', lines: 10 });
        break;

      case 'up':
        this.dispatch({ type: 'SCROLL_UP', lines: 1 });
        break;

      case 'down':
        this.dispatch({ type: 'SCROLL_DOWN', lines: 1 });
        break;
    }
  }

  private async startSession(prompt: string): Promise<void> {
    if (this.running) return;
    this.running = true;

    const agents = Array.from(this.model.agents.values()).filter(a => a.status === 'ready');
    const mode = agents.some(a => a.id === 'opencode' || a.id === 'claude-code' || a.id === 'aider')
      ? 'execution' : 'communication';

    try {
      await runSession(prompt, this.model.strategy, mode, {
        dispatch: (msg) => this.dispatch(msg),
        getModel: () => this.getModel(),
        onLog: (text) => this.onLog(text),
      });
    } finally {
      this.running = false;
    }
  }

  private cancelSession(): void {
    this.dispatch({ type: 'SESSION_ERROR', error: 'Cancelled by user' });
  }

  private renderFrame(): void {
    this.dispatch({ type: 'TICK' });
    const frame = buildFrame(this.model);
    writeFrame(frame);
  }

  stop(): void {
    if (this.frameInterval) {
      clearInterval(this.frameInterval);
      this.frameInterval = null;
    }
    if (this.logInterval) {
      clearInterval(this.logInterval);
      this.logInterval = null;
    }
    if (this.stopInput) {
      this.stopInput();
      this.stopInput = null;
    }
    if (this.stopResize) {
      this.stopResize();
      this.stopResize = null;
    }
    stopConsoleCapture();
    exitFullScreen();
    process.exit(0);
  }
}

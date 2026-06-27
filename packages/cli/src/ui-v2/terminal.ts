import { ANSI } from './theme.js';

interface ConsoleCapture {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

export class TerminalSurface {
  private stdin: NodeJS.ReadStream;
  private stdout: NodeJS.WriteStream;
  private stderr: NodeJS.WriteStream;
  private rawMode = false;
  private altScreen = false;
  private captured: ConsoleCapture | null = null;
  private onKeyBuffer: ((key: string) => void)[] = [];
  private onResizeBuffer: ((cols: number, rows: number) => void)[] = [];
  private _capturedLogs: string[] = [];
  private _originalConsole: ConsoleCapture | null = null;

  constructor() {
    this.stdin = process.stdin;
    this.stdout = process.stdout;
    this.stderr = process.stderr;
  }

  get cols(): number {
    return this.stdout.columns ?? 80;
  }

  get rows(): number {
    return this.stdout.rows ?? 24;
  }

  get capturedLogs(): string[] {
    return this._capturedLogs;
  }

  enterAltScreen(): void {
    if (this.altScreen) return;
    this.stdout.write(ANSI.alt);
    this.stdout.write(ANSI.cursorHide);
    this.altScreen = true;
  }

  exitAltScreen(): void {
    if (!this.altScreen) return;
    this.stdout.write(ANSI.cursorShow);
    this.stdout.write(ANSI.altExit);
    this.altScreen = false;
  }

  enableRawMode(): void {
    if (this.rawMode || !this.stdin.isTTY) return;
    this.stdin.setRawMode(true);
    this.stdin.resume();
    this.rawMode = true;

    this.stdin.on('data', (data: Buffer) => {
      const key = data.toString();
      for (const cb of this.onKeyBuffer) {
        cb(key);
      }
    });
  }

  disableRawMode(): void {
    if (!this.rawMode) return;
    this.stdin.setRawMode(false);
    this.stdin.pause();
    this.rawMode = false;
  }

  onKey(cb: (key: string) => void): () => void {
    this.onKeyBuffer.push(cb);
    return () => {
      this.onKeyBuffer = this.onKeyBuffer.filter(c => c !== cb);
    };
  }

  onResize(cb: (cols: number, rows: number) => void): () => void {
    this.onResizeBuffer.push(cb);
    const handler = () => {
      cb(this.cols, this.rows);
    };
    this.stdout.on('resize', handler);
    return () => {
      this.onResizeBuffer = this.onResizeBuffer.filter(c => c !== cb);
      this.stdout.off('resize', handler);
    };
  }

  write(text: string): void {
    this.stdout.write(text);
  }

  clear(): void {
    this.stdout.write(ANSI.clear + ANSI.cursorHome);
  }

  captureConsole(): void {
    if (this.captured) return;
    this._originalConsole = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      info: console.info.bind(console),
      debug: console.debug.bind(console),
    };

    const captured = this._capturedLogs;

    this.captured = {
      log: (...args: unknown[]) => {
        const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
        captured.push(msg);
      },
      warn: (...args: unknown[]) => {
        const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
        captured.push(`[WARN] ${msg}`);
      },
      error: (...args: unknown[]) => {
        const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
        captured.push(`[ERROR] ${msg}`);
      },
      info: (...args: unknown[]) => {
        const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
        captured.push(`[INFO] ${msg}`);
      },
      debug: (...args: unknown[]) => {
        const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
        captured.push(`[DEBUG] ${msg}`);
      },
    };

    console.log = this.captured.log.bind(this.captured);
    console.warn = this.captured.warn.bind(this.captured);
    console.error = this.captured.error.bind(this.captured);
    console.info = this.captured.info.bind(this.captured);
    console.debug = this.captured.debug.bind(this.captured);
  }

  restoreConsole(): void {
    if (!this.captured || !this._originalConsole) return;
    console.log = this._originalConsole.log;
    console.warn = this._originalConsole.warn;
    console.error = this._originalConsole.error;
    console.info = this._originalConsole.info;
    console.debug = this._originalConsole.debug;
    this.captured = null;
    this._originalConsole = null;
  }

  bindProcessExit(): void {
    const cleanup = () => {
      this.restoreConsole();
      this.disableRawMode();
      this.exitAltScreen();
    };

    process.on('SIGINT', () => {
      cleanup();
      process.exit(130);
    });

    process.on('SIGTERM', () => {
      cleanup();
      process.exit(143);
    });

    process.on('uncaughtException', (err) => {
      cleanup();
      console.error('Uncaught exception:', err);
      process.exit(1);
    });

    process.on('exit', () => {
      this.stdout.write(ANSI.cursorShow);
    });
  }
}

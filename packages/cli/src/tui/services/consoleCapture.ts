let _originalConsole: { log: typeof console.log; warn: typeof console.warn; error: typeof console.error; info: typeof console.info; debug: typeof console.debug } | null = null;
let _captured: string[] = [];
let _active = false;

export function startConsoleCapture(): void {
  if (_active) return;
  _active = true;
  _captured = [];

  _originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
  };

  const captured = _captured;

  console.log = (...args: unknown[]) => {
    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    captured.push(msg);
  };

  console.warn = (...args: unknown[]) => {
    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    captured.push(`[WARN] ${msg}`);
  };

  console.error = (...args: unknown[]) => {
    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    captured.push(`[ERROR] ${msg}`);
  };

  console.info = (...args: unknown[]) => {
    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    captured.push(`[INFO] ${msg}`);
  };

  console.debug = (...args: unknown[]) => {
    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    captured.push(`[DEBUG] ${msg}`);
  };
}

export function stopConsoleCapture(): void {
  if (!_active || !_originalConsole) return;
  _active = false;

  console.log = _originalConsole.log;
  console.warn = _originalConsole.warn;
  console.error = _originalConsole.error;
  console.info = _originalConsole.info;
  console.debug = _originalConsole.debug;

  _originalConsole = null;
}

export function drainCapturedLogs(): string[] {
  const logs = [..._captured];
  _captured = [];
  return logs;
}

export function isConsoleCaptureActive(): boolean {
  return _active;
}

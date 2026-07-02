// surface.ts — Terminal surface. Owns stdout. Manages alt screen + raw mode.
// No other module may call process.stdout.write directly.

import {
  ENTER_ALT_SCREEN, EXIT_ALT_SCREEN,
  HIDE_CURSOR, SHOW_CURSOR,
  CLEAR_SCREEN, CURSOR_HOME,
} from './ansi.js';

export interface TerminalSize {
  width:  number;
  height: number;
}

let _active = false;
const _resizeListeners: Array<(size: TerminalSize) => void> = [];

export function getTerminalSize(): TerminalSize {
  return {
    width:  process.stdout.columns || 80,
    height: process.stdout.rows    || 24,
  };
}

export function enterFullScreen(): void {
  if (_active) return;
  _active = true;

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  process.stdout.write(
    ENTER_ALT_SCREEN + HIDE_CURSOR + CLEAR_SCREEN + CURSOR_HOME,
  );

  process.stdout.on('resize', () => {
    const size = getTerminalSize();
    for (const fn of _resizeListeners) fn(size);
  });
}

export function exitFullScreen(): void {
  if (!_active) return;
  _active = false;
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch { /* ignore */ }
  process.stdout.write(SHOW_CURSOR + EXIT_ALT_SCREEN);
}

// Write a complete pre-built frame in one syscall.
export function writeFrame(frame: string): void {
  process.stdout.write(CURSOR_HOME + frame);
}

export function onResize(fn: (size: TerminalSize) => void): () => void {
  _resizeListeners.push(fn);
  return () => {
    const idx = _resizeListeners.indexOf(fn);
    if (idx !== -1) _resizeListeners.splice(idx, 1);
  };
}

export function installCrashRecovery(): void {
  const restore = () => { try { exitFullScreen(); } catch { /* ignore */ } };

  process.on('exit',              restore);
  process.on('SIGINT',            () => { restore(); process.exit(0); });
  process.on('SIGTERM',           () => { restore(); process.exit(0); });
  process.on('uncaughtException', (err) => {
    restore();
    process.stderr.write(`\nEamilOS: uncaught error: ${String(err)}\n`);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    restore();
    process.stderr.write(`\nEamilOS: unhandled rejection: ${String(reason)}\n`);
    process.exit(1);
  });
}

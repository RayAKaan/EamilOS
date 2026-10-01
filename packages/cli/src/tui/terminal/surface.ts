// surface.ts — Terminal surface. Owns stdout. Manages alt screen + raw mode.
// No other module may call process.stdout.write directly.

import {
  ENTER_ALT_SCREEN, EXIT_ALT_SCREEN,
  HIDE_CURSOR, SHOW_CURSOR,
  CLEAR_SCREEN, CURSOR_HOME,
} from './ansi.js';
import type { TerminalCapabilities } from './capabilities.js';
import { detectTerminalCapabilities } from './capabilities.js';

export interface TerminalSize {
  width: number;
  height: number;
}

let _active = false;
const _resizeListeners: Array<(size: TerminalSize) => void> = [];

export function getTerminalSize(): TerminalSize {
  return {
    width: process.stdout.columns || 80,
    height: process.stdout.rows || 24,
  };
}

export function enterFullScreen(capabilities: TerminalCapabilities = detectTerminalCapabilities()): void {
  if (_active) return;
  _active = true;

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  if (!process.stdout.isTTY) return;

  const useAlternateScreen = capabilities.alternateScreen && capabilities.mode !== 'inline';
  process.stdout.write(
    (useAlternateScreen ? ENTER_ALT_SCREEN : '') + HIDE_CURSOR + CLEAR_SCREEN + CURSOR_HOME,
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
  if (process.stdout.isTTY) process.stdout.write(SHOW_CURSOR + EXIT_ALT_SCREEN);
}

export function writeFrame(frame: string): void {
  if (!process.stdout.isTTY) return;
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

  process.on('exit', restore);
  process.on('SIGINT', () => { restore(); process.exit(0); });
  process.on('SIGTERM', () => { restore(); process.exit(0); });
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

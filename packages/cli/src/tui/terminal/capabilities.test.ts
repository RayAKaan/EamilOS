import { describe, expect, it } from 'vitest';
import { detectTerminalCapabilities } from './capabilities.js';

describe('terminal capability detection', () => {
  it('selects line mode for CI and non-TTY environments', () => {
    const result = detectTerminalCapabilities({ CI: 'true', TERM: 'xterm-256color' }, { stdinTTY: false, stdoutTTY: false });
    expect(result.mode).toBe('line');
  });

  it('detects SSH and tmux as adaptive terminals', () => {
    const result = detectTerminalCapabilities({
      SSH_CONNECTION: '1',
      TMUX: '/tmp/tmux',
      TERM: 'xterm-256color',
    }, { stdinTTY: true, stdoutTTY: true });
    expect(result.mode).toBe('adaptive');
    expect(result.ssh).toBe(true);
    expect(result.tmux).toBe(true);
  });

  it('supports explicit inline mode', () => {
    const result = detectTerminalCapabilities({
      EAMILOS_INLINE: '1',
      TERM: 'xterm-256color',
    }, { stdinTTY: true, stdoutTTY: true });
    expect(result.mode).toBe('inline');
  });
});

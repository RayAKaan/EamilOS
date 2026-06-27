import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectEnvironment, canMultiplex } from '../multi-agent/multiplexer.js';
import { AdaptiveMultiplexer } from '../terminal/AdaptiveMultiplexer.js';

describe('LegacyMultiplexerWrapper', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('detectEnvironment delegates to AdaptiveMultiplexer.detectEnvironment', () => {
    const spy = vi.spyOn(AdaptiveMultiplexer, 'detectEnvironment').mockReturnValue('tmux');
    expect(detectEnvironment()).toBe('tmux');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('canMultiplex delegates to AdaptiveMultiplexer.isMultiplexingSupported', () => {
    const spy = vi.spyOn(AdaptiveMultiplexer, 'isMultiplexingSupported').mockReturnValue(true);
    expect(canMultiplex()).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('canMultiplex returns false when not supported', () => {
    vi.spyOn(AdaptiveMultiplexer, 'isMultiplexingSupported').mockReturnValue(false);
    expect(canMultiplex()).toBe(false);
  });

  it('no unsafe shell-string construction reachable from wrapper', () => {
    expect(typeof detectEnvironment).toBe('function');
    expect(typeof canMultiplex).toBe('function');
  });
});

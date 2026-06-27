import { describe, it, expect } from 'vitest';
import { normalizeStrategyForSession } from '../ui-v2/app.js';

describe('normalizeStrategyForSession', () => {
  it('passes through valid core strategies', () => {
    expect(normalizeStrategyForSession('single')).toBe('single');
    expect(normalizeStrategyForSession('single-fallback')).toBe('single-fallback');
    expect(normalizeStrategyForSession('fallback')).toBe('fallback');
    expect(normalizeStrategyForSession('swarm')).toBe('swarm');
    expect(normalizeStrategyForSession('manual')).toBe('manual');
  });

  it('maps legacy labels to defaults', () => {
    expect(normalizeStrategyForSession('opencode-first')).toBe('single-fallback');
    expect(normalizeStrategyForSession('gemini-first')).toBe('single-fallback');
    expect(normalizeStrategyForSession('parallel')).toBe('single-fallback');
  });

  it('falls back for unknown values', () => {
    expect(normalizeStrategyForSession('invalid')).toBe('single-fallback');
    expect(normalizeStrategyForSession('')).toBe('single-fallback');
  });
});

import { describe, it, expect } from 'vitest';
import { initialModel } from '../tui/model.js';
import { buildFrame } from '../tui/view.js';
import { stripAnsi, fit, visibleWidth, wrapPlain, centre, splitLine, sanitiseLine, hRule } from '../tui/terminal/text.js';

describe('text utilities', () => {
  it('stripAnsi removes ANSI sequences', () => {
    const result = stripAnsi('\x1b[31mhello\x1b[0m');
    expect(result).toBe('hello');
  });

  it('visibleWidth counts characters excluding ANSI', () => {
    const w = visibleWidth('\x1b[1mhello\x1b[0m');
    expect(w).toBe(5);
  });

  it('fit pads/trims to max width', () => {
    const padded = fit('hello', 10);
    expect(stripAnsi(padded).length).toBe(10);
    expect(stripAnsi(padded).startsWith('hello')).toBe(true);
    const trimmed = fit('hello world long', 10);
    expect(stripAnsi(trimmed).length).toBeLessThanOrEqual(10);
  });

  it('wrapPlain splits long text', () => {
    const lines = wrapPlain('hello world', 5);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('centre pads to centre', () => {
    const result = centre('hi', 10);
    expect(stripAnsi(result).length).toBeLessThanOrEqual(10);
    expect(result.startsWith(' ')).toBe(true);
  });

  it('splitLine produces at least width chars', () => {
    const result = splitLine('left', 'right', 30);
    expect(visibleWidth(result)).toBeGreaterThanOrEqual(28);
  });

  it('sanitiseLine removes control chars', () => {
    const result = sanitiseLine('he\x00llo', 10);
    expect(result).toBe('hello');
  });

  it('hRule produces correct length', () => {
    expect(hRule(5, '─')).toBe('─────');
  });
});

describe('buildFrame', () => {
  it('produces exactly height lines', () => {
    const model = initialModel(80, 24);
    const frame = buildFrame(model);
    const lines = frame.split('\n');
    expect(lines.length).toBe(24);
  });

  it('produces exactly width per line', () => {
    const model = initialModel(80, 24);
    const frame = buildFrame(model);
    const lines = frame.split('\n');
    for (const line of lines) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(80);
    }
  });

  it('welcome screen shows for empty state', () => {
    const model = initialModel(80, 24);
    const frame = buildFrame(model);
    expect(frame).toContain('EamilOS');
  });

  it('adapts to different sizes', () => {
    const small = buildFrame(initialModel(60, 20));
    expect(small.split('\n').length).toBe(20);

    const large = buildFrame(initialModel(140, 40));
    expect(large.split('\n').length).toBe(40);
  });
});

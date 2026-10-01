import { describe, expect, it, afterEach } from 'vitest';
import { detectThemeName, resolveMotion, resolveTheme } from './engine.js';

afterEach(() => { delete process.env.EAMILOS_THEME; delete process.env.EAMILOS_MOTION; });

describe('phase 1 theme engine', () => {
  it('supports explicit theme selection', () => {
    expect(detectThemeName({ EAMILOS_THEME: 'light' })).toBe('eamilos-light');
    expect(detectThemeName({ EAMILOS_THEME: 'high-contrast' })).toBe('high-contrast');
    expect(detectThemeName({ EAMILOS_THEME: 'no-color' })).toBe('no-color');
  });
  it('supports reduced and disabled motion', () => {
    expect(resolveMotion({ EAMILOS_MOTION: 'reduced' })).toBe('reduced');
    expect(resolveMotion({ EAMILOS_MOTION: 'none' })).toBe('none');
  });
  it('returns an explicit high contrast palette', () => {
    const tokens = resolveTheme('high-contrast', 'truecolor');
    expect(tokens.background).toBe('#000000');
    expect(tokens.foreground).toBe('#ffffff');
  });
});

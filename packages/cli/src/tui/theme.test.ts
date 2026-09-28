import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { initialModel } from './model.js';
import { buildFrame } from './view.js';
import { colorDepth, resetColorDepth, onChrome, onPanel, onChat } from './theme.js';
import { layoutFor } from './layout.js';
import { renderSidebar } from './components/sidebar.js';
import { renderStatusBar } from './components/statusBar.js';

/** BG.BRIGHT_BLACK (CSI 100m) is what produced the grey slabs on Windows. */
const GREY_FILL = /\x1b\[100m/;
const ANY_BG_FILL = /\x1b\[4[0-7]m|\x1b\[10[0-7]m/;

describe('terminal colour depth', () => {
  const saved = { ...process.env };

  beforeEach(() => resetColorDepth());
  afterEach(() => {
    process.env = { ...saved };
    resetColorDepth();
  });

  it('detects truecolor from COLORTERM', () => {
    process.env.NO_COLOR = '';
    delete process.env.NO_COLOR;
    process.env.COLORTERM = 'truecolor';
    expect(colorDepth()).toBe('truecolor');
  });

  it('detects truecolor on Windows Terminal', () => {
    delete process.env.NO_COLOR;
    process.env.WT_SESSION = 'abc';
    process.env.COLORTERM = '';
    expect(colorDepth()).toBe('truecolor');
  });

  it('detects 256 colour from TERM', () => {
    delete process.env.NO_COLOR;
    delete process.env.WT_SESSION;
    process.env.COLORTERM = '';
    process.env.TERM = 'xterm-256color';
    expect(colorDepth()).toBe('ansi256');
  });

  it('falls back to 16 colour', () => {
    delete process.env.NO_COLOR;
    delete process.env.WT_SESSION;
    process.env.COLORTERM = '';
    process.env.TERM = 'xterm';
    expect(colorDepth()).toBe('ansi16');
  });

  it('honours NO_COLOR by emitting no fills at all', () => {
    process.env.NO_COLOR = '1';
    process.env.COLORTERM = 'truecolor';
    expect(colorDepth()).toBe('none');
    expect(onChrome('x')).not.toMatch(ANY_BG_FILL);
    expect(onPanel('x')).not.toMatch(ANY_BG_FILL);
    expect(onChat('x')).not.toMatch(ANY_BG_FILL);
  });
});

describe('no grey sidebar blocks', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.NO_COLOR = '';
    delete process.env.NO_COLOR;
    resetColorDepth();
  });
  afterEach(() => {
    process.env = { ...saved };
    resetColorDepth();
  });

  it('never emits BG.BRIGHT_BLACK in any frame region', () => {
    const m = initialModel(160, 40);
    const l = layoutFor(m);
    expect(renderStatusBar(m, l)).not.toMatch(GREY_FILL);
    expect(renderSidebar(m, l).join('\n')).not.toMatch(GREY_FILL);
    expect(buildFrame(m)).not.toMatch(GREY_FILL);
  });

  it('keeps the sidebar and chrome on distinct surfaces', () => {
    process.env.COLORTERM = 'truecolor';
    resetColorDepth();
    const m = initialModel(160, 40);
    const l = layoutFor(m);
    // A truecolor fill carries an explicit RGB value.
    expect(renderSidebar(m, l).join('\n')).toMatch(/\x1b\[48;2;13;16;20m/);
  });
});

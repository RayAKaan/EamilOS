// theme.ts — Semantic colour tokens, glyphs, and surface painting.
//
// Surfaces use truecolor when the terminal advertises it, 256-colour when it
// advertises 256, and plain 16-colour ANSI otherwise. On terminals that render
// background fills as visible grey blocks (or when NO_COLOR is set) we drop
// background shading entirely and rely on foreground weight plus rules.

import { FG, BG, BOLD, DIM, RESET, styled, CSI } from './terminal/ansi.js';

// ── Colour capability detection ───────────────────────────────────────────────
export type ColorDepth = 'truecolor' | 'ansi256' | 'ansi16' | 'none';

function detectColorDepth(): ColorDepth {
  if (process.env.NO_COLOR !== undefined) return 'none';
  if (process.env.EAMILOS_ASCII === '1') return 'ansi16';
  const colorterm = process.env.COLORTERM ?? '';
  if (/truecolor|24bit/i.test(colorterm)) return 'truecolor';
  if (process.env.WT_SESSION) return 'truecolor'; // Windows Terminal
  if (/-256(color)?$/i.test(process.env.TERM ?? '')) return 'ansi256';
  if (process.env.TERM === 'dumb') return 'none';
  return 'ansi16';
}

let _depth: ColorDepth | null = null;

/** Cached capability. Tests can call resetColorDepth() after changing env. */
export function colorDepth(): ColorDepth {
  if (_depth === null) _depth = detectColorDepth();
  return _depth;
}

export function resetColorDepth(): void {
  _depth = null;
}

function truecolor(isForeground: boolean, r: number, g: number, b: number): string {
  return `${CSI}${isForeground ? 38 : 48};2;${r};${g};${b}m`;
}

function bg256(n: number): string {
  return `${CSI}48;5;${n}m`;
}

/**
 * Surface fills are opt-out. A neutral dark-grey fill (#111418) on a truecolor
 * terminal keeps the panel hierarchy, while 16-colour terminals get no fill so
 * BG.BRIGHT_BLACK can never render as a light grey slab.
 */
function surfaceFill(r: number, g: number, b: number, ansi256Index: number): string {
  switch (colorDepth()) {
    case 'truecolor': return truecolor(false, r, g, b);
    case 'ansi256':   return bg256(ansi256Index);
    default:          return '';
  }
}

const SURFACE_CHROME_RGB  = [17, 20, 24] as const;  // #111418
const SURFACE_PANEL_RGB   = [13, 16, 20] as const;  // #0d1014
const SURFACE_CHAT_RGB    = [0, 0, 0] as const;       // #000000
const CHROME_256 = 234;
const PANEL_256  = 233;
const CHAT_256   = 232;

// ── Background shade hierarchy ────────────────────────────────────────────────
export const SURFACE = {
  get chat()    { return surfaceFill(...SURFACE_CHAT_RGB,   CHAT_256);   },
  get chrome()  { return surfaceFill(...SURFACE_CHROME_RGB, CHROME_256); },
  get sidebar() { return surfaceFill(...SURFACE_PANEL_RGB,  PANEL_256);  },
  get sep()     { return surfaceFill(...SURFACE_CHAT_RGB,   CHAT_256);   },
  get active()  { return surfaceFill(...SURFACE_PANEL_RGB,  PANEL_256);  },
} as const;

// ── Foreground palette ────────────────────────────────────────────────────────
export const C = {
  brand:         BOLD + FG.CYAN,
  brandPlain:    FG.CYAN,

  primary:       FG.BRIGHT_WHITE,
  secondary:     FG.WHITE,
  muted:         DIM + FG.WHITE,
  label:         DIM + FG.BRIGHT_BLACK,
  value:         FG.BRIGHT_WHITE,
  subtle:        DIM + FG.BRIGHT_BLACK,

  agentOC:       FG.CYAN,
  agentCC:       FG.BRIGHT_MAGENTA,
  agentGem:      FG.MAGENTA,
  agentAid:      FG.YELLOW,
  agentGoose:    FG.BRIGHT_GREEN,
  agentCodex:    FG.BRIGHT_CYAN,
  agentOther:    FG.WHITE,

  user:          FG.BRIGHT_YELLOW,
  userBold:      BOLD + FG.BRIGHT_YELLOW,

  ok:            FG.GREEN,
  okBold:        BOLD + FG.GREEN,
  warn:          FG.YELLOW,
  warnBold:      BOLD + FG.YELLOW,
  err:           FG.RED,
  errBold:       BOLD + FG.RED,
  info:          FG.CYAN,
  infoBold:      BOLD + FG.CYAN,

  cursor:        BOLD + BG.BRIGHT_WHITE + FG.BLACK,
  reset:         RESET,
} as const;

// ── Status dots ───────────────────────────────────────────────────────────────
export const DOT = {
  ready:   styled('●', FG.GREEN),
  busy:    styled('◉', FG.YELLOW),
  offline: styled('○', DIM, FG.WHITE),
  absent:  styled('·', DIM, FG.BRIGHT_BLACK),
  err:     styled('✖', FG.RED),
} as const;

// ── Spinner ───────────────────────────────────────────────────────────────────
export const SPINNER = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'] as const;
let _spinIdx = 0;
export function tickSpin(): void        { _spinIdx = (_spinIdx + 1) % SPINNER.length; }
export function spin(): string          { return SPINNER[_spinIdx] ?? '⠋'; }
export function spinAt(f: number): string { return SPINNER[f % SPINNER.length] ?? '⠋'; }

// ── Agent colour resolver ─────────────────────────────────────────────────────
export function colourFor(agentId: string): string {
  switch (agentId) {
    case 'opencode':    return C.agentOC;
    case 'claude-code': return C.agentCC;
    case 'gemini-cli':  return C.agentGem;
    case 'aider':       return C.agentAid;
    case 'goose':       return C.agentGoose;
    case 'codex-cli':   return C.agentCodex;
    default:            return C.agentOther;
  }
}

// ── Style helpers ─────────────────────────────────────────────────────────────
export const style = {
  brand:    (s: string) => styled(s, BOLD, FG.CYAN),
  ok:       (s: string) => styled(s, BOLD, FG.GREEN),
  warn:     (s: string) => styled(s, FG.YELLOW),
  err:      (s: string) => styled(s, BOLD, FG.RED),
  info:     (s: string) => styled(s, FG.CYAN),
  muted:    (s: string) => styled(s, DIM, FG.WHITE),
  label:    (s: string) => styled(s, DIM, FG.BRIGHT_BLACK),
  value:    (s: string) => styled(s, FG.BRIGHT_WHITE),
  user:     (s: string) => styled(s, FG.BRIGHT_YELLOW),
  agent:    (id: string, s: string) => styled(s, colourFor(id)),
  dim:      (s: string) => styled(s, DIM, FG.WHITE),
  bold:     (s: string) => styled(s, BOLD, FG.BRIGHT_WHITE),
  sep:      (s: string) => styled(s, DIM, FG.BRIGHT_BLACK),
  kbd:      (s: string) => styled(s, BOLD, FG.BRIGHT_WHITE),
  kbdHint:  (s: string) => styled(s, DIM, FG.BRIGHT_BLACK),
} as const;

// ── Surface painters ──────────────────────────────────────────────────────────
export function onChrome(text: string): string {
  const fill = SURFACE.chrome;
  return fill ? `${fill}${text}${RESET}` : text;
}

export function onPanel(text: string): string {
  const fill = SURFACE.sidebar;
  return fill ? `${fill}${text}${RESET}` : text;
}

export function onChat(text: string): string {
  const fill = SURFACE.chat;
  return fill ? `${fill}${text}${RESET}` : text;
}

export type MotionMode='full'|'reduced';
export type GlyphMode='unicode'|'ascii';
export function motionMode():MotionMode{return process.env.EAMILOS_REDUCED_MOTION==='1'?'reduced':'full';}
export function glyphMode():GlyphMode{return process.env.EAMILOS_ASCII==='1'?'ascii':'unicode';}
export const GLYPH={ok:()=>glyphMode()==='ascii'?'[OK]':'✓',active:()=>glyphMode()==='ascii'?'[*]':'●',pending:()=>glyphMode()==='ascii'?'[ ]':'○',arrow:()=>glyphMode()==='ascii'?'>':'→',error:()=>glyphMode()==='ascii'?'[!]':'!'};

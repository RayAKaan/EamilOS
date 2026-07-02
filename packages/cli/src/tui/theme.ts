// theme.ts — All colours, glyphs, and background shades.
// Background hierarchy: BG0 (darkest) → BG1 → BG2 → BG3 (lightest surface)

import { FG, BG, BOLD, DIM, RESET, styled } from './terminal/ansi.js';

// ── Background shade hierarchy ────────────────────────────────────────────────
// We only have 16 ANSI colours, so we use the available darks carefully.
// BG.BLACK        = true black     — main chat area (recedes)
// BG.BRIGHT_BLACK = dark grey      — status bar, input bar, sidebar
// (inline bright on top of dark grey for "lifted" elements)

export const SURFACE = {
  // The main chat viewport — darkest, content reads on it
  chat:      BG.BLACK,
  // Status bar and input bar — one step lighter, clearly chrome
  chrome:    BG.BRIGHT_BLACK,
  // Sidebar — same as chrome, unified panel feel
  sidebar:   BG.BRIGHT_BLACK,
  // Separator rows (top rule, bottom rule) — slightly distinct
  sep:       BG.BLACK,
  // Inline highlight: selected/active item in sidebar
  active:    BG.BLACK,
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

// ── Surface painter ───────────────────────────────────────────────────────────
// Paints a full-width line with a background shade.
// All chrome components call this instead of writing raw BG codes.
export function onChrome(text: string): string {
  return `${BG.BRIGHT_BLACK}${text}${RESET}`;
}

export function onChat(text: string): string {
  return `${BG.BLACK}${text}${RESET}`;
}

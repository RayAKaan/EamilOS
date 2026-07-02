// ansi.ts — ANSI escape sequences, single source of truth.
// No other file may write escape codes directly.

export const ESC = '\x1b';
export const CSI = `${ESC}[`;

// ── Screen control ──────────────────────────────────────────────────────────
export const ENTER_ALT_SCREEN = `${CSI}?1049h`;
export const EXIT_ALT_SCREEN  = `${CSI}?1049l`;
export const HIDE_CURSOR      = `${CSI}?25l`;
export const SHOW_CURSOR      = `${CSI}?25h`;
export const CLEAR_SCREEN     = `${CSI}2J`;
export const CURSOR_HOME      = `${CSI}H`;
export const CLEAR_LINE       = `${CSI}2K`;
export const ERASE_TO_END     = `${CSI}0K`;

// ── Cursor movement ─────────────────────────────────────────────────────────
export const moveTo = (row: number, col: number): string =>
  `${CSI}${row};${col}H`;
export const moveUp    = (n: number): string => `${CSI}${n}A`;
export const moveDown  = (n: number): string => `${CSI}${n}B`;
export const moveRight = (n: number): string => `${CSI}${n}C`;
export const moveLeft  = (n: number): string => `${CSI}${n}D`;

// ── Reset ───────────────────────────────────────────────────────────────────
export const RESET = `${CSI}0m`;

// ── Text attributes ─────────────────────────────────────────────────────────
export const BOLD      = `${CSI}1m`;
export const DIM       = `${CSI}2m`;
export const ITALIC    = `${CSI}3m`;
export const UNDERLINE = `${CSI}4m`;
export const BLINK     = `${CSI}5m`;
export const REVERSE   = `${CSI}7m`;
export const STRIKETHROUGH = `${CSI}9m`;

// ── Standard foreground colours (16-colour, max terminal compat) ────────────
export const FG = {
  BLACK:          `${CSI}30m`,
  RED:            `${CSI}31m`,
  GREEN:          `${CSI}32m`,
  YELLOW:         `${CSI}33m`,
  BLUE:           `${CSI}34m`,
  MAGENTA:        `${CSI}35m`,
  CYAN:           `${CSI}36m`,
  WHITE:          `${CSI}37m`,
  BRIGHT_BLACK:   `${CSI}90m`,
  BRIGHT_RED:     `${CSI}91m`,
  BRIGHT_GREEN:   `${CSI}92m`,
  BRIGHT_YELLOW:  `${CSI}93m`,
  BRIGHT_BLUE:    `${CSI}94m`,
  BRIGHT_MAGENTA: `${CSI}95m`,
  BRIGHT_CYAN:    `${CSI}96m`,
  BRIGHT_WHITE:   `${CSI}97m`,
  DEFAULT:        `${CSI}39m`,
} as const;

// ── Standard background colours ─────────────────────────────────────────────
export const BG = {
  BLACK:          `${CSI}40m`,
  RED:            `${CSI}41m`,
  GREEN:          `${CSI}42m`,
  YELLOW:         `${CSI}43m`,
  BLUE:           `${CSI}44m`,
  MAGENTA:        `${CSI}45m`,
  CYAN:           `${CSI}46m`,
  WHITE:          `${CSI}47m`,
  BRIGHT_BLACK:   `${CSI}100m`,
  BRIGHT_RED:     `${CSI}101m`,
  BRIGHT_GREEN:   `${CSI}102m`,
  BRIGHT_YELLOW:  `${CSI}103m`,
  BRIGHT_BLUE:    `${CSI}104m`,
  BRIGHT_MAGENTA: `${CSI}105m`,
  BRIGHT_CYAN:    `${CSI}106m`,
  BRIGHT_WHITE:   `${CSI}107m`,
  DEFAULT:        `${CSI}49m`,
} as const;

// ── Composable helpers ───────────────────────────────────────────────────────
export function styled(text: string, ...codes: string[]): string {
  return `${codes.join('')}${text}${RESET}`;
}

export function bold(text: string): string {
  return `${BOLD}${text}${RESET}`;
}

export function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

export function italic(text: string): string {
  return `${ITALIC}${text}${RESET}`;
}

export function underline(text: string): string {
  return `${UNDERLINE}${text}${RESET}`;
}

export function fg(code: string, text: string): string {
  return `${code}${text}${RESET}`;
}

export function bg(code: string, text: string): string {
  return `${code}${text}${RESET}`;
}

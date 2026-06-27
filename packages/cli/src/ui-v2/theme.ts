export const theme = {
  accent: 81,
  accent2: 141,
  ok: 82,
  warn: 214,
  err: 203,
  border: 239,
  muted: 244,
  text: 252,
  bg: 235,
  bg2: 236,
  bg3: 237,
} as const;

export function ansi(code: number, text: string): string {
  return `\x1b[38;5;${code}m${text}\x1b[0m`;
}

export function ansiBg(code: number, text: string): string {
  return `\x1b[48;5;${code}m${text}\x1b[0m`;
}

export function bold(text: string): string {
  return `\x1b[1m${text}\x1b[22m`;
}

export function dim(text: string): string {
  return `\x1b[2m${text}\x1b[22m`;
}

export function underline(text: string): string {
  return `\x1b[4m${text}\x1b[24m`;
}

export function rgb(r: number, g: number, b: number, text: string): string {
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

export const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  clear: '\x1b[2J',
  clearLine: '\x1b[2K',
  cursorHome: '\x1b[H',
  cursorHide: '\x1b[?25l',
  cursorShow: '\x1b[?25h',
  alt: '\x1b[?1049h',
  altExit: '\x1b[?1049l',
  save: '\x1b[s',
  restore: '\x1b[u',
  scrollUp: '\x1b[S',
  scrollDown: '\x1b[T',
} as const;

export function ansiFg(c: number): string {
  return `\x1b[38;5;${c}m`;
}

export function ansiBgCode(c: number): string {
  return `\x1b[48;5;${c}m`;
}

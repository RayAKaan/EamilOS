// text.ts — Text utilities: strip ANSI, visible width, truncate, fit, wrap, centre.
// Pure functions — no I/O, no imports from other TUI modules.

// ── ANSI strip ───────────────────────────────────────────────────────────────
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

// ── Visible width (printable columns) ───────────────────────────────────────
export function visibleWidth(s: string): number {
  return stripAnsi(s).length;
}

// ── Truncate to visible width, preserving escape codes ──────────────────────
export function truncate(s: string, maxW: number): string {
  if (maxW <= 0) return '';
  const plain = stripAnsi(s);
  if (plain.length <= maxW) return s;

  // Walk raw string, counting visible chars
  let visible = 0;
  let i = 0;
  let out = '';
  const ansiRe = /\x1b\[[0-9;]*[A-Za-z]/g;
  ansiRe.lastIndex = 0;

  while (i < s.length && visible < maxW) {
    ansiRe.lastIndex = i;
    const m = ansiRe.exec(s);
    if (m && m.index === i) {
      out += m[0];
      i += m[0].length;
    } else {
      out += s[i];
      visible++;
      i++;
    }
  }
  return out;
}

// ── Fit: pad or truncate to exactly `width` visible chars ───────────────────
export function fit(s: string, width: number): string {
  if (width <= 0) return '';
  const plain = stripAnsi(s);
  const vw = plain.length;
  if (vw === width) return s;
  if (vw > width)   return truncate(s, width);
  return s + ' '.repeat(width - vw);
}

// ── Centre a string within `width` columns ──────────────────────────────────
export function centre(s: string, width: number): string {
  const vw = visibleWidth(s);
  if (vw >= width) return s;
  const total = width - vw;
  const left  = Math.floor(total / 2);
  const right = total - left;
  return ' '.repeat(left) + s + ' '.repeat(right);
}

// ── Right-align a string within `width` columns ──────────────────────────────
export function rightAlign(s: string, width: number): string {
  const vw = visibleWidth(s);
  if (vw >= width) return s;
  return ' '.repeat(width - vw) + s;
}

// ── Split a line: left flush, right flush, padded between ───────────────────
export function splitLine(left: string, right: string, width: number): string {
  const lw = visibleWidth(left);
  const rw = visibleWidth(right);
  const gap = width - lw - rw;
  if (gap <= 0) return truncate(left, width - rw) + right;
  return left + ' '.repeat(gap) + right;
}

// ── Horizontal rule ─────────────────────────────────────────────────────────
export function hRule(width: number, ch = '─'): string {
  return ch.repeat(Math.max(0, width));
}

// ── Wrap plain text to width (no ANSI in input expected) ────────────────────
export function wrapPlain(text: string, width: number): string[] {
  if (width <= 0) return [];
  if (!text.trim()) return [];

  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') {
      lines.push('');
      continue;
    }
    const words = paragraph.split(' ');
    let current = '';
    for (const word of words) {
      if (!word) continue;
      if (current.length === 0) {
        current = word.slice(0, width);
      } else if (current.length + 1 + word.length <= width) {
        current += ' ' + word;
      } else {
        lines.push(current);
        current = word.slice(0, width);
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

// ── Sanitise a line: strip control chars except ANSI sequences ──────────────
export function sanitiseLine(s: string, maxW: number): string {
  // Remove non-ANSI control characters
  const cleaned = s.replace(/[\x00-\x08\x0b-\x0c\x0e-\x1a\x1c-\x1f]/g, '');
  return truncate(cleaned, maxW);
}

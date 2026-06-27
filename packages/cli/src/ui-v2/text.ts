const ANSI_RE = /[\x1b\x9b][0-9;]*[a-zA-Z]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

export function width(s: string): number {
  let w = 0;
  for (const ch of stripAnsi(s)) {
    w += ch.charCodeAt(0) > 0x1fff ? 2 : 1;
  }
  return w;
}

export function padEndVisible(s: string, len: number): string {
  const pad = Math.max(0, len - width(s));
  return s + ' '.repeat(pad);
}

export function truncate(s: string, max: number): string {
  if (width(s) <= max) return s;
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    w += s.charCodeAt(i) > 0x1fff ? 2 : 1;
    if (w > max - 1) return s.slice(0, i) + '…';
  }
  return s;
}

export function fit(s: string, max: number): string {
  const stripped = stripAnsi(s);
  if (stripped.length <= max) return s;
  return truncate(s, max);
}

export function wrap(s: string, max: number): string[] {
  const lines: string[] = [];
  for (const raw of s.split('\n')) {
    if (stripAnsi(raw).length === 0) {
      lines.push('');
      continue;
    }
    let remaining = raw;
    while (width(remaining) > max) {
      let idx = 0;
      let w = 0;
      for (const ch of remaining) {
        const cw = ch.charCodeAt(0) > 0x1fff ? 2 : 1;
        if (w + cw > max) break;
        w += cw;
        idx += ch.length >= 2 ? 2 : 1;
      }
      lines.push(remaining.slice(0, idx));
      remaining = remaining.slice(idx);
    }
    lines.push(remaining);
  }
  return lines;
}

export function clean(s: string): string {
  return stripAnsi(s).trim();
}

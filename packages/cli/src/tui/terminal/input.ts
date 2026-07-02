// input.ts — Raw input handler. Parses stdin byte sequences into KeyEvents.
// No readline dependency.

export type KeyEvent =
  | { type: 'char';      char: string }
  | { type: 'enter' }
  | { type: 'backspace' }
  | { type: 'escape' }
  | { type: 'ctrl';      key: string }
  | { type: 'up' }
  | { type: 'down' }
  | { type: 'left' }
  | { type: 'right' }
  | { type: 'home' }
  | { type: 'end' }
  | { type: 'pageup' }
  | { type: 'pagedown' }
  | { type: 'tab' }
  | { type: 'shift_tab' }
  | { type: 'delete' }
  | { type: 'f';         n: number }
  | { type: 'unknown';   raw: string };

type KeyHandler = (event: KeyEvent) => void;

function parseChunk(chunk: string): KeyEvent[] {
  const events: KeyEvent[] = [];
  let i = 0;

  while (i < chunk.length) {
    const ch = chunk[i]!;

    // ── ESC sequences ──────────────────────────────────────────────────────
    if (ch === '\x1b') {
      if (i + 1 >= chunk.length) {
        events.push({ type: 'escape' });
        i++;
        continue;
      }

      const next = chunk[i + 1];

      // CSI: ESC [
      if (next === '[') {
        let seq = '';
        let j = i + 2;
        while (j < chunk.length && !/[A-Za-z~]/.test(chunk[j]!)) {
          seq += chunk[j++];
        }
        const terminator = chunk[j] ?? '';
        const full = `\x1b[${seq}${terminator}`;
        i = j + 1;

        switch (terminator) {
          case 'A': events.push({ type: 'up' });        break;
          case 'B': events.push({ type: 'down' });      break;
          case 'C': events.push({ type: 'right' });     break;
          case 'D': events.push({ type: 'left' });      break;
          case 'H': events.push({ type: 'home' });      break;
          case 'F': events.push({ type: 'end' });       break;
          case 'Z': events.push({ type: 'shift_tab' }); break;
          case '~':
            switch (seq) {
              case '1': case '7': events.push({ type: 'home' });     break;
              case '4': case '8': events.push({ type: 'end' });      break;
              case '3':           events.push({ type: 'delete' });   break;
              case '5':           events.push({ type: 'pageup' });   break;
              case '6':           events.push({ type: 'pagedown' }); break;
              default:            events.push({ type: 'unknown', raw: full }); break;
            }
            break;
          default:
            events.push({ type: 'unknown', raw: full });
        }
        continue;
      }

      // SS3: ESC O
      if (next === 'O') {
        const term = chunk[i + 2];
        i += 3;
        switch (term) {
          case 'P': events.push({ type: 'f', n: 1 }); break;
          case 'Q': events.push({ type: 'f', n: 2 }); break;
          case 'R': events.push({ type: 'f', n: 3 }); break;
          case 'S': events.push({ type: 'f', n: 4 }); break;
          case 'H': events.push({ type: 'home' });     break;
          case 'F': events.push({ type: 'end' });      break;
          default:  events.push({ type: 'escape' });   break;
        }
        continue;
      }

      // Bare ESC
      events.push({ type: 'escape' });
      i++;
      continue;
    }

    // ── Control characters ─────────────────────────────────────────────────
    const code = ch.charCodeAt(0);
    if (code === 13 || code === 10) { events.push({ type: 'enter' });     i++; continue; }
    if (code === 127 || code === 8) { events.push({ type: 'backspace' }); i++; continue; }
    if (code === 9)                 { events.push({ type: 'tab' });       i++; continue; }
    if (code >= 1 && code <= 26) {
      events.push({ type: 'ctrl', key: String.fromCharCode(code + 96) });
      i++;
      continue;
    }

    // ── Printable ──────────────────────────────────────────────────────────
    if (code >= 32) {
      events.push({ type: 'char', char: ch });
      i++;
      continue;
    }

    events.push({ type: 'unknown', raw: ch });
    i++;
  }

  return events;
}

export function startInput(onKey: KeyHandler): () => void {
  const handler = (chunk: string) => {
    for (const event of parseChunk(chunk)) onKey(event);
  };
  process.stdin.on('data', handler);
  return () => process.stdin.off('data', handler);
}

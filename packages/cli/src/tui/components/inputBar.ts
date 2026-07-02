// inputBar.ts — Bottom 2 rows. BG.BRIGHT_BLACK surface, same shade as status bar.
// Visually: the chrome "wraps" the chat area top and bottom.

import type { AppModel } from '../model.js';
import type { Layout }   from '../layout.js';
import { fit, splitLine, truncate } from '../terminal/text.js';
import { styled, BOLD, DIM, FG, BG, RESET } from '../terminal/ansi.js';
import { spinAt, onChrome } from '../theme.js';

const VERSION = 'v2.0';

export function renderInputBar(model: AppModel, layout: Layout): [string, string] {
  const { width } = layout;

  // ── Prompt row ──────────────────────────────────────────────────────────
  const arrow = styled('▸', BOLD, FG.CYAN);

  let inputContent: string;
  if (model.running) {
    inputContent = styled(spinAt(model.spinFrame), FG.YELLOW)
                 + ' ' + styled('agents working…', DIM, FG.YELLOW);
  } else {
    const before     = model.input.slice(0, model.cursor);
    const cursorChar = model.input[model.cursor] ?? ' ';
    const after      = model.input.slice(model.cursor + 1);
    const maxW       = Math.max(0, width - 5);

    const start         = Math.max(0, before.length - maxW + 12);
    const visibleBefore = before.slice(start);
    // Cursor block: bright white bg, black fg — stands out on the grey chrome
    const cursorStyled  = styled(cursorChar, BOLD, BG.WHITE, FG.BLACK);
    const visibleAfter  = truncate(after, maxW - visibleBefore.length - 1);

    inputContent = visibleBefore + cursorStyled + visibleAfter;
  }

  const promptRow = onChrome(fit('  ' + arrow + ' ' + inputContent, width));

  // ── Status/hint row ─────────────────────────────────────────────────────
  let readyCount = 0;
  for (const a of model.agents.values()) if (a.status === 'ready') readyCount++;

  const sep = styled('  │  ', DIM, FG.BRIGHT_BLACK);

  const parts: string[] = [
    styled(VERSION, DIM, FG.WHITE),
    styled(
      `${readyCount} agent${readyCount !== 1 ? 's' : ''}`,
      readyCount > 0 ? FG.GREEN : FG.YELLOW,
    ),
  ];
  if (model.statusText) {
    parts.push(styled(model.statusText.slice(0, 50), FG.CYAN));
  }
  const leftStr = '  ' + parts.join(sep);

  const kb = (key: string, label: string) =>
    styled(key, BOLD, FG.WHITE) + styled(' ' + label, DIM, FG.BRIGHT_BLACK);

  const hintsStr = kb('Ctrl+S', 'sidebar')
    + '  ' + kb('Ctrl+L', 'clear')
    + '  ' + kb('Esc', 'exit')
    + '  ';

  const statusRow = onChrome(fit(splitLine(leftStr, hintsStr, width), width));

  return [promptRow, statusRow];
}

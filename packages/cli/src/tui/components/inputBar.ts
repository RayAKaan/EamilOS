import type { AppModel } from '../model.js';
import type { Layout } from '../layout.js';
import { fit, splitLine, truncate } from '../terminal/text.js';
import { styled, BOLD, DIM, FG, BG } from '../terminal/ansi.js';
import { spinAt, onChrome } from '../theme.js';

export function renderInputBar(model: AppModel, layout: Layout): [string, string] {
  const width = layout.width;
  const arrow = styled('▸', BOLD, FG.CYAN);
  let inputContent: string;
  if (model.running) {
    inputContent = styled(spinAt(model.spinFrame), FG.YELLOW) + ' ' + styled('mission running…', DIM, FG.YELLOW);
  } else {
    const before = model.input.slice(0, model.cursor);
    const cursorChar = model.input[model.cursor] ?? ' ';
    const after = model.input.slice(model.cursor + 1);
    const maxW = Math.max(0, width - 5);
    const start = Math.max(0, before.length - maxW + 12);
    const visibleBefore = before.slice(start);
    const cursorStyled = styled(cursorChar, BOLD, BG.WHITE, FG.BLACK);
    const visibleAfter = truncate(after, maxW - visibleBefore.length - 1);
    inputContent = visibleBefore + cursorStyled + visibleAfter;
  }
  const promptRow = onChrome(fit('  ' + arrow + ' ' + inputContent, width));

  let readyCount = 0;
  for (const a of model.agents.values()) if (a.status === 'ready') readyCount++;
  const sep = styled('  │  ', DIM, FG.BRIGHT_BLACK);
  const leftStr = '  ' + styled('v2.0', DIM, FG.WHITE) + sep + styled(String(readyCount) + ' agents', readyCount > 0 ? FG.GREEN : FG.YELLOW) + (model.statusText ? sep + styled(model.statusText.slice(0, 50), FG.CYAN) : '');
  const kb = (key: string, label: string) => styled(key, BOLD, FG.WHITE) + styled(' ' + label, DIM, FG.BRIGHT_BLACK);
  const hints = kb('M', 'mission') + '  ' + kb('X', 'live') + '  ' + kb('C', 'chat') + '  ' + kb('Ctrl+S', 'sidebar') + '  ' + kb('Esc', 'exit') + '  ';
  return [onChrome(fit(splitLine('  ' + arrow + ' ' + inputContent, '', width), width)), onChrome(fit(splitLine(leftStr, hints, width), width))];
}

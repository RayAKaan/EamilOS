import type { AppModel } from '../model.js';
import type { Layout } from '../layout.js';
import { fit, splitLine, truncate } from '../terminal/text.js';
import { styled, BOLD, DIM, FG, BG } from '../terminal/ansi.js';
import { onChrome } from '../theme.js';

export function renderInputBar(model: AppModel, layout: Layout): [string, string] {
  const width = layout.width;
  const before = model.input.slice(0, model.cursor);
  const cursorChar = model.input[model.cursor] ?? ' ';
  const after = model.input.slice(model.cursor + 1);
  const maxW = Math.max(8, width - 16);
  const start = Math.max(0, before.length - maxW + 12);
  const visibleBefore = before.slice(start);
  const cursorStyled = styled(cursorChar, BOLD, BG.WHITE, FG.BLACK);
  const visibleAfter = truncate(after, Math.max(0, maxW - visibleBefore.length - 1));
  const content = visibleBefore + cursorStyled + visibleAfter;

  const queueNote = model.running ? 'running · prompt queues' : 'ready';
  const prompt = '  ' + styled('PROMPT', BOLD, FG.CYAN) + styled('  › ', DIM, FG.BRIGHT_BLACK) + content;
  const promptRow = onChrome(fit(prompt, width));

  const kb = (key: string, label: string) =>
    styled(key, BOLD, FG.WHITE) + styled(' ' + label, DIM, FG.BRIGHT_BLACK);
  const left = '  ' + styled('PROMPT', BOLD, FG.CYAN) +
    styled('  │  ', DIM, FG.BRIGHT_BLACK) +
    styled(queueNote, model.running ? FG.YELLOW : FG.GREEN);
  const hints = kb('Enter', 'send') + '  ' + kb('/', 'commands') + '  ' +
    kb('Ctrl+C', 'cancel') + '  ' + kb('Ctrl+Q', 'exit') + '  ';

  return [
    onChrome(fit(prompt, width)),
    onChrome(fit(splitLine(left, hints, width), width)),
  ];
}

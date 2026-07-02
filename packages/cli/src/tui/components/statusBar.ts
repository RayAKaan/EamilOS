// statusBar.ts — Top chrome row. BG.BRIGHT_BLACK surface.

import type { AppModel } from '../model.js';
import type { Layout }   from '../layout.js';
import { fit, splitLine, visibleWidth } from '../terminal/text.js';
import { styled, BOLD, DIM, FG, BG, RESET } from '../terminal/ansi.js';
import { spinAt, DOT, onChrome } from '../theme.js';

const VERSION = 'v2.0';

const PAGE_LABELS: Record<string, string> = {
  chat:      '① chat',
  logs:      '② logs',
  agents:    '③ agents',
  sessions:  '④ sessions',
  terminals: '⑤ terminals',
};

export function renderStatusBar(model: AppModel, layout: Layout): string {
  const { width } = layout;

  // mode
  const modeGlyph = model.mode === 'communication'
    ? styled('◈', FG.BRIGHT_CYAN)
    : styled('◆', FG.BRIGHT_MAGENTA);
  const modeLabel = styled(
    model.mode === 'communication' ? 'COMM' : 'EXEC',
    BOLD, FG.BRIGHT_WHITE,
  );
  const modeStr = modeGlyph + ' ' + modeLabel;

  // strategy
  const stratStr = styled(model.strategy, FG.CYAN);

  // agents
  let agentStr: string;
  switch (model.detectionState) {
    case 'detecting':
      agentStr = styled(spinAt(model.spinFrame), FG.YELLOW)
               + ' ' + styled('detecting', DIM, FG.YELLOW);
      break;
    case 'complete': {
      let ready = 0;
      for (const a of model.agents.values()) if (a.status === 'ready') ready++;
      agentStr = styled('●', FG.GREEN)
               + ' ' + styled(String(ready), BOLD, FG.GREEN)
               + ' ' + styled('ready', DIM, FG.WHITE);
      break;
    }
    case 'failed':
      agentStr = styled('✖', FG.RED) + ' ' + styled('failed', FG.RED);
      break;
    default:
      agentStr = styled('○', DIM, FG.WHITE) + ' ' + styled('idle', DIM, FG.WHITE);
  }

  // running
  const runStr = model.running
    ? '  ' + styled(spinAt(model.spinFrame), FG.YELLOW)
    + ' ' + styled('running', BOLD, FG.YELLOW)
    : '';

  // page
  const pageStr = styled(PAGE_LABELS[model.page] ?? model.page, FG.BRIGHT_WHITE);

  const sep  = styled('  │  ', DIM, FG.BRIGHT_BLACK);
  const left = '  ' + modeStr + sep + stratStr + sep + agentStr + sep + pageStr + runStr;

  const right = styled('EamilOS', BOLD, FG.CYAN)
              + ' ' + styled(VERSION, DIM, FG.WHITE)
              + '  ';

  // Paint the entire row with the chrome background shade
  const content = splitLine(left, right, width);
  return onChrome(fit(content, width));
}

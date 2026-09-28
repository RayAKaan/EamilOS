import type { AppModel } from '../model.js';
import type { Layout } from '../layout.js';
import { fit, splitLine } from '../terminal/text.js';
import { styled, BOLD, DIM, FG } from '../terminal/ansi.js';
import { spinAt, onChrome } from '../theme.js';

const PAGE_LABELS: Record<string, string> = {
  mission: 'M mission',
  execution: 'X execution',
  chat: 'C chat',
  logs: 'L logs',
  agents: 'A agents',
  sessions: 'S sessions',
  terminals: 'T terminals',
};

export function renderStatusBar(model: AppModel, layout: Layout): string {
  const modeGlyph = model.mode === 'communication' ? styled('◈', FG.BRIGHT_CYAN) : styled('◆', FG.BRIGHT_MAGENTA);
  const modeLabel = styled(model.mode === 'communication' ? 'COMM' : 'EXEC', BOLD, FG.BRIGHT_WHITE);
  const modeStr = modeGlyph + ' ' + modeLabel;
  const stratStr = styled(model.strategy, FG.CYAN);
  let agentStr: string;
  if (model.detectionState === 'detecting') {
    agentStr = styled(spinAt(model.spinFrame), FG.YELLOW) + ' ' + styled('detecting', DIM, FG.YELLOW);
  } else if (model.detectionState === 'complete') {
    let ready = 0;
    for (const a of model.agents.values()) if (a.status === 'ready') ready++;
    agentStr = styled('●', FG.GREEN) + ' ' + styled(String(ready), BOLD, FG.GREEN) + ' ' + styled('ready', DIM, FG.WHITE);
  } else if (model.detectionState === 'failed') {
    agentStr = styled('✖', FG.RED) + ' ' + styled('failed', FG.RED);
  } else {
    agentStr = styled('○', DIM, FG.WHITE) + ' ' + styled('idle', DIM, FG.WHITE);
  }
  const runStr = model.running ? '  ' + styled(spinAt(model.spinFrame), FG.YELLOW) + ' ' + styled('running', BOLD, FG.YELLOW) : '';
  const sep = styled('  │  ', DIM, FG.BRIGHT_BLACK);
  const left = '  ' + modeStr + sep + stratStr + sep + agentStr + sep + styled(PAGE_LABELS[model.page] ?? model.page, FG.BRIGHT_WHITE) + runStr;
  const right = styled('EamilOS', BOLD, FG.CYAN) + ' ' + styled('v2.0', DIM, FG.WHITE) + '  ';
  return onChrome(fit(splitLine(left, right, layout.width), layout.width));
}

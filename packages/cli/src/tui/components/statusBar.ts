import type { AppModel } from '../model.js';
import type { Layout } from '../layout.js';
import { fit, splitLine, truncate } from '../terminal/text.js';
import { styled, BOLD, DIM, FG } from '../terminal/ansi.js';
import { spinAt, onChrome } from '../theme.js';

const PAGE_LABELS: Record<string, string> = {
  mission: 'M mission',
  execution: 'X execution',
  tasks: 'T tasks',
  artifacts: 'A artifacts',
  sessions: 'S sessions',
  github: 'G github',
  chat: 'C chat',
  logs: 'Z logs',
  agents: 'A agents',
  terminals: 'T terminals',
  fleet: 'F fleet',
  graph: 'R graph',
  loop: 'L loop',
  decisions: 'D decisions',
  approvals: 'P approvals',
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
  const right = model.notification
    ? styled(truncate(model.notification, Math.max(12, Math.floor(layout.width * 0.45))), FG.YELLOW) + '  '
    : styled('EamilOS', BOLD, FG.CYAN) + ' ' + styled('v1.8', DIM, FG.WHITE) + '  ';
  return onChrome(fit(splitLine(left, right, layout.width), layout.width));
}

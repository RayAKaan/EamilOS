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

function getStatusContext(model: AppModel): { glyph: string; text: string; keys: string } {
  const { applicationState, missionState, running, ctrlCState } = model;

  if (applicationState === 'starting') {
    return { 
      glyph: styled(spinAt(model.spinFrame), FG.YELLOW), 
      text: styled('STARTING', BOLD, FG.YELLOW), 
      keys: '' 
    };
  }

  if (applicationState === 'shutting_down') {
    return { 
      glyph: styled('⏻', FG.RED), 
      text: styled('SHUTTING DOWN', BOLD, FG.RED), 
      keys: '' 
    };
  }

  if (ctrlCState.awaitingConfirmation) {
    return { 
      glyph: styled('⚠', FG.YELLOW), 
      text: styled('Press Ctrl+C again to exit', BOLD, FG.YELLOW), 
      keys: '' 
    };
  }

  if (missionState === 'queued') {
    return { 
      glyph: styled(spinAt(model.spinFrame), FG.CYAN), 
      text: styled('QUEUED', BOLD, FG.CYAN), 
      keys: 'Ctrl+C cancel' 
    };
  }

  if (missionState === 'running' || missionState === 'waiting' || missionState === 'validating') {
    return { 
      glyph: styled(spinAt(model.spinFrame), FG.YELLOW), 
      text: styled(missionState.toUpperCase(), BOLD, FG.YELLOW), 
      keys: 'Ctrl+C cancel' 
    };
  }

  if (missionState === 'completed') {
    return { 
      glyph: styled('✓', FG.GREEN), 
      text: styled('COMPLETED', BOLD, FG.GREEN), 
      keys: 'Enter new mission · Ctrl+P commands' 
    };
  }

  if (missionState === 'failed') {
    return { 
      glyph: styled('✗', FG.RED), 
      text: styled('FAILED', BOLD, FG.RED), 
      keys: 'Enter new mission · Ctrl+P commands' 
    };
  }

  if (missionState === 'cancelled') {
    return { 
      glyph: styled('⊘', FG.YELLOW), 
      text: styled('CANCELLED', BOLD, FG.YELLOW), 
      keys: 'Enter new mission · Ctrl+P commands' 
    };
  }

  // Idle/ready state
  let ready = 0;
  for (const a of model.agents.values()) if (a.status === 'ready') ready++;
  return { 
    glyph: ready > 0 ? styled('●', FG.GREEN) : styled('○', DIM, FG.WHITE), 
    text: styled('READY', BOLD, FG.GREEN), 
    keys: `Enter mission · Ctrl+P commands · ? help · Ctrl+Q exit` 
  };
}

export function renderStatusBar(model: AppModel, layout: Layout): string {
  const modeGlyph = model.mode === 'communication' ? styled('◈', FG.BRIGHT_CYAN) : styled('◆', FG.BRIGHT_MAGENTA);
  const modeLabel = styled(model.mode === 'communication' ? 'COMM' : 'EXEC', BOLD, FG.BRIGHT_WHITE);
  const modeStr = modeGlyph + ' ' + modeLabel;
  const stratStr = styled(model.strategy, FG.CYAN);
  
  const context = getStatusContext(model);
  
  const sep = styled('  │  ', DIM, FG.BRIGHT_BLACK);
  const left = '  ' + modeStr + sep + stratStr + sep + context.glyph + ' ' + context.text;
  const right = model.notification
    ? styled(truncate(model.notification, Math.max(12, Math.floor(layout.width * 0.45))), FG.YELLOW) + '  '
    : context.keys
      ? '  ' + styled(context.keys, DIM, FG.WHITE)
      : '  ' + styled('EamilOS', BOLD, FG.CYAN) + ' ' + styled('v1.8', DIM, FG.WHITE) + '  ';
  return onChrome(fit(splitLine(left, right, layout.width), layout.width));
}
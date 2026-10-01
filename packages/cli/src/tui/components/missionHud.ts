import type { Layout } from '../layout.js';
import type { MissionProjection } from '../projection/mission.js';
import { fit, truncate } from '../terminal/text.js';
import { BOLD, DIM, FG, styled } from '../terminal/ansi.js';
import { onChrome } from '../theme.js';

function status(projection: MissionProjection): string {
  switch (projection.status) {
    case 'running': return styled('◆ WORKING', BOLD, FG.YELLOW);
    case 'paused': return styled('Ⅱ ACTION REQUIRED', BOLD, FG.YELLOW);
    case 'completed': return styled('✓ MISSION COMPLETE', BOLD, FG.GREEN);
    case 'failed': return styled('✖ RECOVERY REQUIRED', BOLD, FG.RED);
    case 'cancelled': return styled('○ CANCELLED', BOLD, FG.WHITE);
    default: return styled('○ READY', DIM, FG.WHITE);
  }
}

function progress(value: number, width: number): string {
  const filled = Math.round(Math.max(0, Math.min(100, value)) * width / 100);
  return styled('█'.repeat(filled), FG.CYAN) + styled('░'.repeat(Math.max(0, width - filled)), DIM, FG.BRIGHT_BLACK);
}

function duration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function renderMissionHud(projection: MissionProjection, layout: Layout): string[] {
  const width = layout.width;
  const lines: string[] = [];
  const add = (line: string) => lines.push(onChrome(fit(line, width)));

  add('  ' + styled(truncate(projection.title || 'No active mission', Math.max(12, width - 34)), BOLD, FG.BRIGHT_WHITE) + '  ' + status(projection));
  if (!layout.compact) {
    add('  ' + progress(projection.progress, Math.max(8, Math.min(42, width - 60))) + '  ' + styled(`${projection.progress}%`, BOLD, FG.BRIGHT_WHITE));
    add(
      '  ' +
      styled(`Tasks ${projection.completedTasks}/${projection.taskCount}`, FG.WHITE) + '   ' +
      styled(`Agents ${projection.activeAgents}/${projection.agentCount}`, FG.WHITE) + '   ' +
      styled(`Tools ${projection.toolCount}`, FG.WHITE) + '   ' +
      styled(`Tests ${projection.testCount}`, FG.WHITE) + '   ' +
      styled(`Cost ${projection.cost ?? '—'}`, FG.WHITE) + '   ' +
      styled(`Time ${duration(projection.elapsedMs)}`, FG.WHITE),
    );
    add('  ' + styled('ACTION', DIM, FG.BRIGHT_BLACK) + '  ' + styled(truncate(projection.currentAction || 'Waiting for a mission.', width - 12), FG.BRIGHT_WHITE));
  } else {
    add('  ' + styled(`${projection.progress}% · ${projection.completedTasks}/${projection.taskCount} tasks · ${projection.activeAgents} active agents`, DIM, FG.WHITE));
  }
  while (lines.length < layout.hudHeight) add('');
  return lines.slice(0, layout.hudHeight);
}

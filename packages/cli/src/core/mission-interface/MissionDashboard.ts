import type { MissionStatusView } from './types.js';

function bar(ratio: number, width = 24): string {
  const safe = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(safe * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export function renderMissionDashboard(view: MissionStatusView): string {
  const loop = view.loop;
  const pending = view.approvals.filter(item => item.status === 'PENDING');
  const lines = [
    `MISSION  ${view.missionId}`,
    `STATUS   ${view.status.toUpperCase()}    AUTONOMY ${view.autonomy}`,
    '',
    view.goal,
    '',
    `PROGRESS ${bar(view.progress.completionRatio)} ${Math.round(view.progress.completionRatio * 100)}%`,
    `  completed ${view.progress.completedTasks}/${view.progress.totalTasks}`,
    `  running   ${view.progress.runningTasks}`,
    `  ready     ${view.progress.readyTasks}`,
    `  blocked   ${view.progress.blockedTasks}`,
    `  failed    ${view.progress.failedTasks}`,
    '',
    `GRAPH     v${view.graph.version}  ${view.graph.consistent ? 'CONSISTENT' : 'INCONSISTENT'}`,
    `         ${view.graph.nodes} nodes / ${view.graph.edges} edges`,
  ];

  if (loop) {
    lines.push(
      '',
      `LOOP      ${loop.status} / ${loop.phase} / iteration ${loop.iteration}`,
      `ACTION    ${loop.lastAction ?? '—'}`,
      `TASK      ${loop.lastTaskId ?? '—'}`,
      `DECISIONS ${loop.counters.decisions}   PLANS ${loop.counters.plans}   EXECUTIONS ${loop.counters.executions}`,
      `REPLANS   ${loop.counters.replans}   RECOVERIES ${loop.counters.recoveries}`,
      `REASON    ${loop.terminationReason ?? '—'}`,
    );
  }

  lines.push('', `APPROVALS ${pending.length} pending / ${view.approvals.length} total`);
  for (const approval of pending.slice(0, 5)) {
    lines.push(`  ! ${approval.id}  ${approval.action}${approval.taskId ? `  task=${approval.taskId}` : ''}`);
  }

  lines.push('', 'CONTROLS  eamilos mission pause|resume|cancel|replan|ask <request>');
  return lines.join('\n');
}

import type { AppModel } from '../model.js';
import type { Layout } from '../layout.js';
import type { TaskRecord } from '../mission-data.js';
import { fit, truncate } from '../terminal/text.js';
import { BOLD, DIM, FG, styled } from '../terminal/ansi.js';
import { onChat } from '../theme.js';

export interface MissionStage {
  key: string;
  label: string;
  state: 'complete' | 'active' | 'blocked' | 'pending';
}

function taskState(task: TaskRecord): MissionStage['state'] {
  if (task.status === 'completed') return 'complete';
  if (task.status === 'failed' || task.status === 'blocked' || task.validation === 'failed') return 'blocked';
  if (task.status === 'running' || task.validation === 'running') return 'active';
  return 'pending';
}

export function missionStages(model: AppModel): MissionStage[] {
  const tasks = model.missionData.tasks;
  const planning = tasks.length > 0 ? 'complete' : model.missionUi.id ? 'active' : 'pending';
  const executing = tasks.some(t => t.status === 'running') ? 'active'
    : tasks.length > 0 && tasks.every(t => t.status === 'completed' || t.status === 'cancelled') ? 'complete'
    : tasks.length ? 'pending' : 'pending';
  const validating = model.missionUi.validation === 'passed' ? 'complete'
    : model.missionUi.validation === 'failed' ? 'blocked'
    : model.missionUi.validation === 'running' ? 'active' : 'pending';
  const delivery = model.missionUi.status === 'completed' ? 'complete'
    : model.missionUi.status === 'failed' || model.missionUi.status === 'cancelled' ? 'blocked'
    : 'pending';
  return [
    { key: 'intent', label: 'Intent', state: model.missionUi.id ? 'complete' : 'active' },
    { key: 'plan', label: 'Plan', state: planning },
    { key: 'execute', label: 'Execute', state: executing },
    { key: 'validate', label: 'Validate', state: validating },
    { key: 'deliver', label: 'Deliver', state: delivery },
  ];
}

function stageMark(state: MissionStage['state']): string {
  if (state === 'complete') return styled('✓', FG.GREEN);
  if (state === 'active') return styled('●', FG.CYAN);
  if (state === 'blocked') return styled('!', FG.RED);
  return styled('○', DIM, FG.BRIGHT_BLACK);
}

export function renderMissionPlan(model: AppModel, layout: Layout): string[] {
  const width = layout.mainWidth;
  const lines: string[] = [];
  const add = (s: string) => lines.push(onChat(fit(s, width)));
  const stages = missionStages(model);
  add('  ' + styled('MISSION FLOW', BOLD, FG.WHITE));
  add('  ' + stages.map(s => stageMark(s.state) + ' ' + s.label).join('  →  '));
  add('');
  add('  ' + styled('TASK PLAN', BOLD, FG.WHITE));

  const tasks = model.missionData.tasks;
  if (!tasks.length) {
    add('  ' + styled('No tasks have been materialized yet.', DIM, FG.WHITE));
    return lines;
  }

  const visible = layout.compact ? tasks.slice(0, 4) : tasks.slice(0, Math.max(4, Math.min(8, layout.viewportHeight - 14)));
  for (const task of visible) {
    const mark = stageMark(taskState(task));
    const agent = task.assignedAgentId ? ' · ' + task.assignedAgentId : '';
    const validation = task.validation === 'passed' ? styled(' validated', FG.GREEN)
      : task.validation === 'failed' ? styled(' validation failed', FG.RED)
      : '';
    add('  ' + mark + ' ' + styled(task.id, DIM, FG.BRIGHT_BLACK) + '  ' +
      truncate(task.title, Math.max(12, width - 42)) + ' ' +
      styled(String(task.progress) + '%', FG.BRIGHT_WHITE) +
      styled(agent, DIM, FG.BRIGHT_BLACK) + validation);
  }
  if (tasks.length > visible.length) add('  ' + styled('+' + String(tasks.length - visible.length) + ' more tasks · open Tasks for the full plan', DIM, FG.BRIGHT_BLACK));
  return lines;
}

export function renderMissionAttention(model: AppModel, layout: Layout): string[] {
  const width = layout.mainWidth;
  const pendingApprovals = model.missionUi.pendingApprovals;
  const failedTasks = model.missionData.tasks.filter(t => t.status === 'failed' || t.validation === 'failed');
  const blockedTasks = model.missionData.tasks.filter(t => t.status === 'blocked');
  const lines: string[] = [];
  const add = (s: string) => lines.push(onChat(fit(s, width)));

  if (pendingApprovals > 0) {
    add('  ' + styled('⚠ ACTION REQUIRED', BOLD, FG.YELLOW) + '  ' + String(pendingApprovals) + ' approval' + (pendingApprovals === 1 ? '' : 's') + ' waiting');
  } else if (failedTasks.length > 0) {
    add('  ' + styled('✖ RECOVERY REQUIRED', BOLD, FG.RED) + '  ' + String(failedTasks.length) + ' failed task' + (failedTasks.length === 1 ? '' : 's'));
  } else if (blockedTasks.length > 0) {
    add('  ' + styled('⚠ BLOCKED', BOLD, FG.YELLOW) + '  ' + String(blockedTasks.length) + ' task' + (blockedTasks.length === 1 ? '' : 's') + ' blocked');
  } else if (model.missionUi.status === 'completed') {
    add('  ' + styled('✓ MISSION COMPLETE', BOLD, FG.GREEN) + '  Validation and delivery state are available below');
  } else {
    return lines;
  }
  return lines;
}

export function renderMissionMetrics(model: AppModel, layout: Layout): string[] {
  const width = layout.mainWidth;
  const tasks = model.missionData.tasks;
  const completed = tasks.filter(t => t.status === 'completed').length;
  const running = tasks.filter(t => t.status === 'running').length;
  const failed = tasks.filter(t => t.status === 'failed').length;
  const executions = model.missionData.executions;
  const activeAgents = Array.from(model.agents.values()).filter(a => a.status === 'busy').length;
  const lines = [
    '  ' + styled('MISSION METRICS', BOLD, FG.WHITE),
    '  ' + styled('Tasks ', DIM, FG.BRIGHT_BLACK) + completed + '/' + tasks.length +
      '   ' + styled('Running ', DIM, FG.BRIGHT_BLACK) + running +
      '   ' + styled('Failed ', DIM, FG.BRIGHT_BLACK) + failed +
      '   ' + styled('Executions ', DIM, FG.BRIGHT_BLACK) + executions.length,
    '  ' + styled('Agents ', DIM, FG.BRIGHT_BLACK) + activeAgents + '/' + model.agents.size +
      '   ' + styled('Artifacts ', DIM, FG.BRIGHT_BLACK) + model.missionData.artifacts.length +
      '   ' + styled('Approvals ', DIM, FG.BRIGHT_BLACK) + model.missionUi.pendingApprovals,
  ];
  return lines.map(line => onChat(fit(line, width)));
}

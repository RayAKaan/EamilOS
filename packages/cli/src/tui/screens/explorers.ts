import type { AppModel } from '../model.js';
import type { Layout } from '../layout.js';
import { fit, truncate } from '../terminal/text.js';
import { BOLD, DIM, FG, styled } from '../terminal/ansi.js';
import { onChat } from '../theme.js';
import { selectArtifacts, selectCurrentArtifact, selectCurrentSession, selectCurrentTask, selectExecutionsForSession, selectExecutionsForTask, selectSessions, selectTasks } from '../state/mission-projections.js';

const icon = (status: string): string => status === 'completed' || status === 'passed' ? styled('✓', FG.GREEN)
  : status === 'failed' ? styled('!', FG.RED)
  : status === 'running' ? styled('→', FG.CYAN)
  : styled('○', DIM, FG.WHITE);

function base(model: AppModel, layout: Layout, title: string): { lines: string[]; add: (s: string) => void } {
  const lines: string[] = [];
  const add = (s: string) => lines.push(onChat(fit(s, layout.mainWidth)));
  add('  ' + styled(title, BOLD, FG.CYAN));
  add('  ' + styled('─'.repeat(Math.max(0, layout.mainWidth - 4)), DIM, FG.BRIGHT_BLACK));
  return { lines, add };
}

export function renderTasks(model: AppModel, layout: Layout): string[] {
  const { lines, add } = base(model, layout, 'TASKS');
  const tasks = selectTasks(model);
  if (!tasks.length) add('  ' + styled('No tasks yet — tasks appear when a mission starts execution.', DIM, FG.WHITE));
  for (const task of tasks) {
    add('  ' + icon(task.status) + ' ' + styled(task.id, DIM, FG.WHITE) + '  ' + truncate(task.title, layout.mainWidth - 32) + '  ' + task.status.toUpperCase() + '  ' + String(task.progress) + '%');
  }
  const task = selectCurrentTask(model);
  if (task) {
    add('');
    add('  ' + styled(task.id + '  ' + task.title, BOLD, FG.BRIGHT_WHITE));
    add('  Agent      ' + (task.assignedAgentId ?? '—'));
    add('  Device     ' + (task.assignedDeviceId ?? '—'));
    add('  Validation ' + task.validation);
    add('  Dependencies ' + (task.dependsOn.length ? task.dependsOn.join(', ') : 'none'));
    const executions = selectExecutionsForTask(model, task.id);
    add('  Executions ' + (executions.length ? executions.map(e => e.id + ' ' + e.status).join('  ') : '—'));
    const artifacts = model.missionData.artifacts.filter(a => a.taskId === task.id);
    add('  Artifacts  ' + (artifacts.length ? artifacts.map(a => a.path).join(', ') : '—'));
  }
  while (lines.length < layout.viewportHeight) add('');
  return lines.slice(0, layout.viewportHeight);
}

export function renderArtifacts(model: AppModel, layout: Layout): string[] {
  const { lines, add } = base(model, layout, 'ARTIFACTS');
  const artifacts = selectArtifacts(model);
  if (!artifacts.length) add('  ' + styled('No artifacts yet — outputs appear as tasks produce files.', DIM, FG.WHITE));
  for (const artifact of artifacts) {
    add('  ' + icon(artifact.validation === 'unknown' ? 'ready' : artifact.validation) + ' ' + truncate(artifact.path, layout.mainWidth - 38) + '  ' + artifact.kind + '  ' + artifact.action);
  }
  const artifact = selectCurrentArtifact(model);
  if (artifact) {
    add('');
    add('  ' + styled('ARTIFACT DETAIL', BOLD, FG.BRIGHT_WHITE));
    add('  Path       ' + artifact.path);
    add('  Type       ' + artifact.kind);
    add('  Task       ' + (artifact.taskId ?? '—'));
    add('  Execution  ' + (artifact.executionId ?? '—'));
    add('  Agent      ' + (artifact.agentId ?? '—'));
    add('  Validation ' + artifact.validation);
  }
  while (lines.length < layout.viewportHeight) add('');
  return lines.slice(0, layout.viewportHeight);
}

export function renderSessions(model: AppModel, layout: Layout): string[] {
  const { lines, add } = base(model, layout, 'SESSIONS');
  const sessions = selectSessions(model);
  if (!sessions.length) add('  ' + styled('No session history yet.', DIM, FG.WHITE));
  for (const session of sessions.slice().reverse()) {
    add('  ' + icon(session.status) + ' ' + styled(session.id, DIM, FG.WHITE) + '  ' + truncate(session.goal, layout.mainWidth - 42) + '  ' + session.strategy + '  ' + session.status);
  }
  const session = selectCurrentSession(model);
  if (session) {
    add('');
    add('  ' + styled('SESSION DETAIL', BOLD, FG.BRIGHT_WHITE));
    add('  Goal       ' + session.goal);
    add('  Strategy   ' + session.strategy);
    add('  Started    ' + new Date(session.startedAt).toLocaleTimeString());
    add('  Duration   ' + (session.durationMs == null ? 'running' : (session.durationMs / 1000).toFixed(1) + 's'));
    const executions = selectExecutionsForSession(model, session.id);
    add('  Executions ' + (executions.length ? executions.map(e => e.id + ' ' + e.status).join('  ') : '—'));
  }
  while (lines.length < layout.viewportHeight) add('');
  return lines.slice(0, layout.viewportHeight);
}

export function renderGitHub(model: AppModel, layout: Layout): string[] {
  const { lines, add } = base(model, layout, 'GITHUB');
  const git = model.missionData.github;
  if (!git.available && git.error) {
    add('  ' + styled('GITHUB UNAVAILABLE', BOLD, FG.YELLOW));
    add('  ' + styled(git.error, DIM, FG.WHITE));
  } else if (!git.available) {
    add('  ' + styled('NO GITHUB REPOSITORY DETECTED', DIM, FG.WHITE));
  } else {
    add('  Repository ' + styled(git.repository ?? '—', BOLD, FG.BRIGHT_WHITE));
    add('  Branch     ' + styled(git.branch ?? '—', FG.CYAN));
    add('  Working tree ' + (git.dirty ? styled('DIRTY', FG.YELLOW) : styled('CLEAN', FG.GREEN)));
    add('  Ahead / behind ' + String(git.ahead) + ' / ' + String(git.behind));
    add('');
    add('  ' + styled('CHANGED FILES', BOLD, FG.WHITE));
    if (!git.changedFiles.length) add('  ' + styled('No uncommitted changes.', DIM, FG.WHITE));
    for (const file of git.changedFiles.slice(0, 12)) add('  ' + styled('M', FG.YELLOW) + ' ' + truncate(file, layout.mainWidth - 8));
    add('');
    add('  ' + styled('RECENT COMMITS', BOLD, FG.WHITE));
    for (const commit of git.commits.slice(0, 6)) add('  ' + styled(commit.hash.slice(0, 8), DIM, FG.WHITE) + '  ' + truncate(commit.subject, layout.mainWidth - 16));
    add('');
    if (git.pullRequest) {
      add('  ' + styled('PULL REQUEST', BOLD, FG.WHITE));
      add('  #' + String(git.pullRequest.number) + '  ' + git.pullRequest.title + '  ' + (git.pullRequest.draft ? 'DRAFT' : git.pullRequest.state.toUpperCase()));
      add('  ' + git.pullRequest.url);
    } else {
      add('  ' + styled('No open pull request found for this branch.', DIM, FG.WHITE));
    }
  }
  while (lines.length < layout.viewportHeight) add('');
  return lines.slice(0, layout.viewportHeight);
}

import type { MissionSnapshot } from '../mission/types.js';
import type { MissionStatusView } from './types.js';

export interface MissionReport {
  missionId: string;
  goal: string;
  status: MissionSnapshot['mission']['status'];
  progress: MissionStatusView['progress'];
  tasks: {
    completed: string[];
    running: string[];
    ready: string[];
    blocked: string[];
    failed: string[];
  };
  artifacts: string[];
  evidence: string[];
  checkpoints: string[];
  decisions: number;
  events: number;
  summary: string;
}

export function buildMissionReport(snapshot: MissionSnapshot, decisions = 0): MissionReport {
  const byState = (state: string) => snapshot.tasks.filter(task => task.state === state).map(task => task.id);
  const total = snapshot.tasks.length;
  const completed = byState('COMPLETED');
  const failed = byState('FAILED');
  const blocked = byState('BLOCKED');
  const ratio = total === 0 ? 0 : completed.length / total;
  const summary = snapshot.mission.status === 'completed'
    ? 'Mission completed and the completion engine accepted its criteria.'
    : snapshot.mission.status === 'cancelled'
      ? 'Mission was cancelled by the human control plane.'
      : blocked.length > 0
        ? `Mission is blocked by ${blocked.length} task(s).`
        : failed.length > 0
          ? `Mission has ${failed.length} failed task(s) requiring recovery or intervention.`
          : `Mission is ${snapshot.mission.status} with ${Math.round(ratio * 100)}% task completion.`;
  return {
    missionId: snapshot.mission.id,
    goal: snapshot.mission.goal,
    status: snapshot.mission.status,
    progress: {
      totalTasks: total, completedTasks: completed.length,
      runningTasks: byState('RUNNING').length, readyTasks: byState('READY').length,
      blockedTasks: blocked.length, failedTasks: failed.length, completionRatio: ratio,
    },
    tasks: {
      completed, running: byState('RUNNING'), ready: byState('READY'),
      blocked, failed,
    },
    artifacts: snapshot.tasks.flatMap(task => task.artifacts),
    evidence: snapshot.evidence.map(item => item.id),
    checkpoints: snapshot.checkpoints.map(item => item.id),
    decisions,
    events: snapshot.events.length,
    summary,
  };
}

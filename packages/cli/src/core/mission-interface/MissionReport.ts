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
}

export function buildMissionReport(snapshot: MissionSnapshot, decisions = 0): MissionReport {
  const byState = (state: string) => snapshot.tasks.filter(task => task.state === state).map(task => task.id);
  const total = snapshot.tasks.length;
  const completed = byState('COMPLETED');
  return {
    missionId: snapshot.mission.id,
    goal: snapshot.mission.goal,
    status: snapshot.mission.status,
    progress: {
      totalTasks: total,
      completedTasks: completed.length,
      runningTasks: byState('RUNNING').length,
      readyTasks: byState('READY').length,
      blockedTasks: byState('BLOCKED').length,
      failedTasks: byState('FAILED').length,
      completionRatio: total === 0 ? 0 : completed.length / total,
    },
    tasks: {
      completed,
      running: byState('RUNNING'),
      ready: byState('READY'),
      blocked: byState('BLOCKED'),
      failed: byState('FAILED'),
    },
    artifacts: snapshot.tasks.flatMap(task => task.artifacts),
    evidence: snapshot.evidence.map(item => item.id),
    checkpoints: snapshot.checkpoints.map(item => item.id),
    decisions,
    events: snapshot.events.length,
  };
}

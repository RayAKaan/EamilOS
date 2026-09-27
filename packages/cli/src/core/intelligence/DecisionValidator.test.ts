import { describe, expect, it } from 'vitest';
import { DecisionValidator } from './DecisionValidator.js';
import type { DecisionContext } from './types.js';

const context: DecisionContext = {
  schemaVersion: '1.0',
  mission: {
    id: 'mission-1',
    goal: 'test',
    status: 'active',
    constraints: {},
    completionCriteria: [],
    requirements: {},
    graphVersion: 3,
  },
  taskGraph: {
    version: 3,
    tasks: [
      { id: 'task-1', title: 'one', state: 'READY', priority: 'MEDIUM', dependencies: [], requiredCapabilities: [], acceptanceCriteria: [], attempt: 0 },
      { id: 'task-2', title: 'two', state: 'COMPLETED', priority: 'MEDIUM', dependencies: [], requiredCapabilities: [], acceptanceCriteria: [], attempt: 0 },
    ],
    dependencies: [],
    readyTasks: ['task-1'],
    runningTasks: [],
    blockedTasks: [],
    completedTasks: ['task-2'],
    failedTasks: [],
  },
  coordination: { conflicts: [], activeReservations: [], activeLeases: [], localPlans: [] },
  executions: [],
  failures: [],
  checkpoints: [],
  evidence: [],
  decisions: [],
  progress: { totalTasks: 2, completedTasks: 1, runningTasks: 0, blockedTasks: 0, failedTasks: 0, completionRatio: 0.5, progressSinceLastDecision: true },
  timestamp: new Date().toISOString(),
};

describe('DecisionValidator', () => {
  it('accepts a valid decision against the current graph', () => {
    const result = new DecisionValidator().validate({
      decisionId: 'd1',
      missionId: 'mission-1',
      action: 'CONTINUE',
      reasoning: 'continue',
      targets: [{ taskId: 'task-1' }],
      contextVersion: 3,
    }, context);
    expect(result.accepted).toBe(true);
    expect(result.stale).toBe(false);
  });

  it('rejects a stale decision', () => {
    const result = new DecisionValidator().validate({
      decisionId: 'd2',
      missionId: 'mission-1',
      action: 'CONTINUE',
      targets: [{ taskId: 'task-1' }],
      contextVersion: 2,
    }, context);
    expect(result.accepted).toBe(false);
    expect(result.stale).toBe(true);
  });

  it('rejects completion while tasks remain incomplete', () => {
    const result = new DecisionValidator().validate({
      decisionId: 'd3',
      missionId: 'mission-1',
      action: 'COMPLETE',
      targets: [],
      contextVersion: 3,
    }, context);
    expect(result.accepted).toBe(false);
  });

  it('rejects unknown target tasks', () => {
    const result = new DecisionValidator().validate({
      decisionId: 'd4',
      missionId: 'mission-1',
      action: 'EXECUTE',
      targets: [{ taskId: 'missing' }],
      contextVersion: 3,
    }, context);
    expect(result.accepted).toBe(false);
  });
});

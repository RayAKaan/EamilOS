import { describe, expect, it } from 'vitest';
import { MissionEngine } from '../mission/MissionEngine.js';
import { GraphAdaptationEngine } from './GraphAdaptationEngine.js';
import type { LoopMeasurement, LoopObservation, LoopValidation } from '../loop/types.js';

function observation(missions: MissionEngine): LoopObservation {
  const snapshot = missions.snapshot('mission_test');
  const graph = {
    missionId: snapshot.mission.id,
    version: 1,
    nodes: [],
    edges: [],
    stateHash: 'test',
    createdAt: new Date().toISOString(),
  };
  return {
    missionId: snapshot.mission.id,
    iteration: 1,
    observedAt: new Date().toISOString(),
    graph,
    graphHealth: {
      consistent: true, nodeCount: 0, edgeCount: 0, orphanNodes: 0, orphanEdges: 0,
      invalidReferences: 0, version: 1, stateHash: 'test',
    },
    context: {
      schemaVersion: '1.0',
      mission: {
        id: snapshot.mission.id, goal: snapshot.mission.goal, status: snapshot.mission.status,
        constraints: {}, completionCriteria: [], requirements: {}, graphVersion: 1,
      },
      project: { workspace: { workingDir: snapshot.mission.workingDir }, relevantFiles: [] },
      agents: [], taskGraph: {
        version: 1, tasks: snapshot.tasks.map(t => ({
          id: t.id, title: t.title, state: t.state, priority: t.priority,
          dependencies: t.dependencies, requiredCapabilities: t.requiredCapabilities,
          acceptanceCriteria: t.acceptanceCriteria, attempt: t.attempt,
        })),
        dependencies: [], readyTasks: [], runningTasks: [], blockedTasks: [], completedTasks: [], failedTasks: [],
      },
      coordination: { conflicts: [], activeReservations: [], activeLeases: [], localPlans: [] },
      executions: [], failures: [], checkpoints: [], evidence: [], artifacts: { files: [], diffs: [], evidence: [] },
      decisions: [], progress: {
        totalTasks: snapshot.tasks.length, completedTasks: 0, runningTasks: 0,
        blockedTasks: 0, failedTasks: 0, readyTasks: 0, completionRatio: 0,
        progressSinceLastDecision: false,
      },
      timestamp: new Date().toISOString(),
    },
    readyTasks: [], runningTasks: [], blockedTasks: [], failedTasks: [],
    completionRatio: 0, progressMetric: 0,
  };
}

describe('GraphAdaptationEngine', () => {
  it('creates one idempotent recovery task and makes it a prerequisite of the failed task', () => {
    const missions = new MissionEngine();
    const mission = missions.createMission({ id: 'mission_test', goal: 'test', workingDir: process.cwd() });
    missions.addTask(mission.id, {
      id: 'task_a', title: 'Implement', description: 'Implement feature',
      requiredCapabilities: ['node'], idempotencyKey: 'task_a',
    });
    const obs = observation(missions);
    obs.context.taskGraph.failedTasks = ['task_a'];
    obs.failedTasks = ['task_a'];
    const measurement: LoopMeasurement = {
      measuredAt: new Date().toISOString(), progressMetric: 0, progressDelta: 0,
      taskStateChanges: 1, graphVersion: 1,
    };
    const validation: LoopValidation = { passed: false, reasons: ['test failure'] };
    const result = new GraphAdaptationEngine(missions, {
      allowTaskCreation: true, allowDependencyChanges: true, allowTaskInputChanges: true,
      maxMutationsPerIteration: 2, requireGraphConsistency: true,
    }).apply(obs, measurement, validation);
    expect(result.changed).toBe(true);
    const tasks = missions.snapshot(mission.id).tasks;
    const original = tasks.find(t => t.id === 'task_a')!;
    expect(tasks.some(t => t.id !== 'task_a')).toBe(true);
    expect(original.dependencies.length).toBe(1);
  });
});

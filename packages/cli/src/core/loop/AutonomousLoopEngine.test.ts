import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AutonomousLoopEngine } from './AutonomousLoopEngine.js';
import { LoopEventLog } from './LoopEventLog.js';
import { LoopStateStore } from './LoopStateStore.js';
import type { AutonomousLoopComponents, AutonomousLoopPolicy, LoopObservation } from './types.js';

function observation(missionId: string, iteration: number, progress: number): LoopObservation {
  const now = new Date().toISOString();
  const graph = {
    missionId,
    version: iteration,
    nodes: [],
    edges: [],
    stateHash: 'hash',
    createdAt: now,
  };
  return {
    missionId,
    iteration,
    observedAt: now,
    graph,
    graphHealth: {
      consistent: true, nodeCount: 0, edgeCount: 0, orphanNodes: 0,
      orphanEdges: 0, invalidReferences: 0, version: iteration, stateHash: 'hash',
    },
    context: {
      schemaVersion: '1.0',
      mission: {
        id: missionId, goal: 'test', status: progress >= 1 ? 'completed' : 'active',
        constraints: {}, completionCriteria: [], requirements: {}, graphVersion: iteration,
      },
      project: { workspace: { workingDir: process.cwd() }, relevantFiles: [] },
      agents: [], taskGraph: {
        version: iteration, tasks: [], dependencies: [], readyTasks: [], runningTasks: [],
        blockedTasks: [], completedTasks: [], failedTasks: [],
      },
      coordination: { conflicts: [], activeReservations: [], activeLeases: [], localPlans: [] },
      executions: [], failures: [], checkpoints: [], evidence: [], artifacts: { files: [], diffs: [], evidence: [] },
      decisions: [], progress: {
        totalTasks: 1, completedTasks: progress >= 1 ? 1 : 0, runningTasks: 0,
        blockedTasks: 0, failedTasks: 0, readyTasks: progress >= 1 ? 0 : 1,
        completionRatio: progress, progressSinceLastDecision: true,
      },
      timestamp: now,
    },
    readyTasks: progress >= 1 ? [] : ['task_1'],
    runningTasks: [],
    blockedTasks: [],
    failedTasks: [],
    completionRatio: progress,
    progressMetric: progress,
  };
}

const policy: AutonomousLoopPolicy = {
  maxIterations: 5, maxDecisions: 5, maxPlans: 5, maxExecutions: 5,
  maxValidations: 5, maxRecoveries: 5, maxReplans: 5,
  maxStagnantIterations: 3, requireGraphConsistency: true,
  allowAutonomousExecution: true,
};

describe('AutonomousLoopEngine', () => {
  it('executes the phases and terminates when progress completes the mission', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eamilos-loop-'));
    let progress = 0;
    const phases: string[] = [];
    const components: AutonomousLoopComponents = {
      observe: (missionId, iteration) => {
        phases.push('OBSERVE');
        return observation(missionId, iteration, progress);
      },
      interpret: () => {
        phases.push('INTERPRET');
        return {
          action: progress === 0 ? 'EXECUTE' : 'COMPLETE',
          trigger: progress === 0 ? 'PERIODIC_REVIEW' : 'MISSION_NEAR_COMPLETION',
          reason: progress === 0 ? 'Execute ready work.' : 'Mission complete.',
          taskIds: progress === 0 ? ['task_1'] : [],
          requiresPlanning: false,
        };
      },
      plan: async () => {
        phases.push('PLAN');
        return { planned: true, action: 'PLAN', message: 'planned' };
      },
      execute: async () => {
        phases.push('EXECUTE');
        progress = 1;
        return { executionId: 'exec_1', taskId: 'task_1', status: 'COMPLETED' };
      },
      measure: async (missionId, before) => {
        phases.push('MEASURE');
        return {
          measuredAt: new Date().toISOString(), progressMetric: progress,
          progressDelta: progress - before.progressMetric, taskStateChanges: 1,
          graphVersion: before.graph.version + 1,
        };
      },
      validate: async () => {
        phases.push('VALIDATE');
        return { passed: true, reasons: ['passed'] };
      },
      adapt: async () => {
        phases.push('ADAPT');
        return { action: 'CONTINUE', trigger: 'TASK_COMPLETED', progress: true, message: 'continue' };
      },
    };

    const engine = new AutonomousLoopEngine(
      components,
      policy,
      new LoopStateStore(join(root, 'state')),
      new LoopEventLog(join(root, 'events')),
    );
    const result = await engine.run('mission_1');

    expect(result.status).toBe('COMPLETED');
    expect(result.iterations).toBe(2);
    expect(phases).toEqual(['OBSERVE','INTERPRET','EXECUTE','MEASURE','VALIDATE','ADAPT','OBSERVE']);
  });

  it('escalates on graph inconsistency before execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eamilos-loop-'));
    const components: AutonomousLoopComponents = {
      observe: (missionId, iteration) => {
        const value = observation(missionId, iteration, 0);
        value.graphHealth.consistent = false;
        return value;
      },
      interpret: () => { throw new Error('should not interpret'); },
      plan: async () => ({ planned: true, action: 'PLAN' }),
      execute: async () => ({ executionId: 'x', taskId: 'x', status: 'FAILED' }),
      measure: async () => ({ measuredAt: new Date().toISOString(), progressMetric: 0, progressDelta: 0, taskStateChanges: 0, graphVersion: 1 }),
      validate: async () => ({ passed: false, reasons: [] }),
      adapt: async () => ({ action: 'ESCALATE', trigger: 'PERIODIC_REVIEW', progress: false, message: 'x' }),
    };
    const engine = new AutonomousLoopEngine(
      components, policy,
      new LoopStateStore(join(root, 'state')),
      new LoopEventLog(join(root, 'events')),
    );
    const result = await engine.run('mission_1');
    expect(result.status).toBe('ESCALATED');
    expect(result.terminationReason).toContain('graph consistency');
  });

  it('persists state and resumes a non-terminal loop', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eamilos-loop-'));
    const states = new LoopStateStore(join(root, 'state'));
    const events = new LoopEventLog(join(root, 'events'));
    let calls = 0;
    const components: AutonomousLoopComponents = {
      observe: (missionId, iteration) => observation(missionId, iteration, 0),
      interpret: () => {
        calls += 1;
        if (calls === 1) return { action: 'WAIT', trigger: 'PERIODIC_REVIEW', reason: 'wait', taskIds: [], requiresPlanning: false };
        return { action: 'ESCALATE', trigger: 'PERIODIC_REVIEW', reason: 'stop', taskIds: [], requiresPlanning: false };
      },
      plan: async () => ({ planned: true, action: 'PLAN' }),
      execute: async () => ({ executionId: 'x', taskId: 'x', status: 'FAILED' }),
      measure: async (_m, before) => ({ measuredAt: new Date().toISOString(), progressMetric: before.progressMetric, progressDelta: 0, taskStateChanges: 0, graphVersion: before.graph.version }),
      validate: async () => ({ passed: true, reasons: [] }),
      adapt: async () => ({ action: 'WAIT', trigger: 'PERIODIC_REVIEW', progress: false, message: 'wait' }),
    };
    const engine = new AutonomousLoopEngine(components, { ...policy, maxIterations: 1 }, states, events);
    const first = await engine.run('mission_1');
    expect(first.status).toBe('ESCALATED');
    expect((await states.load('mission_1'))?.counters.iterations).toBe(1);
  });
});

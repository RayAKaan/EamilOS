import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AutonomousLoopEngine } from './AutonomousLoopEngine.js';
import { LoopEventLog } from './LoopEventLog.js';
import { LoopStateStore } from './LoopStateStore.js';
import type { AutonomousLoopComponents, AutonomousLoopPolicy, LoopObservation } from './types.js';

function observation(missionId: string, iteration: number): LoopObservation {
  const now = new Date().toISOString();
  return {
    missionId, iteration, observedAt: now,
    graph: { missionId, version: iteration, nodes: [], edges: [], stateHash: 'hash', createdAt: now },
    graphHealth: { consistent: true, nodeCount: 0, edgeCount: 0, orphanNodes: 0, orphanEdges: 0, invalidReferences: 0, version: iteration, stateHash: 'hash' },
    context: {
      schemaVersion: '1.0',
      mission: { id: missionId, goal: 'test', status: 'active', constraints: {}, completionCriteria: [], requirements: {}, graphVersion: iteration },
      project: { workspace: { workingDir: process.cwd() }, relevantFiles: [] },
      agents: [], taskGraph: { version: iteration, tasks: [], dependencies: [], readyTasks: [], runningTasks: [], blockedTasks: [], completedTasks: [], failedTasks: [] },
      coordination: { conflicts: [], activeReservations: [], activeLeases: [], localPlans: [] },
      executions: [], failures: [], checkpoints: [], evidence: [], artifacts: { files: [], diffs: [], evidence: [] }, decisions: [],
      progress: { totalTasks: 1, completedTasks: 0, runningTasks: 0, blockedTasks: 0, failedTasks: 0, readyTasks: 1, completionRatio: 0, progressSinceLastDecision: false },
      timestamp: now,
    },
    readyTasks: ['task_1'], runningTasks: [], blockedTasks: [], failedTasks: [], completionRatio: 0, progressMetric: 0,
  };
}

const policy: AutonomousLoopPolicy = {
  maxIterations: 5, maxDecisions: 5, maxPlans: 5, maxExecutions: 5, maxValidations: 5,
  maxRecoveries: 5, maxReplans: 5, maxStagnantIterations: 5, requireGraphConsistency: true, allowAutonomousExecution: true,
};

describe('AutonomousLoopEngine human control boundary', () => {
  it('honors a persisted pause requested by another process between iterations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eamilos-loop-control-'));
    try {
      const states = new LoopStateStore(join(root, 'state'));
      const events = new LoopEventLog(join(root, 'events'));
      const components: AutonomousLoopComponents = {
        observe: (missionId, iteration) => observation(missionId, iteration),
        interpret: () => ({ action: 'EXECUTE', trigger: 'PERIODIC_REVIEW', reason: 'execute', taskIds: ['task_1'], requiresPlanning: false }),
        plan: async () => ({ planned: true, action: 'PLAN' }),
        execute: async () => {
          const state = await states.load('mission_1');
          if (state) {
            state.status = 'PAUSED';
            state.terminationReason = 'Paused by external controller.';
            state.updatedAt = new Date().toISOString();
            await states.save(state);
          }
          return { executionId: 'exec_1', taskId: 'task_1', status: 'COMPLETED' };
        },
        measure: async (_missionId, before) => ({ measuredAt: new Date().toISOString(), progressMetric: 0, progressDelta: 0, taskStateChanges: 0, graphVersion: before.graph.version }),
        validate: async () => ({ passed: true, reasons: ['ok'] }),
        adapt: async () => ({ action: 'CONTINUE', trigger: 'PERIODIC_REVIEW', progress: false, message: 'continue' }),
      };
      const result = await new AutonomousLoopEngine(components, policy, states, events).run('mission_1');
      expect(result.status).toBe('PAUSED');
      expect(result.terminationReason).toContain('external controller');
      expect(result.iterations).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

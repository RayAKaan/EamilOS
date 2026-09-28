import { describe, expect, it } from 'vitest';
import { AutonomousLoopEngine } from './AutonomousLoopEngine.js';
import type { AutonomousLoopComponents, AutonomousLoopPolicy, LoopObservation } from './types.js';

describe('AutonomousLoopEngine human authorization', () => {
  it('pauses before an unauthorized action and persists the approval reason', async () => {
    const components: AutonomousLoopComponents = {
      observe: async (): Promise<LoopObservation> => ({
        missionId: 'mission-auth-test',
        iteration: 1,
        observedAt: new Date().toISOString(),
        graph: { missionId: 'mission-auth-test', version: 1, nodes: [], edges: [], stateHash: 'hash', createdAt: new Date().toISOString() },
        graphHealth: { consistent: true, nodeCount: 0, edgeCount: 0, orphanNodes: 0, orphanEdges: 0, invalidReferences: 0, version: 1, stateHash: 'hash' },
        context: { mission: { status: 'active' } } as LoopObservation['context'],
        readyTasks: ['task-1'],
        runningTasks: [],
        blockedTasks: [],
        failedTasks: [],
        completionRatio: 0,
        progressMetric: 0,
      }),
      interpret: async () => ({
        action: 'EXECUTE',
        trigger: 'USER_REQUESTED',
        reason: 'execute',
        taskIds: ['task-1'],
        requiresPlanning: false,
      }),
      plan: async () => ({ planned: true, action: 'EXECUTE' }),
      execute: async () => {
        throw new Error('execute should not run');
      },
      measure: async () => ({
        measuredAt: new Date().toISOString(),
        progressMetric: 0,
        progressDelta: 0,
        taskStateChanges: 0,
        graphVersion: 0,
      }),
      validate: async () => ({ passed: true, reasons: [] }),
      adapt: async () => ({
        action: 'CONTINUE',
        trigger: 'PERIODIC_REVIEW',
        progress: false,
        message: 'continue',
      }),
      authorize: async () => ({
        allowed: false,
        reason: 'Human approval required for EXECUTE.',
        approvalId: 'approval_test',
      }),
    };

    const policy: AutonomousLoopPolicy = {
      maxIterations: 1,
      maxDecisions: 5,
      maxPlans: 5,
      maxExecutions: 5,
      maxValidations: 5,
      maxRecoveries: 5,
      maxReplans: 5,
      maxStagnantIterations: 5,
      requireGraphConsistency: false,
      allowAutonomousExecution: true,
    };

    const engine = new AutonomousLoopEngine(components, policy);
    const result = await engine.run('mission-auth-test');
    expect(result.status).toBe('PAUSED');
    expect(result.terminationReason).toContain('Human approval required');
  });
});

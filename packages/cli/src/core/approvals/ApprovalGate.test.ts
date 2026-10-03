import { describe, expect, it } from 'vitest';
import { InMemoryApprovalStore } from './ApprovalStore.js';
import { ApprovalGate, ApprovalGateDispatcher } from './ApprovalGate.js';
import type { ScheduleDecision, SchedulingCandidate } from '../scheduler/GlobalSchedulerTypes.js';
import type { FleetWorker } from '../comms/a2a/EamilosFleetRegistry.js';
import { DeterministicPolicyEngine } from './PolicyEngine.js';

const decision: ScheduleDecision = {
  decisionId: 'decision-1',
  idempotencyKey: 'schedule-1',
  schedulerRevision: 1,
  missionId: 'mission-1',
  taskId: 'task-1',
  executionId: 'execution-1',
  workerId: 'worker-1',
  agentId: 'agent-1',
  harnessId: 'harness-1',
  priority: 'HIGH',
  fencingToken: 1,
  leaseId: 'lease-1',
  state: 'scheduled',
  createdAt: '2026-10-03T17:00:00.000Z',
  updatedAt: '2026-10-03T17:00:00.000Z',
};

const candidate = {
  missionId: 'mission-1',
  taskId: 'task-1',
  task: {
    id: 'task-1',
    missionId: 'mission-1',
    title: 'publish',
    status: 'ready',
    priority: 'high',
    inputs: {},
    dependencies: [],
  },
  missionCreatedAt: '2026-10-03T16:00:00.000Z',
  priorityRank: 1,
  requiredCapabilities: [],
  resources: { readSet: [], writeSet: ['registry'] },
} as unknown as SchedulingCandidate;

const worker = {
  workerId: 'worker-1',
  status: 'online',
  capabilities: [],
  activeExecutions: 0,
  maxConcurrency: 4,
  lastHeartbeatAt: '2026-10-03T17:00:00.000Z',
  metadata: {},
} as unknown as FleetWorker;

function context(command = 'npm') {
  return {
    decision,
    candidate,
    worker,
    policyContext: {
      missionId: decision.missionId,
      taskId: decision.taskId,
      executionId: decision.executionId,
      workerId: decision.workerId,
      agentId: decision.agentId,
      harnessId: decision.harnessId,
      command,
      args: ['publish'],
      cwd: '/workspace',
      resources: candidate.resources,
      capabilities: ['publish'],
      riskCategory: 'production',
    },
    now: '2026-10-03T17:00:00.000Z',
  };
}

describe('ApprovalGate', () => {
  it('allows without creating an approval', () => {
    const store = new InMemoryApprovalStore();
    const gate = new ApprovalGate({
      approvalStore: store,
      policyEngine: new DeterministicPolicyEngine(),
    });

    expect(gate.evaluate(context()).decision).toBe('allow');
    expect(store.list()).toEqual([]);
  });

  it('denies without creating an approval', () => {
    const store = new InMemoryApprovalStore();
    const gate = new ApprovalGate({
      approvalStore: store,
      policyEngine: new DeterministicPolicyEngine({
        policies: [{
          policyId: 'blocked',
          effect: 'deny',
          reason: 'publishing disabled',
          commands: ['npm'],
        }],
      }),
    });

    expect(gate.evaluate(context()).decision).toBe('deny');
    expect(store.list()).toEqual([]);
  });

  it('creates exactly one pending approval for approval_required', () => {
    const store = new InMemoryApprovalStore();
    const gate = new ApprovalGate({
      approvalStore: store,
      policyEngine: new DeterministicPolicyEngine({
        policies: [{
          policyId: 'publish',
          effect: 'approval_required',
          reason: 'human authorization required',
          protectedResources: ['registry'],
        }],
      }),
    });

    const first = gate.evaluate(context());
    const second = gate.evaluate(context());

    expect(first.decision).toBe('approval_required');
    expect(second.decision).toBe('approval_required');
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]?.status).toBe('pending');
    if (first.decision !== 'approval_required' || second.decision !== 'approval_required') throw new Error('expected approval_required');
    expect(first.approval.approvalId).toBe(second.approval.approvalId);
  });

  it('does not dispatch approval-required or denied executions', () => {
    const store = new InMemoryApprovalStore();
    const gate = new ApprovalGate({
      approvalStore: store,
      policyEngine: new DeterministicPolicyEngine({
        policies: [{
          policyId: 'publish',
          effect: 'approval_required',
          reason: 'human authorization required',
          protectedResources: ['registry'],
        }],
      }),
    });

    let dispatched = 0;
    const dispatcher = new ApprovalGateDispatcher({
      gate,
      dispatch: () => { dispatched += 1; },
    });

    const result = dispatcher.dispatchIfAuthorized(context());

    expect(result.decision).toBe('approval_required');
    expect(dispatched).toBe(0);
    expect(store.list()).toHaveLength(1);
  });

  it('dispatches allowed executions exactly once per invocation', () => {
    const gate = new ApprovalGate({
      approvalStore: new InMemoryApprovalStore(),
      policyEngine: new DeterministicPolicyEngine(),
    });

    let dispatched = 0;
    const dispatcher = new ApprovalGateDispatcher({
      gate,
      dispatch: () => { dispatched += 1; },
    });

    expect(dispatcher.dispatchIfAuthorized(context()).decision).toBe('allow');
    expect(dispatched).toBe(1);
  });

  it('does not let a deny policy become approvable', () => {
    const store = new InMemoryApprovalStore();
    const gate = new ApprovalGate({
      approvalStore: store,
      policyEngine: new DeterministicPolicyEngine({
        policies: [
          {
            policyId: 'approval',
            effect: 'approval_required',
            reason: 'human authorization',
            protectedResources: ['registry'],
          },
          {
            policyId: 'deny',
            effect: 'deny',
            reason: 'registry forbidden',
            protectedResources: ['registry'],
          },
        ],
      }),
    });

    expect(gate.evaluate(context()).decision).toBe('deny');
    expect(store.list()).toEqual([]);
  });
});

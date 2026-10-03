import { describe, expect, it } from 'vitest';
import { InMemoryApprovalStore } from './ApprovalStore.js';
import { ApprovalController } from './ApprovalController.js';
import { ApprovalProjection } from './ApprovalProjection.js';

function makeStore() {
  const store = new InMemoryApprovalStore();
  store.create({
    approvalId: 'approval-a',
    missionId: 'mission-1',
    taskId: 'task-1',
    executionId: 'execution-1',
    requestId: 'request-1',
    policyId: 'publish',
    scope: 'execution',
    requestedBy: 'agent-1',
    reason: 'production publish requires human approval',
    evidence: [
      { kind: 'command', name: 'command', value: 'npm publish' },
      { kind: 'resources', name: 'writeSet', value: ['registry'] },
    ],
    createdAt: '2026-10-03T17:00:00.000Z',
  });
  store.create({
    approvalId: 'approval-b',
    missionId: 'mission-1',
    taskId: 'task-2',
    executionId: 'execution-2',
    requestId: 'request-2',
    policyId: 'deploy',
    scope: 'execution',
    requestedBy: 'agent-2',
    reason: 'deployment requires human approval',
    evidence: [],
    createdAt: '2026-10-03T17:01:00.000Z',
  });
  return store;
}

describe('ApprovalController', () => {
  it('authoritatively approves a pending request', () => {
    const store = makeStore();
    const controller = new ApprovalController({
      store,
      now: () => '2026-10-03T17:02:00.000Z',
    });

    const result = controller.approve('approval-a', 'human-1', 'reviewed release');
    expect(result.approval.status).toBe('approved');
    expect(result.approval.decisionBy).toBe('human-1');
    expect(result.approval.decisionAt).toBe('2026-10-03T17:02:00.000Z');
    expect(result.approval.decisionReason).toBe('reviewed release');
  });

  it('authoritatively rejects a pending request', () => {
    const store = makeStore();
    const controller = new ApprovalController({ store });
    const result = controller.reject('approval-a', 'human-1', 'not authorized');
    expect(result.approval.status).toBe('rejected');
    expect(result.approval.decisionBy).toBe('human-1');
  });

  it('rejects stale or repeated human decisions', () => {
    const store = makeStore();
    const controller = new ApprovalController({ store });
    const first = controller.approve('approval-a', 'human-1');
    expect(first.approval.status).toBe('approved');

    expect(() => controller.reject('approval-a', 'human-2')).toThrow(
      'APPROVAL_NOT_PENDING:approved',
    );
  });

  it('requires a human actor', () => {
    const controller = new ApprovalController({ store: makeStore() });
    expect(() => controller.approve('approval-a', '   ')).toThrow(
      'APPROVAL_ACTOR_REQUIRED',
    );
  });
});

describe('ApprovalProjection', () => {
  it('projects approvals without owning or mutating lifecycle state', () => {
    const store = makeStore();
    const projection = new ApprovalProjection(
      store,
      () => '2026-10-03T17:03:00.000Z',
    );

    const snapshot = projection.snapshot({ status: 'pending' });
    expect(snapshot.approvals.map((item) => item.approvalId)).toEqual([
      'approval-a',
      'approval-b',
    ]);
    expect(snapshot.updatedAt).toBe('2026-10-03T17:03:00.000Z');

    projection.select('approval-a');
    expect(projection.selected()?.approvalId).toBe('approval-a');
    expect(store.get('approval-a')?.status).toBe('pending');
  });

  it('supports deterministic selection navigation', () => {
    const projection = new ApprovalProjection(makeStore());
    expect(projection.selectNext()?.approvalId).toBe('approval-a');
    expect(projection.selectNext()?.approvalId).toBe('approval-b');
    expect(projection.selectPrevious()?.approvalId).toBe('approval-a');
  });

  it('preserves evidence in the view', () => {
    const projection = new ApprovalProjection(makeStore());
    const view = projection.select('approval-a');
    expect(view.evidence[0]).toEqual({
      kind: 'command',
      name: 'command',
      value: 'npm publish',
    });
    expect(view.evidence[1]?.kind).toBe('resources');
  });

  it('does not expose approvals that are outside the requested filter', () => {
    const projection = new ApprovalProjection(makeStore());
    projection.select('approval-a');
    const snapshot = projection.snapshot({
      executionId: 'execution-2',
    });
    expect(snapshot.approvals.map((item) => item.approvalId)).toEqual([
      'approval-b',
    ]);
    expect(snapshot.selectedApprovalId).toBeUndefined();
  });
});

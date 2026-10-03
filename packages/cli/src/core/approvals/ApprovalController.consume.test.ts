import { describe, expect, it } from 'vitest';
import { ApprovalController } from './ApprovalController.js';
import { InMemoryApprovalStore } from './ApprovalStore.js';
import type { ApprovalRequest } from './ApprovalTypes.js';

const request: ApprovalRequest = {
  approvalId: 'approval-consume',
  missionId: 'mission-1',
  taskId: 'task-1',
  executionId: 'execution-1',
  requestId: 'request-1',
  policyId: 'publish',
  scope: 'execution',
  requestedBy: 'agent-1',
  reason: 'human authorization required',
  evidence: [],
  createdAt: '2026-10-03T17:00:00.000Z',
};

describe('ApprovalController.consume', () => {
  it('atomically consumes an approved approval and rejects replay', () => {
    const store = new InMemoryApprovalStore();
    const controller = new ApprovalController({
      store,
      now: () => '2026-10-03T17:02:00.000Z',
    });

    const pending = store.create(request);
    const approved = controller.approve(
      pending.approvalId,
      'human-1',
      'approved',
      pending.revision,
    ).approval;

    const consumed = controller.consume(approved.approvalId, approved.revision).approval;
    expect(consumed.status).toBe('consumed');
    expect(consumed.revision).toBe(3);
    expect(consumed.consumedAt).toBe('2026-10-03T17:02:00.000Z');

    expect(() => controller.consume(consumed.approvalId, consumed.revision))
      .toThrow('APPROVAL_NOT_APPROVED:consumed');
  });

  it('uses optimistic revision checks to prevent two consumers', () => {
    const store = new InMemoryApprovalStore();
    const controller = new ApprovalController({ store });

    const pending = store.create(request);
    const approved = controller.approve(
      pending.approvalId,
      'human-1',
      undefined,
      pending.revision,
    ).approval;

    controller.consume(approved.approvalId, approved.revision);

    expect(() => controller.consume(approved.approvalId, approved.revision))
      .toThrow('APPROVAL_NOT_APPROVED:consumed');
  });
});

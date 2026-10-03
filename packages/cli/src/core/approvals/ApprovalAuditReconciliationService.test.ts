import { describe, expect, it } from 'vitest';
import { EamilosSqliteDistributedEventLog } from '../comms/a2a/EamilosDistributedEventLog.js';
import { ApprovalAuditRecorder } from './ApprovalAudit.js';
import { ApprovalAuditReconciliationService } from './ApprovalAuditReconciliationService.js';
import { InMemoryApprovalStore } from './ApprovalStore.js';
import type { ApprovalRequest } from './ApprovalTypes.js';

const request: ApprovalRequest = {
  approvalId: 'approval-reconcile',
  missionId: 'mission-1',
  taskId: 'task-1',
  executionId: 'execution-1',
  requestId: 'request-1',
  policyId: 'publish',
  scope: 'execution',
  requestedBy: 'agent-1',
  reason: 'protected publish',
  evidence: [{ kind: 'command', name: 'command', value: 'npm publish', sensitive: true }],
  createdAt: '2026-10-03T10:00:00.000Z',
};

describe('ApprovalAuditRecorder reconciliation', () => {
  it('repairs a missing lifecycle event and is idempotent', () => {
    const store = new InMemoryApprovalStore();
    const approval = store.create(request);
    const approved = store.transition(approval.approvalId, {
      status: 'approved',
      decisionBy: 'human-1',
      decisionAt: '2026-10-03T10:01:00.000Z',
      decisionReason: 'reviewed',
    }, approval.revision);

    const log = new EamilosSqliteDistributedEventLog({ filename: ':memory:' });
    const audit = new ApprovalAuditRecorder({ eventLog: log });
    audit.recordTransition(approval, approved);

    const first = audit.reconcile(approved);
    expect(first.checked).toBe(2);
    expect(first.present).toBe(1);
    expect(first.repaired).toEqual([
      'approval:approval-reconcile:1:approval.requested',
    ]);

    const second = audit.reconcile(approved);
    expect(second.present).toBe(2);
    expect(second.repaired).toEqual([]);
    expect(log.list().map((event) => event.eventId)).toEqual([
      'approval:approval-reconcile:2:approval.approved',
      'approval:approval-reconcile:1:approval.requested',
    ]);
    expect(() => log.verifyIntegrity()).not.toThrow();
    log.close();
  });

  it('detects tampered audit payloads instead of overwriting them', () => {
    const store = new InMemoryApprovalStore();
    const approval = store.create(request);
    const log = new EamilosSqliteDistributedEventLog({ filename: ':memory:' });

    log.append({
      eventId: 'approval:approval-reconcile:1:approval.requested',
      eventType: 'approval.requested',
      missionId: approval.missionId,
      taskId: approval.taskId,
      executionId: approval.executionId,
      requestId: approval.requestId,
      payload: {
        approvalId: approval.approvalId,
        policyId: approval.policyId,
        scope: approval.scope,
        status: 'pending',
        revision: 1,
        requestedBy: approval.requestedBy,
        reason: 'tampered',
        evidence: [],
      },
    });

    const audit = new ApprovalAuditRecorder({ eventLog: log });
    expect(() => audit.reconcile(approval)).toThrow(
      'APPROVAL_AUDIT_CORRUPTION:approval:approval-reconcile:1:approval.requested:reason',
    );
    log.close();
  });

  it('reconciles a consumed approval as the complete three-event lifecycle', () => {
    const store = new InMemoryApprovalStore();
    const approval = store.create(request);
    const approved = store.transition(approval.approvalId, {
      status: 'approved',
      decisionBy: 'human-1',
      decisionAt: '2026-10-03T10:01:00.000Z',
      decisionReason: 'reviewed',
    }, approval.revision);
    const consumed = store.transition(approval.approvalId, {
      status: 'consumed',
      consumedAt: '2026-10-03T10:02:00.000Z',
    }, approved.revision);

    const log = new EamilosSqliteDistributedEventLog({ filename: ':memory:' });
    const audit = new ApprovalAuditRecorder({ eventLog: log });
    const result = audit.reconcile(consumed);

    expect(result.checked).toBe(3);
    expect(result.repaired).toHaveLength(3);
    expect(log.list().map((event) => event.eventType)).toEqual([
      'approval.requested',
      'approval.approved',
      'approval.consumed',
    ]);
    expect(() => log.verifyIntegrity()).not.toThrow();
    log.close();
  });
});

describe('ApprovalAuditReconciliationService', () => {
  it('reconciles every persisted approval without owning lifecycle state', () => {
    const store = new InMemoryApprovalStore();
    store.create(request({ approvalId: 'a' }));
    store.create(request({ approvalId: 'b' }));

    const log = new EamilosSqliteDistributedEventLog({ filename: ':memory:' });
    const audit = new ApprovalAuditRecorder({ eventLog: log });
    const service = new ApprovalAuditReconciliationService({ store, audit });

    const first = service.reconcileAll();
    expect(first.scanned).toBe(2);
    expect(first.repaired).toHaveLength(2);

    const second = service.reconcileAll();
    expect(second.scanned).toBe(2);
    expect(second.repaired).toEqual([]);
    expect(log.list()).toHaveLength(2);
    log.close();
  });
});

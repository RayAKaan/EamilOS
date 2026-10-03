import type { DistributedEventLog, EamilosEvent } from '../comms/a2a/EamilosDistributedEventLog.js';
import type { ApprovalRecord } from './ApprovalTypes.js';

export type ApprovalAuditEventType =
  | 'approval.requested'
  | 'approval.approved'
  | 'approval.rejected'
  | 'approval.expired'
  | 'approval.cancelled'
  | 'approval.consumed';

export interface ApprovalAuditReconciliationResult {
  readonly approvalId: string;
  readonly checked: number;
  readonly present: number;
  readonly repaired: string[];
}

export interface ApprovalAuditRecorderOptions {
  readonly eventLog: DistributedEventLog;
  readonly maxReasonLength?: number;
}

export class ApprovalAuditRecorder {
  private readonly eventLog: DistributedEventLog;
  private readonly maxReasonLength: number;

  constructor(options: ApprovalAuditRecorderOptions) {
    this.eventLog = options.eventLog;
    this.maxReasonLength = Math.max(1, Math.floor(options.maxReasonLength ?? 2048));
  }

  recordRequested(approval: ApprovalRecord): EamilosEvent {
    if (approval.status !== 'pending') throw new Error('APPROVAL_AUDIT_REQUESTED_REQUIRES_PENDING');
    return this.append('approval.requested', approval, {
      requestedBy: approval.requestedBy,
      reason: this.sanitize(approval.reason),
      evidence: this.evidenceSummary(approval),
    });
  }

  reconcile(approval: ApprovalRecord): ApprovalAuditReconciliationResult {
    const expected = this.expectedLifecycle(approval);
    const repaired: string[] = [];
    let present = 0;

    for (const item of expected) {
      const existing = this.eventLog.get(item.eventId);
      if (existing) {
        this.assertEventMatches(item, existing);
        present += 1;
        continue;
      }
      this.append(item.eventType, item.approval, item.payload, new Date().toISOString());
      repaired.push(item.eventId);
    }

    return {
      approvalId: approval.approvalId,
      checked: expected.length,
      present,
      repaired,
    };
  }

  recordTransition(previous: ApprovalRecord, next: ApprovalRecord): EamilosEvent {
    this.assertTransition(previous, next);
    const eventType = this.eventTypeFor(next.status);
    return this.append(eventType, next, {
      decisionBy: next.decisionBy,
      decisionReason: next.decisionReason ? this.sanitize(next.decisionReason) : undefined,
      consumedAt: next.consumedAt,
    });
  }

  private append(eventType: ApprovalAuditEventType, approval: ApprovalRecord, payload: Record<string, unknown>, occurredAt?: string): EamilosEvent {
    return this.eventLog.append({
      eventId: 'approval:' + approval.approvalId + ':' + approval.revision + ':' + eventType,
      eventType,
      missionId: approval.missionId,
      taskId: approval.taskId,
      executionId: approval.executionId,
      requestId: approval.requestId,
      ...(occurredAt ? { occurredAt } : {}),
      payload: {
        approvalId: approval.approvalId,
        policyId: approval.policyId,
        scope: approval.scope,
        status: approval.status,
        revision: approval.revision,
        ...payload,
      },
    });
  }

  private expectedLifecycle(approval: ApprovalRecord): Array<{
    eventId: string;
    eventType: ApprovalAuditEventType;
    approval: ApprovalRecord;
    payload: Record<string, unknown>;
  }> {
    if (approval.revision < 1 || approval.revision > 3) {
      throw new Error(`APPROVAL_AUDIT_UNSUPPORTED_REVISION:${approval.revision}`);
    }

    const requested = { ...approval, status: 'pending' as const, revision: 1 };
    const events: Array<{
      eventId: string;
      eventType: ApprovalAuditEventType;
      approval: ApprovalRecord;
      payload: Record<string, unknown>;
    }> = [{
      eventId: `approval:${approval.approvalId}:1:approval.requested`,
      eventType: 'approval.requested',
      approval: requested,
      payload: {
        requestedBy: approval.requestedBy,
        reason: this.sanitize(approval.reason),
        evidence: this.evidenceSummary(approval),
      },
    }];

    if (approval.revision >= 2) {
      const decisionStatus = approval.status === 'consumed' ? 'approved' : approval.status;
      const decided = { ...approval, status: decisionStatus as ApprovalRecord['status'], revision: 2 };
      const decisionEventType = this.eventTypeFor(decisionStatus);
      events.push({
        eventId: `approval:${approval.approvalId}:2:${decisionEventType}`,
        eventType: decisionEventType,
        approval: decided,
        payload: {
          decisionBy: decided.decisionBy,
          decisionReason: decided.decisionReason ? this.sanitize(decided.decisionReason) : undefined,
        },
      });
    }

    if (approval.status === 'consumed') {
      events.push({
        eventId: `approval:${approval.approvalId}:3:approval.consumed`,
        eventType: 'approval.consumed',
        approval,
        payload: { consumedAt: approval.consumedAt },
      });
    }

    return events;
  }

  private assertEventMatches(
    expected: { eventId: string; eventType: ApprovalAuditEventType; approval: ApprovalRecord; payload: Record<string, unknown> },
    actual: EamilosEvent,
  ): void {
    if (
      actual.eventId !== expected.eventId ||
      actual.eventType !== expected.eventType ||
      actual.missionId !== expected.approval.missionId ||
      actual.taskId !== expected.approval.taskId ||
      actual.executionId !== expected.approval.executionId ||
      actual.requestId !== expected.approval.requestId
    ) {
      throw new Error(`APPROVAL_AUDIT_CORRUPTION:${expected.eventId}`);
    }

    for (const [key, value] of Object.entries({
      approvalId: expected.approval.approvalId,
      policyId: expected.approval.policyId,
      scope: expected.approval.scope,
      status: expected.approval.status,
      revision: expected.approval.revision,
      ...expected.payload,
    })) {
      if (JSON.stringify(actual.payload[key]) !== JSON.stringify(value)) {
        throw new Error(`APPROVAL_AUDIT_CORRUPTION:${expected.eventId}:${key}`);
      }
    }
  }

  private assertTransition(previous: ApprovalRecord, next: ApprovalRecord): void {
    if (previous.approvalId !== next.approvalId) throw new Error('APPROVAL_AUDIT_CORRELATION_MISMATCH:approvalId');
    if (previous.missionId !== next.missionId || previous.taskId !== next.taskId || previous.executionId !== next.executionId || previous.requestId !== next.requestId || previous.policyId !== next.policyId) {
      throw new Error('APPROVAL_AUDIT_CORRELATION_MISMATCH');
    }
    if (next.revision !== previous.revision + 1) throw new Error('APPROVAL_AUDIT_REVISION_MISMATCH:' + previous.revision + ':' + next.revision);
    if (next.status === previous.status || next.status === 'pending') throw new Error('APPROVAL_AUDIT_INVALID_TRANSITION');
  }

  private eventTypeFor(status: ApprovalRecord['status']): ApprovalAuditEventType {
    switch (status) {
      case 'approved': return 'approval.approved';
      case 'rejected': return 'approval.rejected';
      case 'expired': return 'approval.expired';
      case 'cancelled': return 'approval.cancelled';
      case 'consumed': return 'approval.consumed';
      case 'pending': throw new Error('APPROVAL_AUDIT_PENDING_TRANSITION');
    }
  }

  private evidenceSummary(approval: ApprovalRecord): readonly Record<string, unknown>[] {
    return approval.evidence.map((item) => ({ kind: item.kind, name: item.name, sensitive: item.sensitive === true }));
  }

  private sanitize(value: string): string {
    return value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, this.maxReasonLength);
  }
}

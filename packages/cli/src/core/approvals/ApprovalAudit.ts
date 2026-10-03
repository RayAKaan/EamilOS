import type { DistributedEventLog, EamilosEvent } from '../comms/a2a/EamilosDistributedEventLog.js';
import type { ApprovalRecord } from './ApprovalTypes.js';

export type ApprovalAuditEventType =
  | 'approval.requested'
  | 'approval.approved'
  | 'approval.rejected'
  | 'approval.expired'
  | 'approval.cancelled'
  | 'approval.consumed';

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

  recordTransition(previous: ApprovalRecord, next: ApprovalRecord): EamilosEvent {
    this.assertTransition(previous, next);
    const eventType = this.eventTypeFor(next.status);
    return this.append(eventType, next, {
      decisionBy: next.decisionBy,
      decisionReason: next.decisionReason ? this.sanitize(next.decisionReason) : undefined,
      consumedAt: next.consumedAt,
    });
  }

  private append(eventType: ApprovalAuditEventType, approval: ApprovalRecord, payload: Record<string, unknown>): EamilosEvent {
    return this.eventLog.append({
      eventId: 'approval:' + approval.approvalId + ':' + approval.revision + ':' + eventType,
      eventType,
      missionId: approval.missionId,
      taskId: approval.taskId,
      executionId: approval.executionId,
      requestId: approval.requestId,
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

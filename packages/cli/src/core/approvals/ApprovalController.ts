import type { ApprovalRecord } from './ApprovalTypes.js';
import type { ApprovalStore } from './ApprovalStore.js';
import type { ApprovalAuditRecorder } from './ApprovalAudit.js';

export interface ApprovalDecisionResult {
  readonly approval: ApprovalRecord;
}

export interface ApprovalControllerOptions {
  readonly store: ApprovalStore;
  readonly now?: () => string;
  readonly audit?: ApprovalAuditRecorder;
}

export class ApprovalController {
  private readonly store: ApprovalStore;
  private readonly now: () => string;
  private readonly audit?: ApprovalAuditRecorder;

  constructor(options: ApprovalControllerOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date().toISOString());
    this.audit = options.audit;
  }

  get(approvalId: string): ApprovalRecord | undefined {
    return this.store.get(approvalId);
  }

  pending(limit?: number): ApprovalRecord[] {
    return this.store.list({ status: 'pending', limit });
  }

  approve(
    approvalId: string,
    actor: string,
    reason?: string,
    expectedRevision?: number,
  ): ApprovalDecisionResult {
    this.assertActor(actor);
    const current = this.requirePending(approvalId);
    const approval = this.store.transition(
      approvalId,
      {
        status: 'approved',
        decisionBy: actor,
        decisionAt: this.now(),
        decisionReason: reason,
      },
      expectedRevision ?? current.revision,
    );
    this.audit?.recordTransition(current, approval);
    return { approval };
  }

  expire(
    approvalId: string,
    reason = 'APPROVAL_EXPIRED',
    expectedRevision?: number,
  ): ApprovalDecisionResult {
    const current = this.requirePending(approvalId);
    const approval = this.store.transition(
      approvalId,
      {
        status: 'expired',
        decisionAt: this.now(),
        decisionReason: reason,
      },
      expectedRevision ?? current.revision,
    );
    this.audit?.recordTransition(current, approval);
    return { approval };
  }

  consume(approvalId: string, expectedRevision?: number): ApprovalDecisionResult {
    const current = this.get(approvalId);
    if (!current) throw new Error('APPROVAL_NOT_FOUND');
    if (current.status !== 'approved') {
      throw new Error(`APPROVAL_NOT_APPROVED:${current.status}`);
    }

    const approval = this.store.transition(
      approvalId,
      {
        status: 'consumed',
        consumedAt: this.now(),
      },
      expectedRevision ?? current.revision,
    );
    this.audit?.recordTransition(current, approval);
    return { approval };
  }

  reject(
    approvalId: string,
    actor: string,
    reason?: string,
    expectedRevision?: number,
  ): ApprovalDecisionResult {
    this.assertActor(actor);
    const current = this.requirePending(approvalId);
    const approval = this.store.transition(
      approvalId,
      {
        status: 'rejected',
        decisionBy: actor,
        decisionAt: this.now(),
        decisionReason: reason,
      },
      expectedRevision ?? current.revision,
    );
    this.audit?.recordTransition(current, approval);
    return { approval };
  }

  private requirePending(approvalId: string): ApprovalRecord {
    const approval = this.store.get(approvalId);
    if (!approval) throw new Error('APPROVAL_NOT_FOUND');
    if (approval.status !== 'pending') {
      throw new Error(`APPROVAL_NOT_PENDING:${approval.status}`);
    }
    return approval;
  }

  private assertActor(actor: string): void {
    if (!actor.trim()) throw new Error('APPROVAL_ACTOR_REQUIRED');
  }
}

import type { ApprovalRecord } from './ApprovalTypes.js';
import type { ApprovalStore } from './ApprovalStore.js';

export interface ApprovalDecisionResult {
  readonly approval: ApprovalRecord;
}

export interface ApprovalControllerOptions {
  readonly store: ApprovalStore;
  readonly now?: () => string;
}

export class ApprovalController {
  private readonly store: ApprovalStore;
  private readonly now: () => string;

  constructor(options: ApprovalControllerOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date().toISOString());
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

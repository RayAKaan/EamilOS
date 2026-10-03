import type { ApprovalRecord, ApprovalStatus } from './ApprovalTypes.js';
import type { ApprovalStore } from './ApprovalStore.js';

export interface ApprovalProjectionQuery {
  readonly status?: ApprovalStatus | readonly ApprovalStatus[];
  readonly missionId?: string;
  readonly taskId?: string;
  readonly executionId?: string;
  readonly policyId?: string;
  readonly limit?: number;
}

export interface ApprovalView {
  readonly approvalId: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly executionId: string;
  readonly policyId: string;
  readonly status: ApprovalStatus;
  readonly requestedBy: string;
  readonly reason: string;
  readonly evidence: ApprovalRecord['evidence'];
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly decisionBy?: string;
  readonly decisionAt?: string;
  readonly decisionReason?: string;
  readonly revision: number;
}

export interface ApprovalProjectionSnapshot {
  readonly selectedApprovalId?: string;
  readonly approvals: readonly ApprovalView[];
  readonly updatedAt: string;
}

export class ApprovalProjection {
  private readonly store: ApprovalStore;
  private readonly now: () => string;
  private selectedApprovalId?: string;

  constructor(store: ApprovalStore, now: () => string = () => new Date().toISOString()) {
    this.store = store;
    this.now = now;
  }

  snapshot(query: ApprovalProjectionQuery = {}): ApprovalProjectionSnapshot {
    const approvals = this.store.list(query)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.approvalId.localeCompare(b.approvalId))
      .map(toView);

    if (this.selectedApprovalId && !approvals.some((item) => item.approvalId === this.selectedApprovalId)) {
      this.selectedApprovalId = undefined;
    }

    return {
      selectedApprovalId: this.selectedApprovalId,
      approvals,
      updatedAt: this.now(),
    };
  }

  select(approvalId: string): ApprovalView {
    const approval = this.store.get(approvalId);
    if (!approval) throw new Error('APPROVAL_NOT_FOUND');
    this.selectedApprovalId = approvalId;
    return toView(approval);
  }

  selected(): ApprovalView | undefined {
    return this.selectedApprovalId
      ? this.store.get(this.selectedApprovalId)
        ? toView(this.store.get(this.selectedApprovalId)!)
        : undefined
      : undefined;
  }

  selectNext(query: ApprovalProjectionQuery = {}): ApprovalView | undefined {
    const items = this.store.list(query)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.approvalId.localeCompare(b.approvalId));
    if (!items.length) return undefined;
    const index = this.selectedApprovalId
      ? items.findIndex((item) => item.approvalId === this.selectedApprovalId)
      : -1;
    const next = items[(index + 1) % items.length]!;
    this.selectedApprovalId = next.approvalId;
    return toView(next);
  }

  selectPrevious(query: ApprovalProjectionQuery = {}): ApprovalView | undefined {
    const items = this.store.list(query)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.approvalId.localeCompare(b.approvalId));
    if (!items.length) return undefined;
    const index = this.selectedApprovalId
      ? items.findIndex((item) => item.approvalId === this.selectedApprovalId)
      : 0;
    const previous = items[(index - 1 + items.length) % items.length]!;
    this.selectedApprovalId = previous.approvalId;
    return toView(previous);
  }

  close(): void {
    this.selectedApprovalId = undefined;
  }
}

function toView(record: ApprovalRecord): ApprovalView {
  return {
    approvalId: record.approvalId,
    missionId: record.missionId,
    taskId: record.taskId,
    executionId: record.executionId,
    policyId: record.policyId,
    status: record.status,
    requestedBy: record.requestedBy,
    reason: record.reason,
    evidence: record.evidence.map((item) => ({ ...item })),
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    decisionBy: record.decisionBy,
    decisionAt: record.decisionAt,
    decisionReason: record.decisionReason,
    revision: record.revision,
  };
}

import type { ApprovalAuditRecorder, ApprovalAuditReconciliationResult } from './ApprovalAudit.js';
import type { ApprovalStore } from './ApprovalStore.js';

export interface ApprovalAuditReconciliationServiceOptions {
  readonly store: ApprovalStore;
  readonly audit: ApprovalAuditRecorder;
}

export interface ApprovalAuditReconciliationReport {
  readonly scanned: number;
  readonly repaired: ApprovalAuditReconciliationResult[];
}

export class ApprovalAuditReconciliationService {
  private readonly store: ApprovalStore;
  private readonly audit: ApprovalAuditRecorder;

  constructor(options: ApprovalAuditReconciliationServiceOptions) {
    this.store = options.store;
    this.audit = options.audit;
  }

  reconcileAll(): ApprovalAuditReconciliationReport {
    const approvals = this.store.list();
    const repaired: ApprovalAuditReconciliationResult[] = [];

    for (const approval of approvals) {
      const result = this.audit.reconcile(approval);
      if (result.repaired.length > 0) {
        repaired.push(result);
      }
    }

    return {
      scanned: approvals.length,
      repaired,
    };
  }

  reconcile(approvalId: string): ApprovalAuditReconciliationResult {
    const approval = this.store.get(approvalId);
    if (!approval) throw new Error('APPROVAL_NOT_FOUND');
    return this.audit.reconcile(approval);
  }
}

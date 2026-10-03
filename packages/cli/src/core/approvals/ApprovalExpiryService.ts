import { ApprovalStoreConflictError, type ApprovalStore } from './ApprovalStore.js';
import { ApprovalController, type ApprovalDecisionResult } from './ApprovalController.js';
import type { ApprovalAuditRecorder } from './ApprovalAudit.js';

export interface ApprovalExpiryServiceOptions {
  readonly store: ApprovalStore;
  readonly controller?: ApprovalController;
  readonly now?: () => string;
  readonly expirationReason?: string;
  readonly audit?: ApprovalAuditRecorder;
}

export interface ApprovalExpiryConflict {
  readonly approvalId: string;
  readonly error: string;
}

export interface ApprovalExpiryResult {
  readonly now: string;
  readonly scanned: number;
  readonly expired: ApprovalDecisionResult['approval'][];
  readonly conflicts: ApprovalExpiryConflict[];
}

export class ApprovalExpiryService {
  private readonly store: ApprovalStore;
  private readonly controller: ApprovalController;
  private readonly now: () => string;
  private readonly expirationReason: string;

  constructor(options: ApprovalExpiryServiceOptions) {
    this.store = options.store;
    this.controller =
      options.controller ??
      new ApprovalController({
        store: options.store,
        now: options.now,
        audit: options.audit,
      });
    this.now = options.now ?? (() => new Date().toISOString());
    this.expirationReason = options.expirationReason ?? 'APPROVAL_EXPIRED';
  }

  expireDue(): ApprovalExpiryResult {
    const now = this.now();
    const pending = this.store.list({ status: 'pending' });
    const expired: ApprovalExpiryResult['expired'] = [];
    const conflicts: ApprovalExpiryConflict[] = [];

    for (const approval of pending) {
      if (approval.expiresAt === undefined || Date.parse(approval.expiresAt) > Date.parse(now)) {
        continue;
      }

      try {
        expired.push(
          this.controller.expire(
            approval.approvalId,
            this.expirationReason,
            approval.revision,
          ).approval,
        );
      } catch (error) {
        if (
          error instanceof ApprovalStoreConflictError ||
          (error instanceof Error && error.message.startsWith('APPROVAL_NOT_PENDING:'))
        ) {
          conflicts.push({
            approvalId: approval.approvalId,
            error: String(error.message),
          });
          continue;
        }
        throw error;
      }
    }

    return {
      now,
      scanned: pending.length,
      expired,
      conflicts,
    };
  }
}

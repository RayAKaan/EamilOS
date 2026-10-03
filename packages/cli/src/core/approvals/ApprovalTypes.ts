export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'consumed';

export type ApprovalScope = 'execution' | 'task' | 'mission';

export type ApprovalEvidenceKind =
  | 'command'
  | 'arguments'
  | 'working_directory'
  | 'environment'
  | 'resources'
  | 'capability'
  | 'execution_context'
  | 'artifact'
  | 'policy';

export interface ApprovalEvidence {
  readonly kind: ApprovalEvidenceKind;
  readonly name: string;
  readonly value: unknown;
  readonly sensitive?: boolean;
}

export interface ApprovalRequest {
  readonly approvalId: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly executionId: string;
  readonly requestId: string;
  readonly policyId: string;
  readonly scope: ApprovalScope;
  readonly requestedBy: string;
  readonly reason: string;
  readonly evidence: readonly ApprovalEvidence[];
  readonly createdAt: string;
  readonly expiresAt?: string;
}

export interface ApprovalDecision {
  readonly approvalId: string;
  readonly status: Exclude<ApprovalStatus, 'pending'>;
  readonly decisionBy: string;
  readonly decisionAt: string;
  readonly reason?: string;
}

export interface ApprovalRecord extends ApprovalRequest {
  readonly status: ApprovalStatus;
  readonly decisionBy?: string;
  readonly decisionAt?: string;
  readonly decisionReason?: string;
  readonly revision: number;
  readonly consumedAt?: string;
}

export interface ApprovalTransitionContext {
  readonly now: string;
  readonly actor: string;
  readonly reason?: string;
}

export type ApprovalTransition =
  | { readonly status: 'approved'; readonly decisionBy: string; readonly decisionAt: string; readonly decisionReason?: string }
  | { readonly status: 'rejected'; readonly decisionBy: string; readonly decisionAt: string; readonly decisionReason?: string }
  | { readonly status: 'expired'; readonly decisionAt: string; readonly decisionReason?: string }
  | { readonly status: 'cancelled'; readonly decisionAt: string; readonly decisionReason?: string }
  | { readonly status: 'consumed'; readonly consumedAt: string };

export const TERMINAL_APPROVAL_STATUSES: readonly ApprovalStatus[] = [
  'rejected',
  'expired',
  'cancelled',
  'consumed',
];

export function isApprovalTerminal(status: ApprovalStatus): boolean {
  return TERMINAL_APPROVAL_STATUSES.includes(status);
}

export function assertApprovalRequest(request: ApprovalRequest): void {
  const required: Array<keyof ApprovalRequest> = [
    'approvalId',
    'missionId',
    'taskId',
    'executionId',
    'requestId',
    'policyId',
    'requestedBy',
    'reason',
    'createdAt',
  ];

  for (const field of required) {
    const value = request[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Approval request requires a non-empty ${String(field)}`);
    }
  }

  if (!['execution', 'task', 'mission'].includes(request.scope)) {
    throw new Error(`Invalid approval scope: ${request.scope}`);
  }

  if (!Array.isArray(request.evidence)) {
    throw new Error('Approval request evidence must be an array');
  }

  assertTimestamp(request.createdAt, 'createdAt');
  if (request.expiresAt !== undefined) {
    assertTimestamp(request.expiresAt, 'expiresAt');
    if (request.expiresAt <= request.createdAt) {
      throw new Error('Approval request expiresAt must be later than createdAt');
    }
  }
}

export function assertApprovalTransition(
  current: ApprovalRecord,
  transition: ApprovalTransition,
): void {
  if (transition.status === 'consumed') {
    if (current.status !== 'approved') {
      throw new Error('Only an approved approval can be consumed');
    }
    return;
  }

  if (current.status !== 'pending') {
    throw new Error(
      `Approval ${current.approvalId} cannot transition from ${current.status}`,
    );
  }

}

function assertTimestamp(value: string, field: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`Approval ${field} must be a valid timestamp`);
  }
}

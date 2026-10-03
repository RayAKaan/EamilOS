import type { ApprovalRequest } from './ApprovalTypes.js';
import type {
  PolicyEvaluationContext,
  PolicyEvaluation,
  PolicyEngine,
} from './PolicyEngine.js';
import type { ApprovalStore } from './ApprovalStore.js';
import type { ScheduleDecision } from '../scheduler/GlobalSchedulerTypes.js';
import type { SchedulingCandidate } from '../scheduler/GlobalSchedulerTypes.js';
import type { FleetWorker } from '../comms/a2a/EamilosFleetRegistry.js';

export type ApprovalGateDecision =
  | { readonly decision: 'allow'; readonly policy: PolicyEvaluation }
  | { readonly decision: 'deny'; readonly policy: PolicyEvaluation }
  | {
      readonly decision: 'approval_required';
      readonly policy: PolicyEvaluation;
      readonly approval: ApprovalRequest;
    };

export interface ApprovalGateContext {
  readonly decision: ScheduleDecision;
  readonly candidate: SchedulingCandidate;
  readonly worker: FleetWorker;
  readonly policyContext: PolicyEvaluationContext;
  readonly approvalId?: string;
  readonly requestedBy?: string;
  readonly now?: string;
}

export interface ApprovalGateOptions {
  readonly policyEngine: PolicyEngine;
  readonly approvalStore: ApprovalStore;
  readonly approvalIdFor?: (decision: ScheduleDecision) => string;
  readonly requestIdFor?: (decision: ScheduleDecision) => string;
  readonly requestedBy?: string;
  readonly approvalScope?: ApprovalRequest['scope'];
  readonly approvalExpiresAt?: (now: string) => string | undefined;
}

export class ApprovalGate {
  private readonly options: ApprovalGateOptions;

  constructor(options: ApprovalGateOptions) {
    this.options = options;
  }

  evaluate(context: ApprovalGateContext): ApprovalGateDecision {
    const policy = this.options.policyEngine.evaluate(context.policyContext);

    if (policy.decision === 'allow') {
      return { decision: 'allow', policy };
    }

    if (policy.decision === 'deny') {
      return { decision: 'deny', policy };
    }

    const now = context.now ?? new Date().toISOString();
    const approvalId =
      context.approvalId ??
      this.options.approvalIdFor?.(context.decision) ??
      `approval_${context.decision.executionId}`;
    const requestId =
      this.options.requestIdFor?.(context.decision) ??
      context.decision.idempotencyKey;
    const requestedBy =
      context.requestedBy ??
      this.options.requestedBy ??
      context.decision.agentId;

    const existing = this.options.approvalStore.list({
      executionId: context.decision.executionId,
    });
    const matching = existing.find(
      (approval) =>
        approval.approvalId === approvalId &&
        approval.policyId === this.matchingPolicy(policy),
    );

    if (matching) {
      return {
        decision: 'approval_required',
        policy,
        approval: this.toRequest(matching),
      };
    }

    const request: ApprovalRequest = {
      approvalId,
      missionId: context.decision.missionId,
      taskId: context.decision.taskId,
      executionId: context.decision.executionId,
      requestId,
      policyId: this.matchingPolicy(policy),
      scope: this.options.approvalScope ?? 'execution',
      requestedBy,
      reason: policy.reason,
      evidence: [
        { kind: 'command', name: 'command', value: context.policyContext.command },
        { kind: 'arguments', name: 'arguments', value: context.policyContext.args ?? [] },
        ...(context.policyContext.cwd
          ? [{ kind: 'working_directory' as const, name: 'cwd', value: context.policyContext.cwd }]
          : []),
        ...(context.policyContext.resources
          ? [{ kind: 'resources' as const, name: 'resources', value: context.policyContext.resources }]
          : []),
        ...(context.policyContext.capabilities
          ? [{ kind: 'capability' as const, name: 'capabilities', value: context.policyContext.capabilities }]
          : []),
        { kind: 'policy', name: 'policy', value: policy.matchedPolicies },
        {
          kind: 'execution_context',
          name: 'execution',
          value: {
            workerId: context.decision.workerId,
            agentId: context.decision.agentId,
            harnessId: context.decision.harnessId,
          },
        },
      ],
      createdAt: now,
      expiresAt: this.options.approvalExpiresAt?.(now),
    };

    const record = this.options.approvalStore.create(request);

    return { decision: 'approval_required', policy, approval: this.toRequest(record) };
  }

  private matchingPolicy(policy: PolicyEvaluation): string {
    const approval = policy.matchedPolicies.find(
      (match) => match.effect === 'approval_required',
    );
    if (!approval) throw new Error('APPROVAL_POLICY_MISSING');
    return approval.policyId;
  }

  private toRequest(record: ApprovalRequest): ApprovalRequest {
    return record;
  }
}

export interface ApprovalGateDispatcherOptions {
  readonly gate: ApprovalGate;
  readonly dispatch: (
    decision: ScheduleDecision,
    candidate: SchedulingCandidate,
    worker: FleetWorker,
  ) => void;
}

export class ApprovalGateDispatcher {
  private readonly gate: ApprovalGate;
  private readonly dispatch: ApprovalGateDispatcherOptions['dispatch'];

  constructor(options: ApprovalGateDispatcherOptions) {
    this.gate = options.gate;
    this.dispatch = options.dispatch;
  }

  dispatchIfAuthorized(
    context: ApprovalGateContext,
  ): ApprovalGateDecision {
    const result = this.gate.evaluate(context);

    if (result.decision === 'allow') {
      this.dispatch(context.decision, context.candidate, context.worker);
    }

    return result;
  }
}

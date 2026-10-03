import type { ApprovalRecord } from './ApprovalTypes.js';
import type { PolicyEvaluationContext } from './PolicyEngine.js';

export interface ApprovalBindingContext {
  readonly approval: ApprovalRecord;
  readonly policyId: string;
  readonly policyContext: PolicyEvaluationContext;
}

export function assertApprovalBinding(context: ApprovalBindingContext): void {
  const { approval, policyId, policyContext } = context;

  if (approval.status !== 'approved') {
    throw new Error(`APPROVAL_NOT_AUTHORIZING:${approval.status}`);
  }

  if (
    approval.missionId !== policyContext.missionId ||
    approval.taskId !== policyContext.taskId ||
    approval.executionId !== policyContext.executionId ||
    approval.policyId !== policyId
  ) {
    throw new Error('APPROVAL_BINDING_MISMATCH');
  }

  const evidence = new Map(approval.evidence.map((item) => [item.name, item.value]));
  assertEvidence(evidence, 'command', policyContext.command);
  assertEvidence(evidence, 'arguments', policyContext.args ?? []);
  assertEvidence(evidence, 'cwd', policyContext.cwd);
  assertEvidence(evidence, 'resources', policyContext.resources);
  assertEvidence(evidence, 'capabilities', policyContext.capabilities);

  const execution = evidence.get('execution');
  if (
    !execution ||
    typeof execution !== 'object' ||
    (execution as Record<string, unknown>).workerId !== policyContext.workerId ||
    (execution as Record<string, unknown>).agentId !== policyContext.agentId ||
    (execution as Record<string, unknown>).harnessId !== policyContext.harnessId
  ) {
    throw new Error('APPROVAL_BINDING_MISMATCH:execution_context');
  }
}

function assertEvidence(
  evidence: Map<string, unknown>,
  name: string,
  actual: unknown,
): void {
  if (!evidence.has(name) || stableSerialize(evidence.get(name)) !== stableSerialize(actual)) {
    throw new Error(`APPROVAL_BINDING_MISMATCH:${name}`);
  }
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export type PolicyEffect = 'allow' | 'deny' | 'approval_required';

export interface PolicyResources {
  readonly readSet?: readonly string[];
  readonly writeSet?: readonly string[];
}

export interface PolicyEvaluationContext {
  readonly missionId: string;
  readonly taskId: string;
  readonly executionId: string;
  readonly workerId?: string;
  readonly agentId?: string;
  readonly harnessId?: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly resources?: PolicyResources;
  readonly capabilities?: readonly string[];
  readonly riskCategory?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PolicyRule {
  readonly policyId: string;
  readonly effect: PolicyEffect;
  readonly reason: string;
  readonly commands?: readonly string[];
  readonly commandPrefixes?: readonly string[];
  readonly workingDirectoryPrefixes?: readonly string[];
  readonly protectedResources?: readonly string[];
  readonly requiredCapabilities?: readonly string[];
  readonly riskCategories?: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
}

export interface PolicyMatch {
  readonly policyId: string;
  readonly effect: PolicyEffect;
  readonly reason: string;
}

export interface PolicyEvaluation {
  readonly decision: PolicyEffect;
  readonly reason: string;
  readonly matchedPolicies: readonly PolicyMatch[];
  readonly evaluatedAt: string;
}

export interface PolicyEngine {
  evaluate(context: PolicyEvaluationContext): PolicyEvaluation;
}

export interface DeterministicPolicyEngineOptions {
  readonly policies?: readonly PolicyRule[];
  readonly now?: () => string;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function hasAny(values: readonly string[] | undefined, candidates: readonly string[]): boolean {
  if (!values?.length) return true;
  const normalized = new Set(candidates.map(normalize));
  return values.some((value) => normalized.has(normalize(value)));
}

function hasAll(values: readonly string[] | undefined, candidates: readonly string[]): boolean {
  if (!values?.length) return true;
  const normalized = new Set(candidates.map(normalize));
  return values.every((value) => normalized.has(normalize(value)));
}

function hasProtectedResource(
  protectedResources: readonly string[] | undefined,
  resources: PolicyResources | undefined,
): boolean {
  if (!protectedResources?.length) return true;
  const requested = [
    ...(resources?.readSet ?? []),
    ...(resources?.writeSet ?? []),
  ].map(normalize);
  return protectedResources.some((resource) => {
    const wanted = normalize(resource);
    return requested.some(
      (candidate) =>
        candidate === wanted ||
        candidate.startsWith(`${wanted}/`) ||
        wanted.startsWith(`${candidate}/`),
    );
  });
}

function matchesEnvironment(
  expected: Readonly<Record<string, string>> | undefined,
  actual: Readonly<Record<string, string>> | undefined,
): boolean {
  if (!expected) return true;
  if (!actual) return false;
  return Object.entries(expected).every(
    ([key, value]) => actual[key] !== undefined && normalize(actual[key]) === normalize(value),
  );
}

function matches(rule: PolicyRule, context: PolicyEvaluationContext): boolean {
  if (rule.commands?.length && !rule.commands.some((command) => normalize(command) === normalize(context.command))) {
    return false;
  }

  if (
    rule.commandPrefixes?.length &&
    !rule.commandPrefixes.some((prefix) => normalize(context.command).startsWith(normalize(prefix)))
  ) {
    return false;
  }

  if (
    rule.workingDirectoryPrefixes?.length &&
    (!context.cwd ||
      !rule.workingDirectoryPrefixes.some((prefix) => {
        const cwd = normalize(context.cwd!);
        const root = normalize(prefix);
        return cwd === root || cwd.startsWith(root.endsWith('/') ? root : `${root}/`);
      }))
  ) {
    return false;
  }

  if (!hasProtectedResource(rule.protectedResources, context.resources)) {
    return false;
  }

  if (!hasAll(rule.requiredCapabilities, context.capabilities ?? [])) {
    return false;
  }

  if (
    rule.riskCategories?.length &&
    (!context.riskCategory ||
      !rule.riskCategories.some((risk) => normalize(risk) === normalize(context.riskCategory!)))
  ) {
    return false;
  }

  return matchesEnvironment(rule.environment, context.environment);
}

function validatePolicy(rule: PolicyRule): void {
  if (!rule.policyId.trim()) throw new Error('Policy requires a non-empty policyId');
  if (!rule.reason.trim()) throw new Error(`Policy ${rule.policyId} requires a reason`);
  if (!['allow', 'deny', 'approval_required'].includes(rule.effect)) {
    throw new Error(`Invalid policy effect: ${rule.effect}`);
  }
}

export class DeterministicPolicyEngine implements PolicyEngine {
  private readonly policies: readonly PolicyRule[];
  private readonly now: () => string;

  constructor(options: DeterministicPolicyEngineOptions = {}) {
    const policies = [...(options.policies ?? [])];
    policies.forEach(validatePolicy);

    const ids = new Set<string>();
    for (const policy of policies) {
      if (ids.has(policy.policyId)) {
        throw new Error(`Duplicate policyId: ${policy.policyId}`);
      }
      ids.add(policy.policyId);
    }

    this.policies = policies.sort((a, b) => a.policyId.localeCompare(b.policyId));
    this.now = options.now ?? (() => new Date().toISOString());
  }

  evaluate(context: PolicyEvaluationContext): PolicyEvaluation {
    if (!context.missionId.trim() || !context.taskId.trim() || !context.executionId.trim()) {
      throw new Error('Policy evaluation requires missionId, taskId, and executionId');
    }
    if (!context.command.trim()) {
      throw new Error('Policy evaluation requires a non-empty command');
    }

    const matchedPolicies = this.policies
      .filter((policy) => matches(policy, context))
      .map(({ policyId, effect, reason }) => ({ policyId, effect, reason }));

    const denied = matchedPolicies.filter((match) => match.effect === 'deny');
    const approvals = matchedPolicies.filter((match) => match.effect === 'approval_required');

    if (denied.length) {
      return {
        decision: 'deny',
        reason: denied.map((match) => `[${match.policyId}] ${match.reason}`).join('; '),
        matchedPolicies,
        evaluatedAt: this.now(),
      };
    }

    if (approvals.length) {
      return {
        decision: 'approval_required',
        reason: approvals.map((match) => `[${match.policyId}] ${match.reason}`).join('; '),
        matchedPolicies,
        evaluatedAt: this.now(),
      };
    }

    return {
      decision: 'allow',
      reason: 'No matching policy requires restriction',
      matchedPolicies,
      evaluatedAt: this.now(),
    };
  }
}

export function allowAllPolicyEngine(now?: () => string): PolicyEngine {
  return new DeterministicPolicyEngine({ now });
}

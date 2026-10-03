import { describe, expect, it } from 'vitest';
import {
  DeterministicPolicyEngine,
  type PolicyEvaluationContext,
  type PolicyRule,
} from './PolicyEngine.js';

const context: PolicyEvaluationContext = {
  missionId: 'mission-1',
  taskId: 'task-1',
  executionId: 'execution-1',
  workerId: 'worker-1',
  agentId: 'agent-1',
  harnessId: 'harness-1',
  command: 'npm',
  args: ['publish'],
  cwd: '/workspace/project',
  environment: { NODE_ENV: 'production' },
  resources: {
    readSet: ['packages'],
    writeSet: ['registry'],
  },
  capabilities: ['network', 'publish'],
  riskCategory: 'production',
};

function engine(...policies: PolicyRule[]) {
  return new DeterministicPolicyEngine({
    policies,
    now: () => '2026-10-03T17:00:00.000Z',
  });
}

describe('DeterministicPolicyEngine', () => {
  it('allows when no policy matches', () => {
    const result = engine().evaluate(context);

    expect(result.decision).toBe('allow');
    expect(result.matchedPolicies).toEqual([]);
    expect(result.evaluatedAt).toBe('2026-10-03T17:00:00.000Z');
  });

  it('requires approval for a protected production resource', () => {
    const result = engine({
        policyId: 'production-publish',
        effect: 'approval_required',
        reason: 'protected registry write',
        commands: ['npm'],
        protectedResources: ['registry'],
      }).evaluate(context);

    expect(result.decision).toBe('approval_required');
    expect(result.matchedPolicies.map((match) => match.policyId)).toEqual([
      'production-publish',
    ]);
  });

  it('denies when a deny policy matches', () => {
    const result = engine({
        policyId: 'blocked-publish',
        effect: 'deny',
        reason: 'publishing is disabled',
        commandPrefixes: ['npm'],
      },
    } as never).evaluate(context);

    expect(result.decision).toBe('deny');
  });

  it('gives deny precedence over approval_required regardless of policy order', () => {
    const result = engine(
      {
        policyId: 'z-approval',
        effect: 'approval_required',
        reason: 'human authorization required',
        protectedResources: ['registry'],
      },
      {
        policyId: 'a-deny',
        effect: 'deny',
        reason: 'registry writes disabled',
        protectedResources: ['registry'],
      },
    ).evaluate(context);

    expect(result.decision).toBe('deny');
    expect(result.matchedPolicies.map((match) => match.policyId)).toEqual([
      'a-deny',
      'z-approval',
    ]);
  });

  it('requires all declared capabilities', () => {
    const policy: PolicyRule = {
      policyId: 'elevated-network',
      effect: 'approval_required',
      reason: 'network and publish capability',
      requiredCapabilities: ['network', 'publish'],
    };

    expect(engine(policy).evaluate(context).decision).toBe('approval_required');
    expect(
      engine(policy).evaluate({
        ...context,
        capabilities: ['network'],
      }).decision,
    ).toBe('allow');
  });

  it('matches production risk and environment deterministically', () => {
    const policy: PolicyRule = {
      policyId: 'production-risk',
      effect: 'approval_required',
      reason: 'production execution',
      riskCategories: ['production'],
      environment: { NODE_ENV: 'production' },
    };

    expect(engine(policy).evaluate(context).decision).toBe('approval_required');
    expect(
      engine(policy).evaluate({
        ...context,
        environment: { NODE_ENV: 'development' },
      }).decision,
    ).toBe('allow');
  });

  it('matches workspace roots without treating sibling paths as descendants', () => {
    const policy: PolicyRule = {
      policyId: 'protected-workspace',
      effect: 'approval_required',
      reason: 'protected workspace',
      workingDirectoryPrefixes: ['/workspace/protected'],
    };

    expect(
      engine(policy).evaluate({
        ...context,
        cwd: '/workspace/protected/app',
      }).decision,
    ).toBe('approval_required');

    expect(
      engine(policy).evaluate({
        ...context,
        cwd: '/workspace/protected-other',
      }).decision,
    ).toBe('allow');
  });

  it('rejects duplicate policy IDs and invalid policies', () => {
    expect(
      () =>
        new DeterministicPolicyEngine({
          policies: [
            {
              policyId: 'same',
              effect: 'allow',
              reason: 'one',
            },
            {
              policyId: 'same',
              effect: 'deny',
              reason: 'two',
            },
          ],
        }),
    ).toThrow('Duplicate policyId');

    expect(
      () =>
        new DeterministicPolicyEngine({
          policies: [
            {
              policyId: '',
              effect: 'deny',
              reason: 'blocked',
            },
          ],
        }),
    ).toThrow('non-empty policyId');
  });

  it('requires evaluation correlation fields', () => {
    expect(() =>
      engine().evaluate({
        ...context,
        executionId: '',
      }),
    ).toThrow('missionId, taskId, and executionId');

    expect(() =>
      engine().evaluate({
        ...context,
        command: '',
      }),
    ).toThrow('non-empty command');
  });

  it('evaluates multiple matching approvals in deterministic policy order', () => {
    const result = engine(
      {
        policyId: 'z-risk',
        effect: 'approval_required',
        reason: 'risk',
        riskCategories: ['production'],
      },
      {
        policyId: 'a-resource',
        effect: 'approval_required',
        reason: 'protected resource',
        protectedResources: ['registry'],
      },
    ).evaluate(context);

    expect(result.decision).toBe('approval_required');
    expect(result.reason).toBe(
      '[a-resource] protected resource; [z-risk] risk',
    );
  });
});

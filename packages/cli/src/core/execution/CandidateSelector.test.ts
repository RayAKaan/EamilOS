import { describe, expect, it } from 'vitest';
import { CandidateSelector } from './CandidateSelector.js';
import { getFailureRecoveryDecision } from './FailurePolicy.js';
import type { HarnessDescriptor } from './types.js';
import type { TaskNode } from '../mission/types.js';

const harness = (id: string, status: HarnessDescriptor['status'] = 'AVAILABLE'): HarnessDescriptor => ({
  id,
  name: id,
  kind: 'cli',
  provider: id,
  args: [],
  capabilities: {
    codeGeneration: true,
    fileEditing: true,
    commandExecution: true,
    webResearch: false,
    communication: true,
    execution: true,
    local: true,
    remote: false,
    streaming: true,
    cancellation: true,
    checkpointResume: false,
    workspaceIsolation: true,
    multimodal: false,
    longContext: true,
  },
  supportedModes: ['execution'],
  status,
  availability: {
    installed: true,
    authenticated: true,
    executable: true,
    checkedAt: new Date().toISOString(),
  },
});

const task: TaskNode = {
  id: 'task_1',
  missionId: 'mission_1',
  title: 'Implement feature',
  description: 'Implement feature',
  state: 'READY',
  priority: 'HIGH',
  dependencies: [],
  requiredCapabilities: ['codeGeneration', 'fileEditing'],
  acceptanceCriteria: [],
  inputs: {},
  outputs: {},
  artifacts: [],
  evidenceIds: [],
  attempt: 0,
  maxAttempts: 3,
  idempotencyKey: 'task_1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('CandidateSelector', () => {
  it('selects a compatible available harness deterministically', () => {
    const selector = new CandidateSelector();
    const result = selector.select({
      task,
      harnesses: [harness('zeta'), harness('alpha')],
    });

    expect(result?.harnessId).toBe('alpha');
  });

  it('rejects unavailable or excluded harnesses', () => {
    const selector = new CandidateSelector();

    expect(selector.select({
      task,
      harnesses: [harness('alpha', 'UNAVAILABLE')],
    })).toBeNull();

    expect(selector.select({
      task,
      harnesses: [harness('alpha')],
      excludedHarnesses: new Set(['alpha']),
    })).toBeNull();
  });

  it('does not select a harness missing a required capability', () => {
    const selector = new CandidateSelector();
    const limited = {
      ...harness('limited'),
      capabilities: {
        ...harness('limited').capabilities,
        fileEditing: false,
      },
    };

    expect(selector.select({ task, harnesses: [limited] })).toBeNull();
  });
});

describe('FailurePolicy', () => {
  it('routes quota exhaustion to checkpoint and fallback', () => {
    expect(getFailureRecoveryDecision('QUOTA_EXHAUSTED')).toEqual({
      retrySameHarness: false,
      fallbackToAnotherHarness: true,
      checkpointBeforeRecovery: true,
      requiresUser: false,
      nextState: 'QUOTA_EXHAUSTED',
    });
  });

  it('requires user intervention for permission denial', () => {
    const decision = getFailureRecoveryDecision('PERMISSION_DENIED');
    expect(decision.requiresUser).toBe(true);
    expect(decision.fallbackToAnotherHarness).toBe(false);
  });
});

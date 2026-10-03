import { describe, expect, it } from 'vitest';
import {
  assertApprovalRequest,
  assertApprovalTransition,
  isApprovalTerminal,
  type ApprovalRecord,
  type ApprovalRequest,
} from './ApprovalTypes.js';

const request: ApprovalRequest = {
  approvalId: 'approval-1',
  missionId: 'mission-1',
  taskId: 'task-1',
  executionId: 'execution-1',
  requestId: 'request-1',
  policyId: 'policy-production-publish',
  scope: 'execution',
  requestedBy: 'agent-1',
  reason: 'Protected registry write requires human authorization',
  evidence: [
    { kind: 'command', name: 'command', value: 'npm' },
    { kind: 'arguments', name: 'arguments', value: ['publish'] },
  ],
  createdAt: '2026-10-03T12:00:00.000Z',
  expiresAt: '2026-10-03T13:00:00.000Z',
};

const record: ApprovalRecord = {
  ...request,
  status: 'pending',
  revision: 1,
};

describe('approval contract', () => {
  it('accepts a complete approval request', () => {
    expect(() => assertApprovalRequest(request)).not.toThrow();
  });

  it('requires lifecycle correlation fields', () => {
    expect(() => assertApprovalRequest({
      ...request,
      executionId: '',
    })).toThrow('executionId');

    expect(() => assertApprovalRequest({
      ...request,
      requestId: '',
    })).toThrow('requestId');

    expect(() => assertApprovalRequest({
      ...request,
      policyId: '',
    })).toThrow('policyId');
  });

  it('rejects invalid expiry ordering', () => {
    expect(() => assertApprovalRequest({
      ...request,
      expiresAt: request.createdAt,
    })).toThrow('expiresAt must be later than createdAt');
  });

  it('allows exactly one decision transition from pending', () => {
    expect(() => assertApprovalTransition(record, {
      status: 'approved',
      decisionBy: 'human-1',
      decisionAt: '2026-10-03T12:05:00.000Z',
    })).not.toThrow();

    expect(() => assertApprovalTransition(record, {
      status: 'rejected',
      decisionBy: 'human-1',
      decisionAt: '2026-10-03T12:05:00.000Z',
    })).not.toThrow();

    expect(() => assertApprovalTransition(record, {
      status: 'expired',
      decisionAt: '2026-10-03T13:00:00.000Z',
    })).not.toThrow();

    expect(() => assertApprovalTransition(record, {
      status: 'cancelled',
      decisionAt: '2026-10-03T12:10:00.000Z',
    })).not.toThrow();
  });

  it('does not permit approval reuse after a terminal decision', () => {
    for (const status of ['rejected', 'expired', 'cancelled', 'consumed'] as const) {
      const terminal = { ...record, status };
      expect(() => assertApprovalTransition(terminal, {
        status: 'rejected',
        decisionBy: 'human-2',
        decisionAt: '2026-10-03T12:15:00.000Z',
      })).toThrow('cannot transition');
    }
  });

  it('keeps consumption separate from the decision transition', () => {
    expect(() => assertApprovalTransition(record, {
      status: 'consumed',
      consumedAt: '2026-10-03T12:05:00.000Z',
    })).toThrow('Only an approved approval can be consumed');

    const approved = { ...record, status: 'approved' as const };
    expect(() => assertApprovalTransition(approved, {
      status: 'consumed',
      consumedAt: '2026-10-03T12:06:00.000Z',
    })).not.toThrow();
  });

  it('identifies terminal states deterministically', () => {
    expect(isApprovalTerminal('pending')).toBe(false);
    expect(isApprovalTerminal('approved')).toBe(false);
    expect(isApprovalTerminal('rejected')).toBe(true);
    expect(isApprovalTerminal('expired')).toBe(true);
    expect(isApprovalTerminal('cancelled')).toBe(true);
    expect(isApprovalTerminal('consumed')).toBe(true);
  });
});

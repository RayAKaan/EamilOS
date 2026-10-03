import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ApprovalAuditRecorder } from './ApprovalAudit.js';
import { ApprovalExpiryService } from './ApprovalExpiryService.js';
import { InMemoryApprovalStore, SqliteApprovalStore } from './ApprovalStore.js';
import { EamilosSqliteDistributedEventLog } from '../comms/a2a/EamilosDistributedEventLog.js';
import type { ApprovalRequest } from './ApprovalTypes.js';

function request(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    approvalId: randomUUID(),
    missionId: 'mission-1',
    taskId: 'task-1',
    executionId: randomUUID(),
    requestId: randomUUID(),
    policyId: 'policy-1',
    scope: 'execution',
    requestedBy: 'agent-1',
    reason: 'protected action',
    evidence: [{ kind: 'command', name: 'command', value: 'npm publish', sensitive: true }],
    createdAt: '2026-10-03T10:00:00.000Z',
    expiresAt: '2026-10-03T11:00:00.000Z',
    ...overrides,
  };
}

describe('ApprovalExpiryService', () => {
  it('expires due approvals exactly once and leaves future approvals pending', () => {
    const store = new InMemoryApprovalStore();
    store.create(request({ approvalId: 'due', expiresAt: '2026-10-03T11:00:00.000Z' }));
    store.create(request({ approvalId: 'future', expiresAt: '2026-10-03T12:00:00.000Z' }));

    const service = new ApprovalExpiryService({
      store,
      now: () => '2026-10-03T11:00:00.000Z',
    });

    const first = service.expireDue();
    const second = service.expireDue();

    expect(first.expired.map((approval) => approval.approvalId)).toEqual(['due']);
    expect(first.expired[0]?.status).toBe('expired');
    expect(first.expired[0]?.revision).toBe(2);
    expect(first.conflicts).toEqual([]);
    expect(second.expired).toEqual([]);
    expect(store.get('future')?.status).toBe('pending');
  });

  it('does not overwrite human decisions', () => {
    const store = new InMemoryApprovalStore();
    const created = store.create(request({ approvalId: 'race' }));
    store.transition('race', {
      status: 'approved',
      decisionBy: 'human-1',
      decisionAt: '2026-10-03T10:30:00.000Z',
    }, created.revision);

    const service = new ApprovalExpiryService({
      store,
      now: () => '2026-10-03T11:00:00.000Z',
    });

    const result = service.expireDue();
    expect(result.expired).toEqual([]);
    expect(store.get('race')?.status).toBe('approved');
  });

  it('persists expiry across SQLite restart and records the audit event', () => {
    const filename = join(tmpdir(), `eamilos-approval-expiry-${randomUUID()}.sqlite`);
    const first = new SqliteApprovalStore({ filename });
    first.create(request({
      approvalId: 'restart-expiry',
      expiresAt: '2026-10-03T11:00:00.000Z',
    }));
    first.close();

    const second = new SqliteApprovalStore({ filename });
    const log = new EamilosSqliteDistributedEventLog({ filename: ':memory:' });
    const audit = new ApprovalAuditRecorder({ eventLog: log });
    const service = new ApprovalExpiryService({
      store: second,
      audit,
      now: () => '2026-10-03T11:01:00.000Z',
    } as never);

    const result = service.expireDue();
    expect(result.expired[0]?.status).toBe('expired');
    expect(second.get('restart-expiry')?.revision).toBe(2);
    expect(log.list().map((event) => event.eventType)).toEqual(['approval.expired']);
    expect(JSON.stringify(log.list())).not.toContain('npm publish');
    log.verifyIntegrity();

    second.close();
    log.close();
  });

  it('reports optimistic-concurrency conflicts without failing the reconciliation pass', () => {
    const store = new InMemoryApprovalStore();
    store.create(request({ approvalId: 'conflict' }));
    const service = new ApprovalExpiryService({
      store,
      now: () => '2026-10-03T11:00:00.000Z',
    });

    const current = store.get('conflict');
    if (!current) throw new Error('missing approval');
    store.transition('conflict', {
      status: 'approved',
      decisionBy: 'human-1',
      decisionAt: '2026-10-03T10:59:00.000Z',
    }, current.revision);

    const result = service.expireDue();
    expect(result.expired).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });
});

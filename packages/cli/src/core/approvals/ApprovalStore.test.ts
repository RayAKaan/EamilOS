import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ApprovalStoreConflictError,
  InMemoryApprovalStore,
  SqliteApprovalStore,
  type ApprovalRequest,
} from './ApprovalStore.js';

function request(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    approvalId: randomUUID(),
    missionId: 'mission-1',
    taskId: 'task-1',
    executionId: 'execution-1',
    requestId: 'request-1',
    policyId: 'policy-1',
    scope: 'execution',
    requestedBy: 'agent-1',
    reason: 'protected action',
    evidence: [
      { kind: 'command', name: 'command', value: 'npm publish' },
    ],
    createdAt: '2026-10-03T10:00:00.000Z',
    ...overrides,
  };
}

function runStoreContract(factory: () => {
  create: InMemoryApprovalStore['create'];
  get: InMemoryApprovalStore['get'];
  list: InMemoryApprovalStore['list'];
  transition: InMemoryApprovalStore['transition'];
  close?: () => void;
}): void {
  const store = factory();
  const first = store.create(request({ approvalId: 'approval-1' }));

  expect(first.status).toBe('pending');
  expect(first.revision).toBe(1);
  expect(store.get('approval-1')).toEqual(first);

  expect(() =>
    store.create(request({ approvalId: 'approval-1' })),
  ).toThrow(ApprovalStoreConflictError);

  const approved = store.transition(
    'approval-1',
    {
      status: 'approved',
      decisionBy: 'human-1',
      decisionAt: '2026-10-03T10:01:00.000Z',
    },
    first.revision,
  );

  expect(approved.status).toBe('approved');
  expect(approved.revision).toBe(2);

  const consumed = store.transition(
    'approval-1',
    {
      status: 'consumed',
      consumedAt: '2026-10-03T10:02:00.000Z',
    },
    approved.revision,
  );

  expect(consumed.status).toBe('consumed');
  expect(consumed.revision).toBe(3);

  expect(() =>
    store.transition(
      'approval-1',
      {
        status: 'rejected',
        decisionBy: 'human-2',
        decisionAt: '2026-10-03T10:03:00.000Z',
      },
      consumed.revision,
    ),
  ).toThrow('cannot transition');

  expect(() =>
    store.transition(
      'approval-1',
      {
        status: 'consumed',
        consumedAt: '2026-10-03T10:04:00.000Z',
      },
      1,
    ),
  ).toThrow('cannot transition');

  expect(() =>
    store.transition(
      'approval-1',
      {
        status: 'approved',
        decisionBy: 'human-2',
        decisionAt: '2026-10-03T10:05:00.000Z',
      },
      1,
    ),
  ).toThrow(ApprovalStoreConflictError);

  const filtered = store.list({
    executionId: 'execution-1',
    status: 'consumed',
  });
  expect(filtered).toHaveLength(1);
  expect(filtered[0]?.approvalId).toBe('approval-1');

  store.close?.();
}

describe('InMemoryApprovalStore', () => {
  it('enforces the approval lifecycle and optimistic revisions', () => {
    runStoreContract(() => new InMemoryApprovalStore());
  });

  it('keeps deterministic query ordering', () => {
    const store = new InMemoryApprovalStore();
    store.create(request({
      approvalId: 'b',
      createdAt: '2026-10-03T10:00:00.000Z',
    }));
    store.create(request({
      approvalId: 'a',
      createdAt: '2026-10-03T10:00:00.000Z',
    }));

    expect(store.list().map((item) => item.approvalId)).toEqual(['a', 'b']);
  });
});

describe('SqliteApprovalStore', () => {
  it('enforces the same contract on SQLite', () => {
    runStoreContract(() =>
      new SqliteApprovalStore({
        filename: join(tmpdir(), `eamilos-approval-${randomUUID()}.sqlite`),
      }),
    );
  });

  it('survives restart without implicitly approving pending requests', () => {
    const filename = join(
      tmpdir(),
      `eamilos-approval-restart-${randomUUID()}.sqlite`,
    );

    const firstStore = new SqliteApprovalStore({ filename });
    firstStore.create(request({ approvalId: 'pending-1' }));
    firstStore.close();

    const secondStore = new SqliteApprovalStore({ filename });
    const recovered = secondStore.get('pending-1');

    expect(recovered?.status).toBe('pending');
    expect(recovered?.revision).toBe(1);

    secondStore.close();
  });

  it('persists decisions and prevents stale concurrent transitions', () => {
    const filename = join(
      tmpdir(),
      `eamilos-approval-concurrency-${randomUUID()}.sqlite`,
    );

    const first = new SqliteApprovalStore({ filename });
    const second = new SqliteApprovalStore({ filename });

    const created = first.create(request({ approvalId: 'concurrent-1' }));

    const approved = first.transition(
      created.approvalId,
      {
        status: 'approved',
        decisionBy: 'human-1',
        decisionAt: '2026-10-03T10:01:00.000Z',
      },
      created.revision,
    );

    expect(() =>
      second.transition(
        created.approvalId,
        {
          status: 'rejected',
          decisionBy: 'human-2',
          decisionAt: '2026-10-03T10:01:01.000Z',
        },
        created.revision,
      ),
    ).toThrow(ApprovalStoreConflictError);

    expect(second.get(created.approvalId)?.status).toBe('approved');
    expect(approved.revision).toBe(2);

    first.close();
    second.close();
  });

  it('persists evidence and correlation fields exactly across restart', () => {
    const filename = join(
      tmpdir(),
      `eamilos-approval-evidence-${randomUUID()}.sqlite`,
    );

    const first = new SqliteApprovalStore({ filename });
    const created = first.create(
      request({
        approvalId: 'evidence-1',
        evidence: [
          { kind: 'command', name: 'command', value: 'npm publish' },
          { kind: 'resources', name: 'writeSet', value: ['registry'] },
        ],
      }),
    );
    first.close();

    const second = new SqliteApprovalStore({ filename });
    expect(second.get(created.approvalId)).toEqual(created);
    second.close();
  });
});

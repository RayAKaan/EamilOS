import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EamilosSqliteResourceLeaseManager, ResourceConflictError } from './EamilosResourceLeaseManager.js';

function db() {
  const directory = mkdtempSync(join(tmpdir(), 'eamilos-lock-'));
  return { directory, filename: join(directory, 'leases.sqlite') };
}

const base = {
  executionId: 'execution-a',
  ownerId: 'worker-a',
  resources: { readSet: [], writeSet: ['repo/main'] },
  ttlMs: 10_000,
};

describe('EamilosSqliteResourceLeaseManager', () => {
  it('atomically grants exclusive write leases and rejects conflicting writers', () => {
    const { directory, filename } = db();
    try {
      const a = new EamilosSqliteResourceLeaseManager({ filename });
      const lease = a.acquire(base, 1_000);
      expect(lease.fencingToken).toBe(1);

      expect(() => a.acquire({
        ...base,
        executionId: 'execution-b',
        ownerId: 'worker-b',
      }, 2_000)).toThrow(ResourceConflictError);

      a.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('allows compatible concurrent readers but blocks a writer', () => {
    const { directory, filename } = db();
    try {
      const manager = new EamilosSqliteResourceLeaseManager({ filename });
      manager.acquire({
        executionId: 'reader-a',
        ownerId: 'worker-a',
        resources: { readSet: ['repo/main'], writeSet: [] },
        ttlMs: 10_000,
      }, 1_000);
      manager.acquire({
        executionId: 'reader-b',
        ownerId: 'worker-b',
        resources: { readSet: ['repo/main'], writeSet: [] },
        ttlMs: 10_000,
      }, 2_000);

      expect(() => manager.acquire({
        executionId: 'writer',
        ownerId: 'worker-c',
        resources: { readSet: [], writeSet: ['repo/main'] },
        ttlMs: 10_000,
      }, 3_000)).toThrow(ResourceConflictError);

      manager.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('is idempotent for the same execution and resource set', () => {
    const { directory, filename } = db();
    try {
      const manager = new EamilosSqliteResourceLeaseManager({ filename });
      const first = manager.acquire(base, 1_000);
      const second = manager.acquire(base, 2_000);
      expect(second.leaseId).toBe(first.leaseId);
      expect(second.fencingToken).toBe(first.fencingToken);
      manager.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects an execution from changing its resources while leased', () => {
    const { directory, filename } = db();
    try {
      const manager = new EamilosSqliteResourceLeaseManager({ filename });
      manager.acquire(base, 1_000);
      expect(() => manager.acquire({
        ...base,
        resources: { readSet: ['other'], writeSet: [] },
      }, 2_000)).toThrow('EXECUTION_ALREADY_HOLDS_DIFFERENT_RESOURCES');
      manager.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('renews only with the correct owner and fencing token', () => {
    const { directory, filename } = db();
    try {
      const manager = new EamilosSqliteResourceLeaseManager({ filename });
      const lease = manager.acquire(base, 1_000);
      expect(() => manager.renew(lease.leaseId, 'worker-b', lease.fencingToken, 10_000, 2_000))
        .toThrow('LEASE_FENCING_TOKEN_MISMATCH');
      expect(() => manager.renew(lease.leaseId, 'worker-a', lease.fencingToken + 1, 10_000, 2_000))
        .toThrow('LEASE_FENCING_TOKEN_MISMATCH');

      const renewed = manager.renew(lease.leaseId, 'worker-a', lease.fencingToken, 10_000, 2_000);
      expect(Date.parse(renewed.expiresAt)).toBe(12_000);
      manager.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('expires leases and permits acquisition after expiry', () => {
    const { directory, filename } = db();
    try {
      const manager = new EamilosSqliteResourceLeaseManager({ filename });
      manager.acquire(base, 1_000);
      expect(manager.getByExecution(base.executionId, 11_000)).toBeUndefined();

      const replacement = manager.acquire({
        ...base,
        executionId: 'execution-b',
        ownerId: 'worker-b',
      }, 11_001);
      expect(replacement.fencingToken).toBe(2);
      manager.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('releases only with the current fencing token and persists fencing monotonicity', () => {
    const { directory, filename } = db();
    try {
      const first = new EamilosSqliteResourceLeaseManager({ filename });
      const lease = first.acquire(base, 1_000);
      expect(() => first.release(lease.leaseId, 'worker-b', lease.fencingToken)).toThrow('LEASE_FENCING_TOKEN_MISMATCH');
      expect(first.release(lease.leaseId, 'worker-a', lease.fencingToken)).toBe(true);
      first.close();

      const second = new EamilosSqliteResourceLeaseManager({ filename });
      const replacement = second.acquire({
        ...base,
        executionId: 'execution-b',
        ownerId: 'worker-b',
      }, 2_000);
      expect(replacement.fencingToken).toBe(2);
      second.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects read/write overlap in one request', () => {
    const { directory, filename } = db();
    try {
      const manager = new EamilosSqliteResourceLeaseManager({ filename });
      expect(() => manager.acquire({
        ...base,
        resources: { readSet: ['repo/main'], writeSet: ['repo/main'] },
      })).toThrow('RESOURCE_READ_WRITE_OVERLAP:repo/main');
      manager.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('recovers active leases after reopening the database', () => {
    const { directory, filename } = db();
    try {
      const first = new EamilosSqliteResourceLeaseManager({ filename });
      const lease = first.acquire(base, 1_000);
      first.close();

      const second = new EamilosSqliteResourceLeaseManager({ filename });
      const restored = second.get(lease.leaseId, 2_000);
      expect(restored?.executionId).toBe(base.executionId);
      expect(restored?.fencingToken).toBe(lease.fencingToken);
      expect(() => second.acquire({
        ...base,
        executionId: 'execution-b',
        ownerId: 'worker-b',
      }, 2_000)).toThrow(ResourceConflictError);
      second.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

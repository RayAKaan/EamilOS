import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

export type ResourceLockMode = 'read' | 'write';

export interface ResourceLeaseRequest {
  executionId: string;
  ownerId: string;
  resources: {
    readSet: string[];
    writeSet: string[];
  };
  ttlMs: number;
}

export interface ResourceLease {
  leaseId: string;
  executionId: string;
  ownerId: string;
  resources: {
    readSet: string[];
    writeSet: string[];
  };
  fencingToken: number;
  acquiredAt: string;
  expiresAt: string;
}

export interface ResourceLeaseManager {
  acquire(request: ResourceLeaseRequest, now?: number): ResourceLease;
  renew(leaseId: string, ownerId: string, fencingToken: number, ttlMs: number, now?: number): ResourceLease;
  release(leaseId: string, ownerId: string, fencingToken: number, now?: number): boolean;
  get(leaseId: string, now?: number): ResourceLease | undefined;
  getByExecution(executionId: string, now?: number): ResourceLease | undefined;
  reapExpired(now?: number): number;
  close?: () => void;
}

export interface SqliteResourceLeaseManagerOptions {
  filename: string;
  busyTimeoutMs?: number;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS eamilos_resource_lease_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    next_fencing_token INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS eamilos_resource_leases (
    lease_id TEXT PRIMARY KEY NOT NULL,
    execution_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    fencing_token INTEGER NOT NULL UNIQUE,
    acquired_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS eamilos_resource_claims (
    lease_id TEXT NOT NULL,
    resource TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('read', 'write')),
    PRIMARY KEY (lease_id, resource),
    FOREIGN KEY (lease_id) REFERENCES eamilos_resource_leases(lease_id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_eamilos_resource_claims_resource
    ON eamilos_resource_claims(resource);

  CREATE INDEX IF NOT EXISTS idx_eamilos_resource_leases_execution
    ON eamilos_resource_leases(execution_id);
`;

export class EamilosSqliteResourceLeaseManager implements ResourceLeaseManager {
  private readonly db: Database.Database;
  private readonly acquireTransaction: (request: ResourceLeaseRequest, now: number) => ResourceLease;
  private readonly renewTransaction: (leaseId: string, ownerId: string, fencingToken: number, ttlMs: number, now: number) => ResourceLease;
  private readonly releaseTransaction: (leaseId: string, ownerId: string, fencingToken: number, now: number) => boolean;
  private readonly reapTransaction: (now: number) => number;

  constructor(options: SqliteResourceLeaseManagerOptions) {
    this.db = new Database(options.filename);
    this.db.pragma(`busy_timeout = ${Math.max(0, Math.floor(options.busyTimeoutMs ?? 5000))}`);
    this.db.pragma('foreign_keys = ON');
    if (options.filename !== ':memory:') this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
    this.db.prepare(
      'INSERT OR IGNORE INTO eamilos_resource_lease_meta (id, next_fencing_token) VALUES (1, 0)',
    ).run();

    this.acquireTransaction = this.db.transaction((request, now) => this.acquireUnsafe(request, now));
    this.renewTransaction = this.db.transaction((leaseId, ownerId, fencingToken, ttlMs, now) =>
      this.renewUnsafe(leaseId, ownerId, fencingToken, ttlMs, now));
    this.releaseTransaction = this.db.transaction((leaseId, ownerId, fencingToken, now) =>
      this.releaseUnsafe(leaseId, ownerId, fencingToken, now));
    this.reapTransaction = this.db.transaction(now => this.reapUnsafe(now));
  }

  acquire(request: ResourceLeaseRequest, now = Date.now()): ResourceLease {
    validateRequest(request);
    return this.acquireTransaction(request, now);
  }

  renew(
    leaseId: string,
    ownerId: string,
    fencingToken: number,
    ttlMs: number,
    now = Date.now(),
  ): ResourceLease {
    validateTtl(ttlMs);
    return this.renewTransaction(leaseId, ownerId, fencingToken, ttlMs, now);
  }

  release(
    leaseId: string,
    ownerId: string,
    fencingToken: number,
    now = Date.now(),
  ): boolean {
    return this.releaseTransaction(leaseId, ownerId, fencingToken, now);
  }

  get(leaseId: string, now = Date.now()): ResourceLease | undefined {
    this.reapUnsafe(now);
    const row = this.db.prepare(
      'SELECT * FROM eamilos_resource_leases WHERE lease_id = ? AND expires_at > ?',
    ).get(leaseId, iso(now)) as LeaseRow | undefined;
    return row ? this.hydrate(row) : undefined;
  }

  getByExecution(executionId: string, now = Date.now()): ResourceLease | undefined {
    this.reapUnsafe(now);
    const row = this.db.prepare(
      'SELECT * FROM eamilos_resource_leases WHERE execution_id = ? AND expires_at > ? ORDER BY fencing_token DESC LIMIT 1',
    ).get(executionId, iso(now)) as LeaseRow | undefined;
    return row ? this.hydrate(row) : undefined;
  }

  reapExpired(now = Date.now()): number {
    return this.reapTransaction(now);
  }

  close(): void {
    if (this.db.open) this.db.close();
  }

  private acquireUnsafe(request: ResourceLeaseRequest, now: number): ResourceLease {
    this.reapUnsafe(now);

    const existing = this.db.prepare(
      'SELECT * FROM eamilos_resource_leases WHERE execution_id = ? AND owner_id = ? AND expires_at > ? ORDER BY fencing_token DESC LIMIT 1',
    ).get(request.executionId, request.ownerId, iso(now)) as LeaseRow | undefined;

    const normalized = normalizeResources(request.resources);
    if (existing) {
      const current = this.hydrate(existing);
      if (sameResources(current.resources, normalized)) return current;
      throw new Error('EXECUTION_ALREADY_HOLDS_DIFFERENT_RESOURCES');
    }

    const conflicts = this.findConflicts(normalized, now);
    if (conflicts.length > 0) {
      throw new ResourceConflictError(conflicts);
    }

    const leaseId = randomUUID();
    const fencingToken = this.nextFencingToken();
    const acquiredAt = iso(now);
    const expiresAt = iso(now + request.ttlMs);

    this.db.prepare(`
      INSERT INTO eamilos_resource_leases
        (lease_id, execution_id, owner_id, fencing_token, acquired_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(leaseId, request.executionId, request.ownerId, fencingToken, acquiredAt, expiresAt);

    const insertClaim = this.db.prepare(
      'INSERT INTO eamilos_resource_claims (lease_id, resource, mode) VALUES (?, ?, ?)',
    );
    for (const resource of normalized.readSet) insertClaim.run(leaseId, resource, 'read');
    for (const resource of normalized.writeSet) insertClaim.run(leaseId, resource, 'write');

    return {
      leaseId,
      executionId: request.executionId,
      ownerId: request.ownerId,
      resources: normalized,
      fencingToken,
      acquiredAt,
      expiresAt,
    };
  }

  private renewUnsafe(
    leaseId: string,
    ownerId: string,
    fencingToken: number,
    ttlMs: number,
    now: number,
  ): ResourceLease {
    this.reapUnsafe(now);
    const row = this.db.prepare(
      'SELECT * FROM eamilos_resource_leases WHERE lease_id = ?',
    ).get(leaseId) as LeaseRow | undefined;
    if (!row) throw new Error('LEASE_NOT_FOUND');
    if (row.owner_id !== ownerId || row.fencing_token !== fencingToken) throw new Error('LEASE_FENCING_TOKEN_MISMATCH');
    if (Date.parse(row.expires_at) <= now) throw new Error('LEASE_EXPIRED');

    const expiresAt = iso(now + ttlMs);
    this.db.prepare(
      'UPDATE eamilos_resource_leases SET expires_at = ? WHERE lease_id = ?',
    ).run(expiresAt, leaseId);
    return this.hydrate(this.db.prepare(
      'SELECT * FROM eamilos_resource_leases WHERE lease_id = ?',
    ).get(leaseId) as LeaseRow);
  }

  private releaseUnsafe(
    leaseId: string,
    ownerId: string,
    fencingToken: number,
    _now: number,
  ): boolean {
    const row = this.db.prepare(
      'SELECT owner_id, fencing_token FROM eamilos_resource_leases WHERE lease_id = ?',
    ).get(leaseId) as { owner_id: string; fencing_token: number } | undefined;
    if (!row) return false;
    if (row.owner_id !== ownerId || row.fencing_token !== fencingToken) throw new Error('LEASE_FENCING_TOKEN_MISMATCH');
    this.db.prepare('DELETE FROM eamilos_resource_leases WHERE lease_id = ?').run(leaseId);
    return true;
  }

  private reapUnsafe(now: number): number {
    const result = this.db.prepare(
      'DELETE FROM eamilos_resource_leases WHERE expires_at <= ?',
    ).run(iso(now));
    return result.changes;
  }

  private findConflicts(resources: NormalizedResources, now: number): ResourceConflict[] {
    const rows = this.db.prepare(`
      SELECT c.resource, c.mode, l.lease_id, l.execution_id, l.owner_id, l.fencing_token
      FROM eamilos_resource_claims c
      JOIN eamilos_resource_leases l ON l.lease_id = c.lease_id
      WHERE l.expires_at > ?
    `).all(iso(now)) as ClaimRow[];

    const requested = new Map<string, ResourceLockMode>();
    for (const resource of resources.readSet) requested.set(resource, 'read');
    for (const resource of resources.writeSet) requested.set(resource, 'write');

    return rows
      .filter(row => {
        const requestedMode = requested.get(row.resource);
        return requestedMode !== undefined && (requestedMode === 'write' || row.mode === 'write');
      })
      .map(row => ({
        resource: row.resource,
        mode: row.mode as ResourceLockMode,
        leaseId: row.lease_id,
        executionId: row.execution_id,
        ownerId: row.owner_id,
        fencingToken: row.fencing_token,
      }));
  }

  private nextFencingToken(): number {
    const row = this.db.prepare(
      'UPDATE eamilos_resource_lease_meta SET next_fencing_token = next_fencing_token + 1 WHERE id = 1 RETURNING next_fencing_token',
    ).get() as { next_fencing_token: number };
    return row.next_fencing_token;
  }

  private hydrate(row: LeaseRow): ResourceLease {
    const claims = this.db.prepare(
      'SELECT resource, mode FROM eamilos_resource_claims WHERE lease_id = ? ORDER BY resource',
    ).all(row.lease_id) as Array<{ resource: string; mode: ResourceLockMode }>;

    return {
      leaseId: row.lease_id,
      executionId: row.execution_id,
      ownerId: row.owner_id,
      resources: {
        readSet: claims.filter(claim => claim.mode === 'read').map(claim => claim.resource),
        writeSet: claims.filter(claim => claim.mode === 'write').map(claim => claim.resource),
      },
      fencingToken: row.fencing_token,
      acquiredAt: row.acquired_at,
      expiresAt: row.expires_at,
    };
  }
}

export class ResourceConflictError extends Error {
  readonly code = 'RESOURCE_CONFLICT' as const;
  constructor(readonly conflicts: ResourceConflict[]) {
    super(`RESOURCE_CONFLICT:${conflicts.map(conflict => conflict.resource).join(',')}`);
    this.name = 'ResourceConflictError';
  }
}

export interface ResourceConflict {
  resource: string;
  mode: ResourceLockMode;
  leaseId: string;
  executionId: string;
  ownerId: string;
  fencingToken: number;
}

interface NormalizedResources {
  readSet: string[];
  writeSet: string[];
}

interface LeaseRow {
  lease_id: string;
  execution_id: string;
  owner_id: string;
  fencing_token: number;
  acquired_at: string;
  expires_at: string;
}

interface ClaimRow {
  resource: string;
  mode: string;
  lease_id: string;
  execution_id: string;
  owner_id: string;
  fencing_token: number;
}

function validateRequest(request: ResourceLeaseRequest): void {
  if (!request.executionId.trim() || !request.ownerId.trim()) throw new Error('INVALID_LEASE_IDENTITY');
  validateTtl(request.ttlMs);
  normalizeResources(request.resources);
}

function validateTtl(ttlMs: number): void {
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) throw new Error('INVALID_LEASE_TTL');
}

function normalizeResources(resources: ResourceLeaseRequest['resources']): NormalizedResources {
  const readSet = [...new Set(resources.readSet.map(normalizeResource))].sort();
  const writeSet = [...new Set(resources.writeSet.map(normalizeResource))].sort();
  const overlap = readSet.filter(resource => writeSet.includes(resource));
  if (overlap.length > 0) throw new Error(`RESOURCE_READ_WRITE_OVERLAP:${overlap.join(',')}`);
  return { readSet, writeSet };
}

function normalizeResource(resource: string): string {
  const normalized = resource.trim();
  if (!normalized) throw new Error('INVALID_RESOURCE');
  return normalized;
}

function sameResources(a: NormalizedResources, b: NormalizedResources): boolean {
  return a.readSet.join('\0') === b.readSet.join('\0') && a.writeSet.join('\0') === b.writeSet.join('\0');
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

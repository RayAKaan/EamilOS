import Database from 'better-sqlite3';
import {
  assertApprovalRequest,
  assertApprovalTransition,
  type ApprovalRecord,
  type ApprovalRequest,
  type ApprovalStatus,
  type ApprovalTransition,
} from './ApprovalTypes.js';

export interface ApprovalQuery {
  readonly status?: ApprovalStatus | readonly ApprovalStatus[];
  readonly missionId?: string;
  readonly taskId?: string;
  readonly executionId?: string;
  readonly policyId?: string;
  readonly limit?: number;
}

export interface ApprovalStore {
  create(request: ApprovalRequest): ApprovalRecord;
  get(approvalId: string): ApprovalRecord | undefined;
  list(query?: ApprovalQuery): ApprovalRecord[];
  transition(
    approvalId: string,
    transition: ApprovalTransition,
    expectedRevision?: number,
  ): ApprovalRecord;
  delete(approvalId: string): void;
  close?(): void;
}

export class ApprovalStoreConflictError extends Error {
  readonly code = 'APPROVAL_STORE_CONFLICT' as const;

  constructor(message: string) {
    super(message);
    this.name = 'ApprovalStoreConflictError';
  }
}

function clone(record: ApprovalRecord): ApprovalRecord {
  return {
    ...record,
    evidence: record.evidence.map((item) => ({ ...item })),
  };
}

function applyTransition(
  current: ApprovalRecord,
  transition: ApprovalTransition,
): ApprovalRecord {
  assertApprovalTransition(current, transition);

  if (transition.status === 'consumed') {
    return {
      ...current,
      status: 'consumed',
      consumedAt: transition.consumedAt,
      revision: current.revision + 1,
    };
  }

  return {
    ...current,
    status: transition.status,
    decisionBy: 'decisionBy' in transition ? transition.decisionBy : current.decisionBy,
    decisionAt: transition.decisionAt,
    decisionReason:
      'decisionReason' in transition
        ? transition.decisionReason
        : current.decisionReason,
    revision: current.revision + 1,
  };
}

export class InMemoryApprovalStore implements ApprovalStore {
  private readonly records = new Map<string, ApprovalRecord>();

  create(request: ApprovalRequest): ApprovalRecord {
    assertApprovalRequest(request);
    if (this.records.has(request.approvalId)) {
      throw new ApprovalStoreConflictError('APPROVAL_ALREADY_EXISTS');
    }

    const record: ApprovalRecord = {
      ...request,
      status: 'pending',
      revision: 1,
    };
    this.records.set(record.approvalId, clone(record));
    return clone(record);
  }

  get(approvalId: string): ApprovalRecord | undefined {
    const record = this.records.get(approvalId);
    return record ? clone(record) : undefined;
  }

  list(query: ApprovalQuery = {}): ApprovalRecord[] {
    const statuses = query.status
      ? Array.isArray(query.status)
        ? query.status
        : [query.status]
      : undefined;

    const records = [...this.records.values()]
      .filter((record) =>
        (!statuses || statuses.includes(record.status)) &&
        (!query.missionId || record.missionId === query.missionId) &&
        (!query.taskId || record.taskId === query.taskId) &&
        (!query.executionId || record.executionId === query.executionId) &&
        (!query.policyId || record.policyId === query.policyId),
      )
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) ||
          a.approvalId.localeCompare(b.approvalId),
      );

    return query.limit === undefined
      ? records.map(clone)
      : records.slice(0, Math.max(0, query.limit)).map(clone);
  }

  transition(
    approvalId: string,
    transition: ApprovalTransition,
    expectedRevision?: number,
  ): ApprovalRecord {
    const current = this.records.get(approvalId);
    if (!current) {
      throw new ApprovalStoreConflictError('APPROVAL_NOT_FOUND');
    }
    if (
      expectedRevision !== undefined &&
      current.revision !== expectedRevision
    ) {
      throw new ApprovalStoreConflictError(
        `STALE_APPROVAL_REVISION:${expectedRevision}:${current.revision}`,
      );
    }

    const next = applyTransition(current, transition);
    this.records.set(approvalId, next);
    return clone(next);
  }

  delete(approvalId: string): void {
    this.records.delete(approvalId);
  }
}

interface ApprovalRow {
  approval_id: string;
  mission_id: string;
  task_id: string;
  execution_id: string;
  request_id: string;
  policy_id: string;
  scope: ApprovalRequest['scope'];
  requested_by: string;
  reason: string;
  evidence_json: string;
  created_at: string;
  expires_at: string | null;
  status: ApprovalStatus;
  decision_by: string | null;
  decision_at: string | null;
  decision_reason: string | null;
  revision: number;
  consumed_at: string | null;
}

export interface SqliteApprovalStoreOptions {
  readonly filename: string;
  readonly busyTimeoutMs?: number;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS eamilos_approval_schema_migrations (
    version INTEGER PRIMARY KEY NOT NULL,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS eamilos_approvals (
    approval_id TEXT PRIMARY KEY NOT NULL,
    mission_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    execution_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    policy_id TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('execution', 'task', 'mission')),
    requested_by TEXT NOT NULL,
    reason TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    status TEXT NOT NULL CHECK (
      status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled', 'consumed')
    ),
    decision_by TEXT,
    decision_at TEXT,
    decision_reason TEXT,
    revision INTEGER NOT NULL,
    consumed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_eamilos_approvals_mission
    ON eamilos_approvals(mission_id);

  CREATE INDEX IF NOT EXISTS idx_eamilos_approvals_task
    ON eamilos_approvals(task_id);

  CREATE INDEX IF NOT EXISTS idx_eamilos_approvals_execution
    ON eamilos_approvals(execution_id);

  CREATE INDEX IF NOT EXISTS idx_eamilos_approvals_status
    ON eamilos_approvals(status);

  CREATE INDEX IF NOT EXISTS idx_eamilos_approvals_policy
    ON eamilos_approvals(policy_id);
`;

export class SqliteApprovalStore implements ApprovalStore {
  private readonly db: Database.Database;
  private readonly transitionTransaction: (
    approvalId: string,
    transition: ApprovalTransition,
    expectedRevision?: number,
  ) => ApprovalRecord;

  constructor(options: SqliteApprovalStoreOptions) {
    this.db = new Database(options.filename);
    this.db.pragma(
      `busy_timeout = ${Math.max(0, Math.floor(options.busyTimeoutMs ?? 5000))}`,
    );
    this.db.pragma('foreign_keys = ON');
    if (options.filename !== ':memory:') {
      this.db.pragma('journal_mode = WAL');
    }
    this.migrate();

    this.transitionTransaction = this.db.transaction(
      (
        approvalId: string,
        transition: ApprovalTransition,
        expectedRevision?: number,
      ) => this.transitionUnsafe(approvalId, transition, expectedRevision),
    );
  }

  create(request: ApprovalRequest): ApprovalRecord {
    assertApprovalRequest(request);
    const record: ApprovalRecord = {
      ...request,
      status: 'pending',
      revision: 1,
    };

    try {
      this.db
        .prepare(
          `INSERT INTO eamilos_approvals (
            approval_id, mission_id, task_id, execution_id, request_id,
            policy_id, scope, requested_by, reason, evidence_json,
            created_at, expires_at, status, decision_by, decision_at,
            decision_reason, revision, consumed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.approvalId,
          record.missionId,
          record.taskId,
          record.executionId,
          record.requestId,
          record.policyId,
          record.scope,
          record.requestedBy,
          record.reason,
          JSON.stringify(record.evidence),
          record.createdAt,
          record.expiresAt ?? null,
          record.status,
          null,
          null,
          null,
          record.revision,
          null,
        );
    } catch (error) {
      if (String(error).includes('UNIQUE')) {
        throw new ApprovalStoreConflictError('APPROVAL_ALREADY_EXISTS');
      }
      throw error;
    }

    return clone(record);
  }

  get(approvalId: string): ApprovalRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM eamilos_approvals WHERE approval_id = ?')
      .get(approvalId) as ApprovalRow | undefined;
    return row ? clone(hydrate(row)) : undefined;
  }

  list(query: ApprovalQuery = {}): ApprovalRecord[] {
    const clauses: string[] = [];
    const values: unknown[] = [];

    if (query.status) {
      const statuses = Array.isArray(query.status)
        ? query.status
        : [query.status];
      clauses.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      values.push(...statuses);
    }
    if (query.missionId) {
      clauses.push('mission_id = ?');
      values.push(query.missionId);
    }
    if (query.taskId) {
      clauses.push('task_id = ?');
      values.push(query.taskId);
    }
    if (query.executionId) {
      clauses.push('execution_id = ?');
      values.push(query.executionId);
    }
    if (query.policyId) {
      clauses.push('policy_id = ?');
      values.push(query.policyId);
    }

    const limit = Math.max(
      1,
      Math.min(10000, Math.floor(query.limit ?? 10000)),
    );
    values.push(limit);

    const rows = this.db
      .prepare(
        `SELECT * FROM eamilos_approvals
         ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
         ORDER BY created_at ASC, approval_id ASC
         LIMIT ?`,
      )
      .all(...values) as ApprovalRow[];

    return rows.map((row) => clone(hydrate(row)));
  }

  transition(
    approvalId: string,
    transition: ApprovalTransition,
    expectedRevision?: number,
  ): ApprovalRecord {
    return clone(
      this.transitionTransaction(approvalId, transition, expectedRevision),
    );
  }

  delete(approvalId: string): void {
    this.db
      .prepare('DELETE FROM eamilos_approvals WHERE approval_id = ?')
      .run(approvalId);
  }

  close(): void {
    if (this.db.open) {
      this.db.close();
    }
  }

  private transitionUnsafe(
    approvalId: string,
    transition: ApprovalTransition,
    expectedRevision?: number,
  ): ApprovalRecord {
    const row = this.db
      .prepare('SELECT * FROM eamilos_approvals WHERE approval_id = ?')
      .get(approvalId) as ApprovalRow | undefined;

    if (!row) {
      throw new ApprovalStoreConflictError('APPROVAL_NOT_FOUND');
    }

    const current = hydrate(row);
    if (
      expectedRevision !== undefined &&
      current.revision !== expectedRevision
    ) {
      throw new ApprovalStoreConflictError(
        `STALE_APPROVAL_REVISION:${expectedRevision}:${current.revision}`,
      );
    }

    const next = applyTransition(current, transition);
    const result = this.db
      .prepare(
        `UPDATE eamilos_approvals
         SET status = ?, decision_by = ?, decision_at = ?,
             decision_reason = ?, revision = ?, consumed_at = ?
         WHERE approval_id = ? AND revision = ?`,
      )
      .run(
        next.status,
        next.decisionBy ?? null,
        next.decisionAt ?? null,
        next.decisionReason ?? null,
        next.revision,
        next.consumedAt ?? null,
        approvalId,
        current.revision,
      );

    if (result.changes !== 1) {
      throw new ApprovalStoreConflictError(
        `STALE_APPROVAL_REVISION:${current.revision}`,
      );
    }

    return next;
  }

  private migrate(): void {
    this.db.exec(SCHEMA);
    const row = this.db
      .prepare(
        'SELECT MAX(version) AS version FROM eamilos_approval_schema_migrations',
      )
      .get() as { version?: number | null };

    if ((row.version ?? 0) < 1) {
      this.db
        .prepare(
          'INSERT INTO eamilos_approval_schema_migrations(version, applied_at) VALUES (?, ?)',
        )
        .run(1, new Date().toISOString());
    }
  }
}

function hydrate(row: ApprovalRow): ApprovalRecord {
  return {
    approvalId: row.approval_id,
    missionId: row.mission_id,
    taskId: row.task_id,
    executionId: row.execution_id,
    requestId: row.request_id,
    policyId: row.policy_id,
    scope: row.scope,
    requestedBy: row.requested_by,
    reason: row.reason,
    evidence: JSON.parse(row.evidence_json) as ApprovalRecord['evidence'],
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? undefined,
    status: row.status,
    decisionBy: row.decision_by ?? undefined,
    decisionAt: row.decision_at ?? undefined,
    decisionReason: row.decision_reason ?? undefined,
    revision: row.revision,
    consumedAt: row.consumed_at ?? undefined,
  };
}

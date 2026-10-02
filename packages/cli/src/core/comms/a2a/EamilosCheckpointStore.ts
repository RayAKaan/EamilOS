import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';

export interface ExecutionCheckpoint {
  checkpointId: string;
  missionId: string;
  taskId: string;
  executionId: string;
  workerId: string;
  graphVersion: number;
  contextVersion: number;
  contextHash: string;
  sequence: number;
  parentCheckpointId?: string;
  leaseId?: string;
  fencingToken?: number;
  state: Record<string, unknown>;
  stateHash: string;
  createdAt: string;
}

export interface SaveCheckpointInput extends Omit<ExecutionCheckpoint, 'checkpointId' | 'sequence' | 'stateHash' | 'createdAt' | 'parentCheckpointId'> {
  checkpointId?: string;
  expectedParentCheckpointId?: string;
}

export interface CheckpointStore {
  save(input: SaveCheckpointInput): ExecutionCheckpoint;
  get(checkpointId: string): ExecutionCheckpoint | undefined;
  latest(executionId: string): ExecutionCheckpoint | undefined;
  list(executionId: string): ExecutionCheckpoint[];
  close?(): void;
}

export class StaleCheckpointError extends Error {
  readonly code = 'STALE_CHECKPOINT';
  constructor(message: string) { super(message); this.name = 'StaleCheckpointError'; }
}

export class CheckpointIntegrityError extends Error {
  readonly code = 'CHECKPOINT_INTEGRITY_ERROR';
  constructor(message: string) { super(message); this.name = 'CheckpointIntegrityError'; }
}

interface CheckpointRow {
  checkpoint_id: string;
  mission_id: string;
  task_id: string;
  execution_id: string;
  worker_id: string;
  graph_version: number;
  context_version: number;
  context_hash: string;
  sequence: number;
  parent_checkpoint_id: string | null;
  lease_id: string | null;
  fencing_token: number | null;
  state_json: string;
  state_hash: string;
  created_at: string;
}

export class EamilosSqliteCheckpointStore implements CheckpointStore {
  private readonly db: Database.Database;

  constructor(options: { filename: string; busyTimeoutMs?: number }) {
    this.db = new Database(options.filename);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma(`busy_timeout = ${options.busyTimeoutMs ?? 5_000}`);
    if (options.filename !== ':memory:') this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS eamilos_checkpoint_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT OR IGNORE INTO eamilos_checkpoint_meta(key, value) VALUES ('schema_version', '1');
      CREATE TABLE IF NOT EXISTS eamilos_checkpoints (
        checkpoint_id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        graph_version INTEGER NOT NULL,
        context_version INTEGER NOT NULL,
        context_hash TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        parent_checkpoint_id TEXT,
        lease_id TEXT,
        fencing_token INTEGER,
        state_json TEXT NOT NULL,
        state_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(execution_id, sequence),
        FOREIGN KEY(parent_checkpoint_id) REFERENCES eamilos_checkpoints(checkpoint_id)
      );
      CREATE INDEX IF NOT EXISTS idx_eamilos_checkpoints_execution_sequence
        ON eamilos_checkpoints(execution_id, sequence DESC);
    `);
  }

  save(input: SaveCheckpointInput): ExecutionCheckpoint {
    validateInput(input);
    const transaction = this.db.transaction(() => {
      const latest = this.latest(input.executionId);
      const actualParent = latest?.checkpointId;
      if (input.expectedParentCheckpointId !== undefined && input.expectedParentCheckpointId !== actualParent) {
        throw new StaleCheckpointError(`Expected parent ${input.expectedParentCheckpointId}, latest is ${actualParent ?? 'none'}`);
      }
      if (latest) {
        if (latest.missionId !== input.missionId || latest.taskId !== input.taskId) throw new StaleCheckpointError('Checkpoint correlation changed');
        if (input.graphVersion < latest.graphVersion) throw new StaleCheckpointError('Graph version regressed');
        if (input.contextVersion < latest.contextVersion) throw new StaleCheckpointError('Context version regressed');
        if (input.contextVersion === latest.contextVersion && input.contextHash !== latest.contextHash) throw new StaleCheckpointError('Context hash changed without a context version change');
        if (latest.fencingToken !== undefined) {
          if (input.fencingToken === undefined || input.fencingToken < latest.fencingToken) throw new StaleCheckpointError('Fencing token regressed or missing');
        }
        if (latest.workerId !== input.workerId && input.fencingToken === latest.fencingToken) throw new StaleCheckpointError('Worker changed without a new fencing token');
      }
      const stateJson = canonicalize(input.state);
      const checkpoint: ExecutionCheckpoint = {
        checkpointId: input.checkpointId ?? randomUUID(),
        missionId: input.missionId,
        taskId: input.taskId,
        executionId: input.executionId,
        workerId: input.workerId,
        graphVersion: input.graphVersion,
        contextVersion: input.contextVersion,
        contextHash: input.contextHash,
        sequence: (latest?.sequence ?? 0) + 1,
        ...(actualParent ? { parentCheckpointId: actualParent } : {}),
        ...(input.leaseId ? { leaseId: input.leaseId } : {}),
        ...(input.fencingToken !== undefined ? { fencingToken: input.fencingToken } : {}),
        state: input.state,
        stateHash: createHash('sha256').update(stateJson).digest('hex'),
        createdAt: new Date().toISOString(),
      };
      this.db.prepare(`INSERT INTO eamilos_checkpoints (
        checkpoint_id, mission_id, task_id, execution_id, worker_id, graph_version, context_version,
        context_hash, sequence, parent_checkpoint_id, lease_id, fencing_token, state_json, state_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        checkpoint.checkpointId, checkpoint.missionId, checkpoint.taskId, checkpoint.executionId, checkpoint.workerId,
        checkpoint.graphVersion, checkpoint.contextVersion, checkpoint.contextHash, checkpoint.sequence,
        checkpoint.parentCheckpointId ?? null, checkpoint.leaseId ?? null, checkpoint.fencingToken ?? null,
        stateJson, checkpoint.stateHash, checkpoint.createdAt,
      );
      return checkpoint;
    });
    return transaction();
  }

  get(checkpointId: string): ExecutionCheckpoint | undefined {
    const row = this.db.prepare('SELECT * FROM eamilos_checkpoints WHERE checkpoint_id = ?').get(checkpointId) as CheckpointRow | undefined;
    return row ? this.fromRow(row) : undefined;
  }

  latest(executionId: string): ExecutionCheckpoint | undefined {
    const row = this.db.prepare('SELECT * FROM eamilos_checkpoints WHERE execution_id = ? ORDER BY sequence DESC LIMIT 1').get(executionId) as CheckpointRow | undefined;
    return row ? this.fromRow(row) : undefined;
  }

  list(executionId: string): ExecutionCheckpoint[] {
    return (this.db.prepare('SELECT * FROM eamilos_checkpoints WHERE execution_id = ? ORDER BY sequence ASC').all(executionId) as CheckpointRow[]).map(row => this.fromRow(row));
  }

  close(): void { this.db.close(); }

  private fromRow(row: CheckpointRow): ExecutionCheckpoint {
    const state = JSON.parse(row.state_json) as Record<string, unknown>;
    const hash = createHash('sha256').update(canonicalize(state)).digest('hex');
    if (hash !== row.state_hash) throw new CheckpointIntegrityError(`Checkpoint ${row.checkpoint_id} state hash mismatch`);
    return {
      checkpointId: row.checkpoint_id,
      missionId: row.mission_id,
      taskId: row.task_id,
      executionId: row.execution_id,
      workerId: row.worker_id,
      graphVersion: row.graph_version,
      contextVersion: row.context_version,
      contextHash: row.context_hash,
      sequence: row.sequence,
      ...(row.parent_checkpoint_id ? { parentCheckpointId: row.parent_checkpoint_id } : {}),
      ...(row.lease_id ? { leaseId: row.lease_id } : {}),
      ...(row.fencing_token !== null ? { fencingToken: row.fencing_token } : {}),
      state,
      stateHash: row.state_hash,
      createdAt: row.created_at,
    };
  }
}

export function assertCheckpointFresh(checkpoint: ExecutionCheckpoint, expected: { missionId: string; taskId: string; executionId: string; graphVersion: number; contextHash: string; minimumFencingToken?: number }): void {
  if (checkpoint.missionId !== expected.missionId || checkpoint.taskId !== expected.taskId || checkpoint.executionId !== expected.executionId) throw new StaleCheckpointError('Checkpoint correlation mismatch');
  if (checkpoint.graphVersion !== expected.graphVersion) throw new StaleCheckpointError('Checkpoint graph version is stale');
  if (checkpoint.contextHash !== expected.contextHash) throw new StaleCheckpointError('Checkpoint context hash is stale');
  if (expected.minimumFencingToken !== undefined && (checkpoint.fencingToken ?? 0) < expected.minimumFencingToken) throw new StaleCheckpointError('Checkpoint fencing token is stale');
}

export function checkpointResumeId(value: Record<string, unknown> | undefined): string | undefined {
  const id = value?.checkpointId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

function validateInput(input: SaveCheckpointInput): void {
  if (!input.missionId || !input.taskId || !input.executionId || !input.workerId) throw new Error('Invalid checkpoint correlation');
  if (!Number.isInteger(input.graphVersion) || input.graphVersion < 0 || !Number.isInteger(input.contextVersion) || input.contextVersion < 0) throw new Error('Invalid checkpoint version');
  if (!/^[a-f0-9]{64}$/.test(input.contextHash)) throw new Error('Invalid checkpoint context hash');
  if (input.fencingToken !== undefined && (!Number.isInteger(input.fencingToken) || input.fencingToken <= 0)) throw new Error('Invalid checkpoint fencing token');
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const object = value as Record<string, unknown>;
  return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + canonicalize(object[key])).join(',') + '}';
}

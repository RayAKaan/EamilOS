import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { isTerminalMessage, taskRequestFingerprint, type TaskRequest, type EamilosA2AMessage } from './EamilosA2AProtocol.js';
import type { EamilosA2ATaskStoreLike, StoredTask } from './EamilosA2ATaskStore.js';

const SCHEMA_VERSION = 1;
const MIGRATIONS: Record<number, string> = {
  1: `
    CREATE TABLE IF NOT EXISTS a2a_tasks (
      execution_id TEXT PRIMARY KEY NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      fingerprint TEXT NOT NULL,
      request_json TEXT NOT NULL,
      latest_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS a2a_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      message_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (execution_id) REFERENCES a2a_tasks(execution_id) ON DELETE CASCADE,
      UNIQUE (execution_id, fingerprint)
    );
    CREATE INDEX IF NOT EXISTS idx_a2a_messages_execution
      ON a2a_messages(execution_id, id);
  `,
};

export interface EamilosA2ASqliteTaskStoreOptions {
  filename: string;
  busyTimeoutMs?: number;
}

export class EamilosA2ASqliteTaskStore implements EamilosA2ATaskStoreLike {
  private readonly db: Database.Database;
  private readonly putTransaction: (request: TaskRequest) => StoredTask;
  private readonly appendTransaction: (message: EamilosA2AMessage) => StoredTask;

  constructor(options: EamilosA2ASqliteTaskStoreOptions) {
    this.db = new Database(options.filename);
    this.db.pragma(`busy_timeout = ${Math.max(0, Math.floor(options.busyTimeoutMs ?? 5000))}`);
    this.db.pragma('foreign_keys = ON');
    if (options.filename !== ':memory:') this.db.pragma('journal_mode = WAL');
    this.migrate();

    this.putTransaction = this.db.transaction((request: TaskRequest) => this.putUnsafe(request));
    this.appendTransaction = this.db.transaction((message: EamilosA2AMessage) => this.appendUnsafe(message));
  }

  put(request: TaskRequest): StoredTask {
    return this.putTransaction(request);
  }

  get(executionId: string): StoredTask | undefined {
    const row = this.db.prepare('SELECT * FROM a2a_tasks WHERE execution_id = ?').get(executionId) as TaskRow | undefined;
    return row ? this.hydrate(row) : undefined;
  }

  getByIdempotencyKey(key: string): StoredTask | undefined {
    const row = this.db.prepare('SELECT * FROM a2a_tasks WHERE idempotency_key = ?').get(key) as TaskRow | undefined;
    return row ? this.hydrate(row) : undefined;
  }

  append(message: EamilosA2AMessage): StoredTask {
    return this.appendTransaction(message);
  }

  list(): StoredTask[] {
    const rows = this.db.prepare('SELECT * FROM a2a_tasks ORDER BY created_at, execution_id').all() as TaskRow[];
    return rows.map(row => this.hydrate(row));
  }

  close(): void {
    if (this.db.open) this.db.close();
  }

  private putUnsafe(request: TaskRequest): StoredTask {
    const fingerprint = taskRequestFingerprint(request);
    const existingByKey = this.db.prepare(
      'SELECT execution_id FROM a2a_tasks WHERE idempotency_key = ?',
    ).get(request.idempotencyKey) as { execution_id: string } | undefined;

    if (existingByKey && existingByKey.execution_id !== request.executionId) {
      throw new Error('IDEMPOTENCY_KEY_CONFLICT');
    }

    const existing = this.db.prepare('SELECT * FROM a2a_tasks WHERE execution_id = ?').get(request.executionId) as TaskRow | undefined;
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error('EXECUTION_ID_REUSE_CONFLICT');
      return this.hydrate(existing);
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO a2a_tasks (execution_id, idempotency_key, fingerprint, request_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(request.executionId, request.idempotencyKey, fingerprint, JSON.stringify(request), now, now);

    return this.get(request.executionId)!;
  }

  private appendUnsafe(message: EamilosA2AMessage): StoredTask {
    if (!('executionId' in message)) throw new Error('Message is not execution-correlated');
    const executionId = message.executionId;
    const row = this.db.prepare('SELECT * FROM a2a_tasks WHERE execution_id = ?').get(executionId) as TaskRow | undefined;
    if (!row) throw new Error(`Unknown execution: ${executionId}`);

    const latest = row.latest_json ? parseMessage(row.latest_json) : undefined;
    if (latest && !isValidTransition(latest.kind, message.kind)) {
      throw new Error(`INVALID_A2A_TRANSITION:${latest.kind}->${message.kind}`);
    }

    const fingerprint = messageFingerprint(message);
    const duplicate = this.db.prepare(
      'SELECT id FROM a2a_messages WHERE execution_id = ? AND fingerprint = ?',
    ).get(executionId, fingerprint) as { id: number } | undefined;
    if (duplicate) return this.hydrate(row);

    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO a2a_messages (execution_id, fingerprint, message_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(executionId, fingerprint, JSON.stringify(message), now);
    this.db.prepare(
      'UPDATE a2a_tasks SET latest_json = ?, updated_at = ? WHERE execution_id = ?',
    ).run(JSON.stringify(message), now, executionId);

    return this.get(executionId)!;
  }

  private hydrate(row: TaskRow): StoredTask {
    const messages = this.db.prepare(
      'SELECT message_json FROM a2a_messages WHERE execution_id = ? ORDER BY id',
    ).all(row.execution_id) as Array<{ message_json: string }>;

    const history = messages.map(item => parseMessage(item.message_json));
    const latest = row.latest_json ? parseMessage(row.latest_json) : undefined;

    return {
      request: JSON.parse(row.request_json) as TaskRequest,
      fingerprint: row.fingerprint,
      latest,
      history,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS a2a_schema_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    const current = this.db.prepare(
      'SELECT MAX(version) AS version FROM a2a_schema_migrations',
    ).get() as { version?: number | null };

    let version = current.version ?? 0;
    while (version < SCHEMA_VERSION) {
      const next = version + 1;
      const migration = MIGRATIONS[next];
      if (!migration) throw new Error(`Missing A2A migration: ${next}`);

      const apply = this.db.transaction(() => {
        this.db.exec(migration);
        this.db.prepare(
          'INSERT INTO a2a_schema_migrations (version, applied_at) VALUES (?, ?)',
        ).run(next, new Date().toISOString());
      });

      apply();
      version = next;
    }
  }
}

export function createDurableA2ATaskStore(
  options: EamilosA2ASqliteTaskStoreOptions,
): EamilosA2ASqliteTaskStore {
  return new EamilosA2ASqliteTaskStore(options);
}

type TaskRow = {
  execution_id: string;
  idempotency_key: string;
  fingerprint: string;
  request_json: string;
  latest_json: string | null;
  created_at: string;
  updated_at: string;
};

function parseMessage(value: string): EamilosA2AMessage {
  const parsed = JSON.parse(value) as EamilosA2AMessage;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.kind !== 'string') {
    throw new Error('Corrupt persisted A2A message');
  }
  return parsed;
}

function messageFingerprint(message: EamilosA2AMessage): string {
  return createHash('sha256').update(canonicalize(message)).digest('hex');
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';

  const object = value as Record<string, unknown>;
  return '{' + Object.keys(object).sort().map(
    key => JSON.stringify(key) + ':' + canonicalize(object[key]),
  ).join(',') + '}';
}

function isValidTransition(
  from: EamilosA2AMessage['kind'],
  to: EamilosA2AMessage['kind'],
): boolean {
  if (isTerminalMessage({ kind: from } as EamilosA2AMessage)) return false;
  if (from === 'task.request') return to === 'task.accepted' || to === 'task.rejected' || to === 'task.cancelled';
  if (from === 'task.accepted') return to === 'task.progress' || to === 'task.completed' || to === 'task.failed' || to === 'task.cancelled';
  if (from === 'task.progress') return to === 'task.progress' || to === 'task.completed' || to === 'task.failed' || to === 'task.cancelled';
  return false;
}

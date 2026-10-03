import Database from 'better-sqlite3';
import type { PtySession, PtySessionState } from './PtyTypes.js';

export interface PtySessionStore {
  save(session: PtySession): void;
  get(sessionId: string): PtySession | undefined;
  list(): PtySession[];
  close(): void;
}

export interface SqlitePtySessionStoreOptions {
  filename: string;
  busyTimeoutMs?: number;
}

const SCHEMA_VERSION = 1;

export class InMemoryPtySessionStore implements PtySessionStore {
  private readonly sessions = new Map<string, PtySession>();

  save(session: PtySession): void {
    this.sessions.set(session.sessionId, session);
  }

  get(sessionId: string): PtySession | undefined {
    return this.sessions.get(sessionId);
  }

  list(): PtySession[] {
    return [...this.sessions.values()];
  }

  close(): void {}
}

export class SqlitePtySessionStore implements PtySessionStore {
  private readonly db: Database.Database;

  constructor(options: SqlitePtySessionStoreOptions) {
    this.db = new Database(options.filename);
    this.db.pragma(
      `busy_timeout = ${Math.max(0, Math.floor(options.busyTimeoutMs ?? 5000))}`,
    );
    if (options.filename !== ':memory:') this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  save(session: PtySession): void {
    const json = JSON.stringify(session);
    const existing = this.db.prepare(
      'SELECT session_json FROM pty_sessions WHERE session_id = ?',
    ).get(session.sessionId) as { session_json: string } | undefined;

    if (!existing) {
      this.db.prepare(`
        INSERT INTO pty_sessions (
          session_id, execution_id, mission_id, task_id, worker_id,
          agent_id, harness_id, state, created_at, updated_at, session_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        session.sessionId,
        session.executionId,
        session.missionId,
        session.taskId,
        session.workerId,
        session.agentId,
        session.harnessId,
        session.state,
        session.createdAt,
        new Date().toISOString(),
        json,
      );
      return;
    }

    this.db.prepare(`
      UPDATE pty_sessions
      SET state = ?, updated_at = ?, session_json = ?
      WHERE session_id = ?
    `).run(
      session.state,
      new Date().toISOString(),
      json,
      session.sessionId,
    );
  }

  get(sessionId: string): PtySession | undefined {
    const row = this.db.prepare(
      'SELECT session_json FROM pty_sessions WHERE session_id = ?',
    ).get(sessionId) as { session_json: string } | undefined;
    return row ? parseSession(row.session_json) : undefined;
  }

  list(): PtySession[] {
    const rows = this.db.prepare(
      'SELECT session_json FROM pty_sessions ORDER BY created_at, session_id',
    ).all() as Array<{ session_json: string }>;
    return rows.map(row => parseSession(row.session_json));
  }

  close(): void {
    if (this.db.open) this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pty_schema_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    const current = this.db.prepare(
      'SELECT MAX(version) AS version FROM pty_schema_migrations',
    ).get() as { version?: number | null };

    let version = current.version ?? 0;
    while (version < SCHEMA_VERSION) {
      const next = version + 1;
      if (next !== 1) throw new Error(`Missing PTY migration: ${next}`);

      const apply = this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS pty_sessions (
            session_id TEXT PRIMARY KEY NOT NULL,
            execution_id TEXT NOT NULL,
            mission_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            worker_id TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            harness_id TEXT NOT NULL,
            state TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            session_json TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_pty_sessions_execution
            ON pty_sessions(execution_id);
          CREATE INDEX IF NOT EXISTS idx_pty_sessions_state
            ON pty_sessions(state);
        `);
        this.db.prepare(
          'INSERT INTO pty_schema_migrations (version, applied_at) VALUES (?, ?)',
        ).run(next, new Date().toISOString());
      });

      apply();
      version = next;
    }
  }
}

function parseSession(value: string): PtySession {
  const parsed = JSON.parse(value) as PtySession;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.sessionId !== 'string') {
    throw new Error('Corrupt persisted PTY session');
  }
  return Object.freeze({
    ...parsed,
    args: Object.freeze([...parsed.args]),
    dimensions: Object.freeze({ ...parsed.dimensions }),
  });
}

export function isActivePtyState(state: PtySessionState): boolean {
  return state === 'created'
    || state === 'starting'
    || state === 'running'
    || state === 'idle'
    || state === 'attached';
}

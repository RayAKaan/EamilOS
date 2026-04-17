import Database from 'better-sqlite3';
import { Session, FileResult, WALEntry, WALStatus, SessionStatus } from './stateful-types.js';
import { ExecutionTrace } from './stateful-types.js';
import { DecisionResponse } from './decision-types.js';

export interface PersistenceConfig {
  dbPath: string;
  autoSaveIntervalMs: number;
}

const DEFAULT_CONFIG: PersistenceConfig = {
  dbPath: './eamilos-state.db',
  autoSaveIntervalMs: 2000,
};

export class StatePersistence {
  private db: Database.Database;
  private config: PersistenceConfig;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSession: Session | null = null;

  constructor(config: Partial<PersistenceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.db = new Database(this.config.dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        execution_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS executions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        trace_json TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS files (
        session_id TEXT NOT NULL,
        path TEXT NOT NULL,
        status TEXT NOT NULL,
        error_json TEXT,
        hash TEXT,
        bytes_written INTEGER,
        validated_at INTEGER,
        written_at INTEGER,
        PRIMARY KEY (session_id, path),
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS write_ahead_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        path TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        committed_at INTEGER,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        selected TEXT NOT NULL,
        source TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_wal_status ON write_ahead_log(status);
      CREATE INDEX IF NOT EXISTS idx_decisions_session ON decisions(session_id);
    `);
  }

  saveSession(session: Session): void {
    this.pendingSession = session;

    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(() => {
      this.flushPending();
    }, this.config.autoSaveIntervalMs);
  }

  private flushPending(): void {
    if (this.pendingSession) {
      this.saveSessionSync(this.pendingSession);
      this.pendingSession = null;
    }
    this.saveTimer = null;
  }

  saveSessionSync(session: Session): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sessions (id, goal, status, execution_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.id,
      session.goal,
      session.status,
      JSON.stringify(session.execution),
      session.createdAt,
      session.updatedAt
    );

    const deleteFiles = this.db.prepare('DELETE FROM files WHERE session_id = ?');
    deleteFiles.run(session.id);

    const insertFile = this.db.prepare(`
      INSERT INTO files (session_id, path, status, error_json, hash, bytes_written, validated_at, written_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const file of session.execution.files) {
      insertFile.run(
        session.id,
        file.path,
        file.status,
        file.error ? JSON.stringify(file.error) : null,
        file.hash || null,
        file.bytesWritten || null,
        file.validatedAt || null,
        file.writtenAt || null
      );
    }

    const deleteDecisions = this.db.prepare('DELETE FROM decisions WHERE session_id = ?');
    deleteDecisions.run(session.id);

    const insertDecision = this.db.prepare(`
      INSERT INTO decisions (id, request_id, selected, source, timestamp, session_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const decision of session.decisions) {
      insertDecision.run(
        decision.id,
        decision.requestId,
        decision.selected,
        decision.source,
        decision.timestamp,
        session.id
      );
    }
  }

  loadSession(id: string): Session | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const row = stmt.get(id) as { id: string; goal: string; status: string; execution_json: string; created_at: number; updated_at: number } | undefined;

    if (!row) return null;

    const filesStmt = this.db.prepare('SELECT * FROM files WHERE session_id = ?');
    const fileRows = filesStmt.all(id) as Array<{
      path: string;
      status: string;
      error_json: string | null;
      hash: string | null;
      bytes_written: number | null;
      validated_at: number | null;
      written_at: number | null;
    }>;

    const files: FileResult[] = fileRows.map(f => ({
      path: f.path,
      status: f.status as FileResult['status'],
      error: f.error_json ? JSON.parse(f.error_json) : undefined,
      hash: f.hash || undefined,
      bytesWritten: f.bytes_written || undefined,
      validatedAt: f.validated_at || undefined,
      writtenAt: f.written_at || undefined,
    }));

    const decisionsStmt = this.db.prepare('SELECT * FROM decisions WHERE session_id = ?');
    const decisionRows = decisionsStmt.all(id) as Array<{
      id: string;
      request_id: string;
      selected: string;
      source: string;
      timestamp: number;
    }>;

    const decisions: DecisionResponse[] = decisionRows.map(d => ({
      id: d.id,
      requestId: d.request_id,
      selected: d.selected,
      source: d.source as DecisionResponse['source'],
      timestamp: d.timestamp,
    }));

    return {
      id: row.id,
      goal: row.goal,
      status: row.status as SessionStatus,
      execution: {
        ...JSON.parse(row.execution_json),
        files,
      } as Session['execution'],
      decisions,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getActiveSessions(): Session[] {
    const stmt = this.db.prepare("SELECT id FROM sessions WHERE status IN ('running', 'crashed', 'recovering')");
    const rows = stmt.all() as Array<{ id: string }>;
    return rows.map(r => this.loadSession(r.id)).filter((s): s is Session => s !== null);
  }

  deleteSession(id: string): void {
    const deleteWAL = this.db.prepare('DELETE FROM write_ahead_log WHERE session_id = ?');
    const deleteFiles = this.db.prepare('DELETE FROM files WHERE session_id = ?');
    const deleteDecisions = this.db.prepare('DELETE FROM decisions WHERE session_id = ?');
    const deleteExecutions = this.db.prepare('DELETE FROM executions WHERE session_id = ?');
    const deleteSession = this.db.prepare('DELETE FROM sessions WHERE id = ?');

    deleteWAL.run(id);
    deleteFiles.run(id);
    deleteDecisions.run(id);
    deleteExecutions.run(id);
    deleteSession.run(id);
  }

  addWALEntry(sessionId: string, path: string): WALEntry {
    const stmt = this.db.prepare(`
      INSERT INTO write_ahead_log (session_id, path, status, created_at)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(sessionId, path, 'pending', Date.now());

    return {
      id: result.lastInsertRowid as number,
      sessionId,
      path,
      status: 'pending',
      createdAt: Date.now(),
    };
  }

  commitWALEntry(id: number): void {
    const stmt = this.db.prepare('UPDATE write_ahead_log SET status = ?, committed_at = ? WHERE id = ?');
    stmt.run('committed', Date.now(), id);
  }

  rollbackWALEntry(id: number): void {
    const stmt = this.db.prepare('UPDATE write_ahead_log SET status = ? WHERE id = ?');
    stmt.run('rolled_back', id);
  }

  getPendingWALEntries(sessionId: string): WALEntry[] {
    const stmt = this.db.prepare("SELECT * FROM write_ahead_log WHERE session_id = ? AND status = 'pending'");
    const rows = stmt.all(sessionId) as Array<{
      id: number;
      session_id: string;
      path: string;
      status: string;
      created_at: number;
      committed_at: number | null;
    }>;

    return rows.map(r => ({
      id: r.id,
      sessionId: r.session_id,
      path: r.path,
      status: r.status as WALStatus,
      createdAt: r.created_at,
      committedAt: r.committed_at || undefined,
    }));
  }

  getUncommittedWALEntries(): WALEntry[] {
    const stmt = this.db.prepare("SELECT * FROM write_ahead_log WHERE status = 'pending'");
    const rows = stmt.all() as Array<{
      id: number;
      session_id: string;
      path: string;
      status: string;
      created_at: number;
      committed_at: number | null;
    }>;

    return rows.map(r => ({
      id: r.id,
      sessionId: r.session_id,
      path: r.path,
      status: r.status as WALStatus,
      createdAt: r.created_at,
      committedAt: r.committed_at || undefined,
    }));
  }

  saveExecutionTrace(sessionId: string, trace: ExecutionTrace, attempts: number): void {
    const stmt = this.db.prepare(`
      INSERT INTO executions (session_id, trace_json, attempts, created_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(sessionId, JSON.stringify(trace), attempts, Date.now());
  }

  getExecutionTraces(sessionId: string): ExecutionTrace[] {
    const stmt = this.db.prepare('SELECT trace_json FROM executions WHERE session_id = ? ORDER BY created_at ASC');
    const rows = stmt.all(sessionId) as Array<{ trace_json: string }>;
    return rows.map(r => JSON.parse(r.trace_json));
  }

  close(): void {
    this.flushPending();
    this.db.close();
  }
}

let globalPersistence: StatePersistence | null = null;

export function initStatePersistence(config?: Partial<PersistenceConfig>): StatePersistence {
  if (globalPersistence) {
    return globalPersistence;
  }
  globalPersistence = new StatePersistence(config);
  return globalPersistence;
}

export function getStatePersistence(): StatePersistence {
  if (!globalPersistence) {
    return initStatePersistence();
  }
  return globalPersistence;
}

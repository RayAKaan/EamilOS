import Database from 'better-sqlite3';
import { Session, SessionStatus } from '../src/types.js';
import { dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';

export class SessionRepository {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath: string = './data/eamilos-sessions.db') {
    this.dbPath = dbPath;
    this.ensureDirectory();
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private ensureDirectory(): void {
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_updated INTEGER NOT NULL,
        data_json TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(last_updated DESC);
    `);
  }

  saveSession(session: Session): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sessions (id, goal, status, created_at, last_updated, data_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.id,
      session.goal,
      session.status,
      session.createdAt,
      Date.now(),
      JSON.stringify(session)
    );
  }

  getSession(id: string): Session | null {
    const stmt = this.db.prepare('SELECT data_json FROM sessions WHERE id = ?');
    const row = stmt.get(id) as { data_json: string } | undefined;

    if (!row) return null;

    try {
      return JSON.parse(row.data_json) as Session;
    } catch {
      return null;
    }
  }

  getRecentSessions(limit: number = 10): Session[] {
    const stmt = this.db.prepare(
      'SELECT data_json FROM sessions ORDER BY last_updated DESC LIMIT ?'
    );
    const rows = stmt.all(limit) as { data_json: string }[];

    return rows
      .map(row => {
        try {
          return JSON.parse(row.data_json) as Session;
        } catch {
          return null;
        }
      })
      .filter((s): s is Session => s !== null);
  }

  getActiveSessions(): Session[] {
    const stmt = this.db.prepare(
      "SELECT data_json FROM sessions WHERE status = ? ORDER BY last_updated DESC"
    );
    const rows = stmt.all('active') as { data_json: string }[];

    return rows
      .map(row => {
        try {
          return JSON.parse(row.data_json) as Session;
        } catch {
          return null;
        }
      })
      .filter((s): s is Session => s !== null);
  }

  deleteSession(id: string): void {
    const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
    stmt.run(id);
  }

  updateSessionStatus(id: string, status: SessionStatus): void {
    const stmt = this.db.prepare(
      'UPDATE sessions SET status = ?, last_updated = ? WHERE id = ?'
    );
    stmt.run(status, Date.now(), id);
  }

  cleanupOldSessions(days: number = 7): number {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const stmt = this.db.prepare(
      "DELETE FROM sessions WHERE status IN (?, ?) AND last_updated < ?"
    );
    const result = stmt.run('abandoned', 'failed', cutoff);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }
}

let sessionRepo: SessionRepository | null = null;

export function getSessionRepository(): SessionRepository {
  if (!sessionRepo) {
    sessionRepo = new SessionRepository();
  }
  return sessionRepo;
}

export function resetSessionRepository(): void {
  if (sessionRepo) {
    sessionRepo.close();
  }
  sessionRepo = null;
}

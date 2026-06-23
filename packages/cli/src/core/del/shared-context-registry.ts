import Database from 'better-sqlite3';
import { ContextSnapshot, OrchestrationEvent } from './multi-agent-types.js';
import { ok, err, Result } from './types.js';

export interface MergeConflict {
  key: string;
  contributors: string[];
}

export interface ContextCommitResult {
  success: boolean;
  snapshot?: ContextSnapshot;
  conflict?: MergeConflict;
  error?: string;
}

export interface RegistryConfig {
  dbPath: string;
  enableVersioning: boolean;
  maxVersions: number;
}

const DEFAULT_CONFIG: RegistryConfig = {
  dbPath: './eamilos-context.db',
  enableVersioning: true,
  maxVersions: 100,
};

export class SharedContextRegistry {
  private db: Database.Database;
  private config: RegistryConfig;
  private currentDAGId: string | null = null;
  private currentVersion: number = 0;
  private snapshots: Map<number, ContextSnapshot> = new Map();
  private listeners: Array<(event: OrchestrationEvent) => void> = [];

  constructor(config?: Partial<RegistryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.db = new Database(this.config.dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS context_snapshots (
        version INTEGER PRIMARY KEY,
        dag_id TEXT NOT NULL,
        state_json TEXT NOT NULL,
        contributors_json TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_dag
      ON context_snapshots(dag_id);

      CREATE TABLE IF NOT EXISTS dag_executions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        root_goal TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        final_context_version INTEGER
      );
    `);
  }

  beginDAG(dagId: string): void {
    this.currentDAGId = dagId;
    this.currentVersion = 0;
    this.snapshots.clear();
  }

  getCurrentSnapshot(): ContextSnapshot {
    return this.snapshots.get(this.currentVersion) || this.createEmptySnapshot();
  }

  getSnapshot(version: number): ContextSnapshot | undefined {
    return this.snapshots.get(version);
  }

  private createEmptySnapshot(): ContextSnapshot {
    return {
      version: 0,
      dagId: this.currentDAGId || '',
      state: {},
      contributors: {},
      timestamp: Date.now(),
    };
  }

  getSnapshotForTask(_taskId: string): ContextSnapshot {
    return this.getCurrentSnapshot();
  }

  commit(
    taskId: string,
    contextKey: string,
    value: unknown
  ): Result<ContextSnapshot, MergeConflict> {
    if (!this.currentDAGId) {
      throw new Error('No active DAG in context registry');
    }

    const current = this.getCurrentSnapshot();

    if (current.state[contextKey] !== undefined) {
      const conflict: MergeConflict = {
        key: contextKey,
        contributors: [
          ...(current.contributors[contextKey] || []),
          taskId,
        ],
      };
      return err(conflict);
    }

    const newVersion = this.currentVersion + 1;
    const newSnapshot: ContextSnapshot = {
      version: newVersion,
      dagId: this.currentDAGId,
      state: { ...current.state, [contextKey]: value },
      contributors: {
        ...current.contributors,
        [contextKey]: [...(current.contributors[contextKey] || [])],
      },
      timestamp: Date.now(),
    };

    this.snapshots.set(newVersion, newSnapshot);
    this.currentVersion = newVersion;

    this.persistSnapshot(newSnapshot);

    this.emit({
      type: 'CONTEXT_MERGED',
      version: newVersion,
      contributors: newSnapshot.contributors[contextKey] || [taskId],
    });

    return ok(newSnapshot);
  }

  commitMultiple(
    taskId: string,
    entries: Array<{ key: string; value: unknown }>
  ): Result<ContextSnapshot, MergeConflict> {
    if (!this.currentDAGId) {
      throw new Error('No active DAG in context registry');
    }

    const current = this.getCurrentSnapshot();

    for (const entry of entries) {
      if (current.state[entry.key] !== undefined) {
        const conflict: MergeConflict = {
          key: entry.key,
          contributors: [
            ...(current.contributors[entry.key] || []),
            taskId,
          ],
        };
        return err(conflict);
      }
    }

    const newState = { ...current.state };
    const newContributors = { ...current.contributors };

    for (const entry of entries) {
      newState[entry.key] = entry.value;
      newContributors[entry.key] = [...(newContributors[entry.key] || []), taskId];
    }

    const newVersion = this.currentVersion + 1;
    const newSnapshot: ContextSnapshot = {
      version: newVersion,
      dagId: this.currentDAGId,
      state: newState,
      contributors: newContributors,
      timestamp: Date.now(),
    };

    this.snapshots.set(newVersion, newSnapshot);
    this.currentVersion = newVersion;

    this.persistSnapshot(newSnapshot);

    this.emit({
      type: 'CONTEXT_MERGED',
      version: newVersion,
      contributors: entries.map(() => taskId),
    });

    return ok(newSnapshot);
  }

  private persistSnapshot(snapshot: ContextSnapshot): void {
    const stmt = this.db.prepare(`
      INSERT INTO context_snapshots (version, dag_id, state_json, contributors_json, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      snapshot.version,
      snapshot.dagId,
      JSON.stringify(snapshot.state),
      JSON.stringify(snapshot.contributors),
      snapshot.timestamp
    );
  }

  loadSnapshotsForDAG(dagId: string): ContextSnapshot[] {
    const stmt = this.db.prepare(`
      SELECT * FROM context_snapshots WHERE dag_id = ? ORDER BY version ASC
    `);

    const rows = stmt.all(dagId) as Array<{
      version: number;
      dag_id: string;
      state_json: string;
      contributors_json: string;
      timestamp: number;
    }>;

    return rows.map(row => ({
      version: row.version,
      dagId: row.dag_id,
      state: JSON.parse(row.state_json),
      contributors: JSON.parse(row.contributors_json),
      timestamp: row.timestamp,
    }));
  }

  getHistory(contextKey: string): Array<{ version: number; value: unknown; timestamp: number }> {
    if (!this.currentDAGId) return [];

    const stmt = this.db.prepare(`
      SELECT version, state_json, timestamp FROM context_snapshots
      WHERE dag_id = ? ORDER BY version ASC
    `);

    const rows = stmt.all(this.currentDAGId) as Array<{
      version: number;
      state_json: string;
      timestamp: number;
    }>;

    const history: Array<{ version: number; value: unknown; timestamp: number }> = [];

    for (const row of rows) {
      const state = JSON.parse(row.state_json);
      if (state[contextKey] !== undefined) {
        history.push({
          version: row.version,
          value: state[contextKey],
          timestamp: row.timestamp,
        });
      }
    }

    return history;
  }

  rollbackTo(version: number): ContextSnapshot | null {
    const snapshot = this.snapshots.get(version);
    if (!snapshot) return null;

    const newVersion = this.currentVersion + 1;
    const rolledBack: ContextSnapshot = {
      ...snapshot,
      version: newVersion,
      timestamp: Date.now(),
    };

    this.snapshots.set(newVersion, rolledBack);
    this.currentVersion = newVersion;

    this.persistSnapshot(rolledBack);

    return rolledBack;
  }

  subscribe(listener: (event: OrchestrationEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) this.listeners.splice(index, 1);
    };
  }

  private emit(event: OrchestrationEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Context registry listener error:', error);
      }
    }
  }

  enforceRetention(): void {
    if (!this.currentDAGId) return;

    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM context_snapshots WHERE dag_id = ?
    `);
    const result = stmt.get(this.currentDAGId) as { count: number };

    if (result.count > this.config.maxVersions) {
      const deleteStmt = this.db.prepare(`
        DELETE FROM context_snapshots
        WHERE dag_id = ? AND version NOT IN (
          SELECT version FROM context_snapshots
          WHERE dag_id = ?
          ORDER BY version DESC
          LIMIT ?
        )
      `);
      deleteStmt.run(this.currentDAGId, this.currentDAGId, this.config.maxVersions);
    }
  }

  endDAG(): void {
    this.currentDAGId = null;
    this.currentVersion = 0;
    this.snapshots.clear();
  }

  close(): void {
    this.db.close();
  }
}

let globalRegistry: SharedContextRegistry | null = null;

export function initSharedContextRegistry(config?: Partial<RegistryConfig>): SharedContextRegistry {
  if (globalRegistry) return globalRegistry;
  globalRegistry = new SharedContextRegistry(config);
  return globalRegistry;
}

export function getSharedContextRegistry(): SharedContextRegistry {
  return globalRegistry || initSharedContextRegistry();
}

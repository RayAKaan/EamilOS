import Database from 'better-sqlite3';
import { ExecutionGraph, ExecutionNode, GraphEvent } from './graph-types.js';

export interface GraphPersistenceConfig {
  dbPath: string;
}

const DEFAULT_CONFIG: GraphPersistenceConfig = {
  dbPath: './eamilos-graph.db',
};

export class GraphPersistence {
  private db: Database.Database;
  private config: GraphPersistenceConfig;

  constructor(config: Partial<GraphPersistenceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.db = new Database(this.config.dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS graph_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_json TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS graph_nodes (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        parent_id TEXT,
        child_ids_json TEXT NOT NULL,
        label TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        error_json TEXT,
        timestamp INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_graph_events_session ON graph_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_graph_events_timestamp ON graph_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_graph_nodes_session ON graph_nodes(session_id);
    `);
  }

  appendEvent(sessionId: string, event: GraphEvent): void {
    const stmt = this.db.prepare(`
      INSERT INTO graph_events (session_id, event_type, event_json, timestamp)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(sessionId, event.type, JSON.stringify(event), Date.now());
  }

  getEvents(sessionId: string): GraphEvent[] {
    const stmt = this.db.prepare(`
      SELECT event_json FROM graph_events
      WHERE session_id = ?
      ORDER BY id ASC
    `);

    const rows = stmt.all(sessionId) as Array<{ event_json: string }>;
    return rows.map(row => JSON.parse(row.event_json) as GraphEvent);
  }

  persistNode(node: ExecutionNode): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO graph_nodes
      (id, session_id, parent_id, child_ids_json, label, type, status, metadata_json, error_json, timestamp, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      node.id,
      node.sessionId,
      node.parentId,
      JSON.stringify(node.childIds),
      node.label,
      node.type,
      node.status,
      JSON.stringify(node.metadata),
      node.error ? JSON.stringify(node.error) : null,
      node.timestamp,
      node.updatedAt
    );
  }

  persistGraph(graph: ExecutionGraph): void {
    const transaction = this.db.transaction(() => {
      for (const node of Object.values(graph.nodes)) {
        this.persistNode(node);
      }
    });

    transaction();
  }

  loadGraph(sessionId: string): ExecutionGraph | null {
    const nodesStmt = this.db.prepare('SELECT * FROM graph_nodes WHERE session_id = ?');
    const rows = nodesStmt.all(sessionId) as Array<{
      id: string;
      session_id: string;
      parent_id: string | null;
      child_ids_json: string;
      label: string;
      type: string;
      status: string;
      metadata_json: string;
      error_json: string | null;
      timestamp: number;
      updated_at: number;
    }>;

    if (rows.length === 0) {
      return null;
    }

    const nodes: Record<string, ExecutionNode> = {};

    for (const row of rows) {
      nodes[row.id] = {
        id: row.id,
        sessionId: row.session_id,
        parentId: row.parent_id,
        childIds: JSON.parse(row.child_ids_json),
        label: row.label,
        type: row.type as ExecutionNode['type'],
        status: row.status as ExecutionNode['status'],
        metadata: JSON.parse(row.metadata_json),
        error: row.error_json ? JSON.parse(row.error_json) : undefined,
        timestamp: row.timestamp,
        updatedAt: row.updated_at,
      };
    }

    let rootId: string | null = null;
    for (const node of Object.values(nodes)) {
      if (!node.parentId) {
        rootId = node.id;
        break;
      }
    }

    if (!rootId) {
      return null;
    }

    let activeNodeId: string | null = null;
    const runningNodes = Object.values(nodes).filter(n => n.status === 'running');
    if (runningNodes.length > 0) {
      activeNodeId = runningNodes[runningNodes.length - 1].id;
    }

    return {
      rootId,
      nodes,
      activeNodeId,
    };
  }

  deleteSession(sessionId: string): void {
    const deleteEvents = this.db.prepare('DELETE FROM graph_events WHERE session_id = ?');
    const deleteNodes = this.db.prepare('DELETE FROM graph_nodes WHERE session_id = ?');

    const transaction = this.db.transaction(() => {
      deleteEvents.run(sessionId);
      deleteNodes.run(sessionId);
    });

    transaction();
  }

  getEventCount(sessionId: string): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM graph_events WHERE session_id = ?');
    const row = stmt.get(sessionId) as { count: number };
    return row.count;
  }

  getLatestEvent(sessionId: string): GraphEvent | null {
    const stmt = this.db.prepare(`
      SELECT event_json FROM graph_events
      WHERE session_id = ?
      ORDER BY id DESC
      LIMIT 1
    `);

    const row = stmt.get(sessionId) as { event_json: string } | undefined;
    return row ? JSON.parse(row.event_json) as GraphEvent : null;
  }

  close(): void {
    this.db.close();
  }
}

let globalPersistence: GraphPersistence | null = null;

export function initGraphPersistence(config?: Partial<GraphPersistenceConfig>): GraphPersistence {
  if (globalPersistence) {
    return globalPersistence;
  }
  globalPersistence = new GraphPersistence(config);
  return globalPersistence;
}

export function getGraphPersistence(): GraphPersistence {
  if (!globalPersistence) {
    return initGraphPersistence();
  }
  return globalPersistence;
}

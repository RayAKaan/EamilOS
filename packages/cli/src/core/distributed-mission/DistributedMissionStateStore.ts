import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type { TaskNode } from '../mission/types.js';
import type { DistributedAssignment, DistributedMissionEvent } from './types.js';

export interface DistributedMissionLedgerState {
  missionId: string;
  graphVersion: number;
  sequence: number;
  tasks: TaskNode[];
  assignments: DistributedAssignment[];
}

export interface DistributedMissionPersistenceSnapshot {
  state: DistributedMissionLedgerState;
  events: DistributedMissionEvent[];
}

export interface DistributedMissionStateStoreOptions {
  filename: string;
  busyTimeoutMs?: number;
}

export class DistributedMissionStateIntegrityError extends Error {
  readonly code = 'DISTRIBUTED_MISSION_STATE_INTEGRITY_ERROR' as const;
}

export class SqliteDistributedMissionStateStore {
  private readonly db: Database.Database;
  private readonly commitTransaction: (
    state: DistributedMissionLedgerState,
    event: DistributedMissionEvent,
  ) => DistributedMissionEvent;

  constructor(options: DistributedMissionStateStoreOptions) {
    this.db = new Database(options.filename);
    this.db.pragma(`busy_timeout = ${Math.max(0, Math.floor(options.busyTimeoutMs ?? 5000))}`);
    this.db.pragma('foreign_keys = ON');
    if (options.filename !== ':memory:') this.db.pragma('journal_mode = WAL');
    this.migrate();

    this.commitTransaction = this.db.transaction((state, event) => {
      const latest = this.latestEventRow(state.missionId);
      const expectedSequence = (latest?.sequence ?? 0) + 1;
      const expectedPreviousHash = latest?.hash ?? null;

      if (event.sequence !== expectedSequence) {
        throw new DistributedMissionStateIntegrityError(
          `EVENT_SEQUENCE_MISMATCH:${event.sequence}:${expectedSequence}`,
        );
      }

      const stateValue = normalizeState(state);
      const persistedEvent: DistributedMissionEvent = {
        ...event,
        previousHash: expectedPreviousHash ?? undefined,
        data: {
          ...event.data,
          state: stateValue,
        },
      };
      persistedEvent.hash = hashEvent(persistedEvent);

      const stateJson = JSON.stringify(stateValue);
      const stateHash = createHash('sha256').update(stateJson).digest('hex');

      this.db.prepare(
        `INSERT INTO eamilos_distributed_mission_events
          (mission_id, sequence, event_id, type, task_id, node_id, graph_version, timestamp, data_json, previous_hash, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        persistedEvent.missionId,
        persistedEvent.sequence,
        persistedEvent.eventId,
        persistedEvent.type,
        persistedEvent.taskId ?? null,
        persistedEvent.nodeId ?? null,
        persistedEvent.graphVersion,
        persistedEvent.timestamp,
        JSON.stringify(persistedEvent.data),
        persistedEvent.previousHash ?? null,
        persistedEvent.hash,
      );

      this.db.prepare(
        `INSERT INTO eamilos_distributed_mission_snapshots
          (mission_id, graph_version, sequence, state_json, state_hash, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(mission_id) DO UPDATE SET
           graph_version=excluded.graph_version,
           sequence=excluded.sequence,
           state_json=excluded.state_json,
           state_hash=excluded.state_hash,
           updated_at=excluded.updated_at`,
      ).run(
        state.missionId,
        state.graphVersion,
        state.sequence,
        stateJson,
        stateHash,
        event.timestamp,
      );

      return persistedEvent;
    });
  }

  commit(state: DistributedMissionLedgerState, event: DistributedMissionEvent): DistributedMissionEvent {
    if (state.missionId !== event.missionId) {
      throw new DistributedMissionStateIntegrityError('MISSION_ID_MISMATCH');
    }
    return this.commitTransaction(state, event);
  }

  load(missionId: string): DistributedMissionPersistenceSnapshot | undefined {
    const events = this.listEvents(missionId);
    if (events.length === 0) return undefined;

    this.verifyEvents(missionId, events);

    const latest = events.at(-1)!;
    const statePayload = latest.data.state;
    if (!isLedgerState(statePayload) || statePayload.missionId !== missionId) {
      throw new DistributedMissionStateIntegrityError('LATEST_EVENT_STATE_MISSING_OR_INVALID');
    }

    return {
      state: structuredClone(statePayload),
      events: events.map((event) => structuredClone(event)),
    };
  }

  verify(missionId: string): { valid: true; count: number; lastHash?: string } {
    const events = this.listEvents(missionId);
    this.verifyEvents(missionId, events);
    return { valid: true, count: events.length, lastHash: events.at(-1)?.hash };
  }

  listEvents(missionId: string): DistributedMissionEvent[] {
    const rows = this.db.prepare(
      `SELECT * FROM eamilos_distributed_mission_events
       WHERE mission_id = ? ORDER BY sequence ASC`,
    ).all(missionId) as EventRow[];

    return rows.map(hydrateEvent);
  }

  clear(missionId: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM eamilos_distributed_mission_events WHERE mission_id = ?').run(missionId);
      this.db.prepare('DELETE FROM eamilos_distributed_mission_snapshots WHERE mission_id = ?').run(missionId);
    })();
  }

  close(): void {
    if (this.db.open) this.db.close();
  }

  private verifyEvents(missionId: string, events: DistributedMissionEvent[]): void {
    let previousHash: string | null = null;

    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (event.missionId !== missionId) {
        throw new DistributedMissionStateIntegrityError('EVENT_MISSION_ID_MISMATCH');
      }
      if (event.sequence !== index + 1) {
        throw new DistributedMissionStateIntegrityError(
          `EVENT_SEQUENCE_GAP:${event.sequence}:${index + 1}`,
        );
      }
      if ((event.previousHash ?? null) !== previousHash) {
        throw new DistributedMissionStateIntegrityError(`EVENT_CHAIN_BROKEN:${event.eventId}`);
      }
      if (hashEvent(event) !== event.hash) {
        throw new DistributedMissionStateIntegrityError(`EVENT_HASH_MISMATCH:${event.eventId}`);
      }
      previousHash = event.hash ?? null;
    }
  }

  private latestEventRow(missionId: string): { sequence: number; hash: string | null } | undefined {
    return this.db.prepare(
      `SELECT sequence, hash FROM eamilos_distributed_mission_events
       WHERE mission_id = ? ORDER BY sequence DESC LIMIT 1`,
    ).get(missionId) as { sequence: number; hash: string | null } | undefined;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS eamilos_distributed_mission_schema_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS eamilos_distributed_mission_events (
        mission_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_id TEXT PRIMARY KEY NOT NULL,
        type TEXT NOT NULL,
        task_id TEXT,
        node_id TEXT,
        graph_version INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        data_json TEXT NOT NULL,
        previous_hash TEXT,
        hash TEXT NOT NULL UNIQUE,
        UNIQUE (mission_id, sequence)
      );

      CREATE INDEX IF NOT EXISTS idx_distributed_mission_events_mission
        ON eamilos_distributed_mission_events(mission_id, sequence);

      CREATE TABLE IF NOT EXISTS eamilos_distributed_mission_snapshots (
        mission_id TEXT PRIMARY KEY NOT NULL,
        graph_version INTEGER NOT NULL,
        sequence INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        state_hash TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    const row = this.db.prepare(
      'SELECT MAX(version) AS version FROM eamilos_distributed_mission_schema_migrations',
    ).get() as { version?: number | null };

    if ((row.version ?? 0) < SCHEMA_VERSION) {
      this.db.prepare(
        'INSERT INTO eamilos_distributed_mission_schema_migrations(version, applied_at) VALUES (?, ?)',
      ).run(SCHEMA_VERSION, new Date().toISOString());
    }
  }
}

interface EventRow {
  mission_id: string;
  sequence: number;
  event_id: string;
  type: DistributedMissionEvent['type'];
  task_id: string | null;
  node_id: string | null;
  graph_version: number;
  timestamp: string;
  data_json: string;
  previous_hash: string | null;
  hash: string;
}

function hydrateEvent(row: EventRow): DistributedMissionEvent {
  return {
    eventId: row.event_id,
    sequence: row.sequence,
    missionId: row.mission_id,
    type: row.type,
    taskId: row.task_id ?? undefined,
    nodeId: row.node_id ?? undefined,
    graphVersion: row.graph_version,
    timestamp: row.timestamp,
    data: JSON.parse(row.data_json) as Record<string, unknown>,
    previousHash: row.previous_hash ?? undefined,
    hash: row.hash,
  };
}

function hashEvent(event: DistributedMissionEvent): string {
  const { hash: _hash, ...hashable } = event;
  void _hash;
  return createHash('sha256').update(canonical(hashable)).digest('hex');
}

function normalizeState(state: DistributedMissionLedgerState): DistributedMissionLedgerState {
  return {
    missionId: state.missionId,
    graphVersion: state.graphVersion,
    sequence: state.sequence,
    tasks: state.tasks.map((task) => structuredClone(task)),
    assignments: state.assignments.map((assignment) => ({ ...assignment })),
  };
}

function isLedgerState(value: unknown): value is DistributedMissionLedgerState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<DistributedMissionLedgerState>;
  return (
    typeof state.missionId === 'string' &&
    typeof state.graphVersion === 'number' &&
    typeof state.sequence === 'number' &&
    Array.isArray(state.tasks) &&
    Array.isArray(state.assignments)
  );
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const object = value as Record<string, unknown>;
  return '{' + Object.keys(object).filter((key) => object[key] !== undefined).sort()
    .map((key) => JSON.stringify(key) + ':' + canonical(object[key])).join(',') + '}';
}

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';

export interface EamilosEvent {
  eventId: string;
  eventType: string;
  missionId?: string;
  taskId?: string;
  executionId?: string;
  requestId?: string;
  workerId?: string;
  agentId?: string;
  harnessId?: string;
  checkpointId?: string;
  artifactId?: string;
  evidenceId?: string;
  sequence: number;
  occurredAt: string;
  payload: Record<string, unknown>;
  previousHash: string | null;
  hash: string;
}

export interface AppendEventInput extends Omit<EamilosEvent, 'sequence'|'occurredAt'|'previousHash'|'hash'> {
  occurredAt?: string;
  expectedSequence?: number;
  expectedPreviousHash?: string | null;
}

export interface EventQuery {
  missionId?: string;
  taskId?: string;
  executionId?: string;
  fromSequence?: number;
  toSequence?: number;
  limit?: number;
}

export interface DistributedEventLog {
  append(input: AppendEventInput): EamilosEvent;
  get(eventId: string): EamilosEvent | undefined;
  list(query?: EventQuery): EamilosEvent[];
  replay<T>(fromSequence: number, reducer: (state: T, event: EamilosEvent) => T, initialState: T): T;
  latest(): EamilosEvent | undefined;
  verifyIntegrity(): void;
  close?(): void;
}

export class EventLogConflictError extends Error {
  readonly code = 'EVENT_LOG_CONFLICT' as const;
  constructor(message: string) { super(message); this.name = 'EventLogConflictError'; }
}

const SCHEMA_VERSION = 1;

export class EamilosSqliteDistributedEventLog implements DistributedEventLog {
  private readonly db: Database.Database;
  private readonly appendTx: (input: AppendEventInput) => EamilosEvent;

  constructor(options: { filename: string; busyTimeoutMs?: number }) {
    this.db = new Database(options.filename);
    this.db.pragma(`busy_timeout = ${Math.max(0, Math.floor(options.busyTimeoutMs ?? 5000))}`);
    this.db.pragma('foreign_keys = ON');
    if (options.filename !== ':memory:') this.db.pragma('journal_mode = WAL');
    this.migrate();
    this.appendTx = this.db.transaction((input: AppendEventInput) => this.appendUnsafe(input));
  }

  append(input: AppendEventInput): EamilosEvent { return this.appendTx(input); }

  get(eventId: string): EamilosEvent | undefined {
    const row = this.db.prepare('SELECT * FROM eamilos_events WHERE event_id = ?').get(eventId) as EventRow | undefined;
    return row ? hydrate(row) : undefined;
  }

  list(query: EventQuery = {}): EamilosEvent[] {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (query.missionId) { clauses.push('mission_id = ?'); values.push(query.missionId); }
    if (query.taskId) { clauses.push('task_id = ?'); values.push(query.taskId); }
    if (query.executionId) { clauses.push('execution_id = ?'); values.push(query.executionId); }
    if (query.fromSequence !== undefined) { clauses.push('sequence >= ?'); values.push(query.fromSequence); }
    if (query.toSequence !== undefined) { clauses.push('sequence <= ?'); values.push(query.toSequence); }
    const limit = Math.max(1, Math.min(10_000, Math.floor(query.limit ?? 10_000)));
    const sql = `SELECT * FROM eamilos_events${clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''} ORDER BY sequence ASC LIMIT ?`;
    values.push(limit);
    return (this.db.prepare(sql).all(...values) as EventRow[]).map(hydrate);
  }

  replay<T>(fromSequence: number, reducer: (state: T, event: EamilosEvent) => T, initialState: T): T {
    if (!Number.isInteger(fromSequence) || fromSequence < 1) throw new Error('INVALID_REPLAY_SEQUENCE');
    this.verifyIntegrity();
    let state = initialState;
    for (const event of this.list({ fromSequence })) state = reducer(state, event);
    return state;
  }

  latest(): EamilosEvent | undefined {
    const row = this.db.prepare('SELECT * FROM eamilos_events ORDER BY sequence DESC LIMIT 1').get() as EventRow | undefined;
    return row ? hydrate(row) : undefined;
  }

  verifyIntegrity(): void {
    let previous: EamilosEvent | undefined;
    for (const event of this.list()) {
      if (event.previousHash !== (previous?.hash ?? null)) throw new Error(`EVENT_LOG_CHAIN_BROKEN:${event.eventId}`);
      if (hashEvent(event) !== event.hash) throw new Error(`EVENT_LOG_HASH_MISMATCH:${event.eventId}`);
      previous = event;
    }
  }

  close(): void { if (this.db.open) this.db.close(); }

  private appendUnsafe(input: AppendEventInput): EamilosEvent {
    const latest = this.latest();
    const sequence = (latest?.sequence ?? 0) + 1;
    if (latest && input.occurredAt && input.occurredAt < latest.occurredAt) throw new EventLogConflictError('EVENT_TIME_REGRESSION');
    const previousHash = latest?.hash ?? null;
    if (input.expectedSequence !== undefined && input.expectedSequence !== sequence) throw new EventLogConflictError(`EXPECTED_SEQUENCE_MISMATCH:${input.expectedSequence}:${sequence}`);
    if (input.expectedPreviousHash !== undefined && input.expectedPreviousHash !== previousHash) throw new EventLogConflictError('EXPECTED_PREVIOUS_HASH_MISMATCH');
    if (this.get(input.eventId)) throw new EventLogConflictError(`EVENT_ID_ALREADY_EXISTS:${input.eventId}`);
    const event: EamilosEvent = { ...input, sequence, occurredAt: input.occurredAt ?? new Date().toISOString(), previousHash, hash: '' };
    event.hash = hashEvent(event);
    this.db.prepare(`INSERT INTO eamilos_events (event_id,event_type,mission_id,task_id,execution_id,request_id,worker_id,agent_id,harness_id,checkpoint_id,artifact_id,evidence_id,sequence,occurred_at,payload_json,previous_hash,hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(event.eventId,event.eventType,event.missionId??null,event.taskId??null,event.executionId??null,event.requestId??null,event.workerId??null,event.agentId??null,event.harnessId??null,event.checkpointId??null,event.artifactId??null,event.evidenceId??null,event.sequence,event.occurredAt,JSON.stringify(event.payload),event.previousHash,event.hash);
    return event;
  }

  private migrate(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS eamilos_event_schema_migrations(version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL);`);
    const row=this.db.prepare('SELECT MAX(version) AS version FROM eamilos_event_schema_migrations').get() as {version?:number|null};
    if ((row.version??0) >= SCHEMA_VERSION) return;
    this.db.transaction(() => {
      this.db.exec(`CREATE TABLE IF NOT EXISTS eamilos_events(
        event_id TEXT PRIMARY KEY NOT NULL,
        event_type TEXT NOT NULL,
        mission_id TEXT, task_id TEXT, execution_id TEXT, request_id TEXT,
        worker_id TEXT, agent_id TEXT, harness_id TEXT, checkpoint_id TEXT,
        artifact_id TEXT, evidence_id TEXT, sequence INTEGER NOT NULL UNIQUE,
        occurred_at TEXT NOT NULL, payload_json TEXT NOT NULL, previous_hash TEXT, hash TEXT NOT NULL UNIQUE
      ); CREATE INDEX IF NOT EXISTS idx_eamilos_events_mission ON eamilos_events(mission_id,sequence);
      CREATE INDEX IF NOT EXISTS idx_eamilos_events_execution ON eamilos_events(execution_id,sequence);
      CREATE INDEX IF NOT EXISTS idx_eamilos_events_task ON eamilos_events(task_id,sequence);`);
      this.db.prepare('INSERT INTO eamilos_event_schema_migrations(version,applied_at) VALUES(?,?)').run(SCHEMA_VERSION,new Date().toISOString());
    })();
  }
}

type EventRow = {event_id:string;event_type:string;mission_id:string|null;task_id:string|null;execution_id:string|null;request_id:string|null;worker_id:string|null;agent_id:string|null;harness_id:string|null;checkpoint_id:string|null;artifact_id:string|null;evidence_id:string|null;sequence:number;occurred_at:string;payload_json:string;previous_hash:string|null;hash:string};
function hydrate(row: EventRow): EamilosEvent { return {eventId:row.event_id,eventType:row.event_type,missionId:row.mission_id??undefined,taskId:row.task_id??undefined,executionId:row.execution_id??undefined,requestId:row.request_id??undefined,workerId:row.worker_id??undefined,agentId:row.agent_id??undefined,harnessId:row.harness_id??undefined,checkpointId:row.checkpoint_id??undefined,artifactId:row.artifact_id??undefined,evidenceId:row.evidence_id??undefined,sequence:row.sequence,occurredAt:row.occurred_at,payload:JSON.parse(row.payload_json) as Record<string,unknown>,previousHash:row.previous_hash,hash:row.hash}; }
function hashEvent(event:EamilosEvent):string { return createHash('sha256').update(JSON.stringify({eventId:event.eventId,eventType:event.eventType,missionId:event.missionId??null,taskId:event.taskId??null,executionId:event.executionId??null,requestId:event.requestId??null,workerId:event.workerId??null,agentId:event.agentId??null,harnessId:event.harnessId??null,checkpointId:event.checkpointId??null,artifactId:event.artifactId??null,evidenceId:event.evidenceId??null,sequence:event.sequence,occurredAt:event.occurredAt,payload:event.payload,previousHash:event.previousHash})).digest('hex'); }

import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { RuntimeEventSchema, type RuntimeEvent, type RuntimeEventType } from './types.js';

export interface MissionEventInput {
  missionId: string;
  taskId?: string;
  executionId?: string;
  type: RuntimeEventType;
  actor: string;
  payload?: Record<string, unknown>;
}

export interface MissionCheckpoint<T = unknown> {
  version: 1;
  missionId: string;
  sequence: number;
  eventId: string;
  createdAt: string;
  state: T;
  eventHash: string;
}

export interface MissionEventStoreOptions {
  readonly root?: string;
  readonly checkpointEvery?: number;
}

export class MissionEventStore {
  private readonly cache = new Map<string, RuntimeEvent[]>();
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly root: string;
  private readonly checkpointEvery: number;

  constructor(options: MissionEventStoreOptions = {}) {
    this.root = options.root ?? join(process.cwd(), '.eamilos', 'missions');
    this.checkpointEvery = Math.max(1, options.checkpointEvery ?? 50);
  }

  async append(input: MissionEventInput): Promise<RuntimeEvent> {
    return this.serial(input.missionId, async () => {
      const events = await this.load(input.missionId);
      const previous = events.at(-1);
      const base = {
        eventId: randomUUID(),
        missionId: input.missionId,
        taskId: input.taskId,
        executionId: input.executionId,
        timestamp: new Date().toISOString(),
        sequence: events.length,
        type: input.type,
        actor: input.actor,
        payload: structuredClone(input.payload ?? {}),
        previousEventHash: previous?.hash,
      };
      const hash = hashEvent(base);
      const event = RuntimeEventSchema.parse({ ...base, hash });
      await mkdir(dirname(this.eventsPath(input.missionId)), { recursive: true });
      await appendFile(this.eventsPath(input.missionId), JSON.stringify(event) + '\n', 'utf8');
      events.push(event);
      this.cache.set(input.missionId, events);
      return event;
    });
  }

  async load(missionId: string): Promise<RuntimeEvent[]> {
    const cached = this.cache.get(missionId);
    if (cached) return cached.map(cloneEvent);
    try {
      const raw = await readFile(this.eventsPath(missionId), 'utf8');
      const events = raw.split('\n').filter(Boolean).map(line => RuntimeEventSchema.parse(JSON.parse(line)));
      this.cache.set(missionId, events);
      return events.map(cloneEvent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache.set(missionId, []);
        return [];
      }
      throw error;
    }
  }

  async verify(missionId: string): Promise<{ valid: true; count: number; lastHash?: string } | never> {
    const events = await this.load(missionId);
    let previousHash: string | undefined;
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (event.sequence !== index) throw new Error(`Mission event sequence mismatch at ${index}`);
      if (event.previousEventHash !== previousHash) throw new Error(`Mission event chain broken at sequence ${index}`);
      if (hashEvent(eventWithoutHash(event)) !== event.hash) throw new Error(`Mission event hash mismatch at sequence ${index}`);
      previousHash = event.hash;
    }
    return { valid: true, count: events.length, lastHash: previousHash };
  }

  async replay<T>(
    missionId: string,
    reducer: (state: T, event: RuntimeEvent) => T,
    initialState: T,
    options: { untilSequence?: number; fromCheckpoint?: MissionCheckpoint<T> } = {},
  ): Promise<{ state: T; eventsApplied: number; lastEvent?: RuntimeEvent }> {
    await this.verify(missionId);
    const events = await this.load(missionId);
    let state = structuredClone(options.fromCheckpoint?.state ?? initialState);
    const start = options.fromCheckpoint ? options.fromCheckpoint.sequence + 1 : 0;
    const end = Math.min(options.untilSequence ?? Number.MAX_SAFE_INTEGER, events.length - 1);
    let applied = 0;
    for (let index = start; index <= end; index += 1) {
      state = reducer(state, cloneEvent(events[index]));
      applied += 1;
    }
    return { state, eventsApplied: applied, lastEvent: events[end] ? cloneEvent(events[end]) : undefined };
  }

  async checkpoint<T>(missionId: string, state: T): Promise<MissionCheckpoint<T> | undefined> {
    const events = await this.load(missionId);
    const last = events.at(-1);
    if (!last) return undefined;
    const checkpoint: MissionCheckpoint<T> = {
      version: 1,
      missionId,
      sequence: last.sequence,
      eventId: last.eventId,
      createdAt: new Date().toISOString(),
      state: structuredClone(state),
      eventHash: last.hash,
    };
    const path = this.checkpointPath(missionId);
    const temp = path + '.tmp-' + randomUUID();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temp, JSON.stringify(checkpoint), 'utf8');
    await rename(temp, path);
    return checkpoint;
  }

  async loadCheckpoint<T>(missionId: string): Promise<MissionCheckpoint<T> | undefined> {
    try {
      return JSON.parse(await readFile(this.checkpointPath(missionId), 'utf8')) as MissionCheckpoint<T>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async fork(sourceMissionId: string, targetMissionId: string, throughSequence?: number): Promise<MissionEventStore> {
    if (sourceMissionId === targetMissionId) throw new Error('Cannot fork a mission into itself');
    const source = await this.load(sourceMissionId);
    const end = Math.min(throughSequence ?? source.length - 1, source.length - 1);
    if (end < -1) throw new Error('Invalid fork sequence');
    const target = new MissionEventStore({ root: this.root, checkpointEvery: this.checkpointEvery });
    for (let index = 0; index <= end; index += 1) {
      const original = source[index];
      await target.append({
        missionId: targetMissionId,
        taskId: original.taskId,
        executionId: original.executionId,
        type: original.type,
        actor: `fork:${sourceMissionId}`,
        payload: {
          ...structuredClone(original.payload),
          forkedFrom: { missionId: sourceMissionId, eventId: original.eventId, sequence: original.sequence },
        },
      });
    }
    return target;
  }

  async recent(missionId: string, limit = 50): Promise<RuntimeEvent[]> {
    const events = await this.load(missionId);
    return events.slice(-Math.max(0, limit)).map(cloneEvent);
  }

  async clearCache(missionId?: string): Promise<void> {
    if (missionId) this.cache.delete(missionId);
    else this.cache.clear();
  }

  private async serial<T>(missionId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(missionId) ?? Promise.resolve();
    const current = previous.then(work, work);
    this.tails.set(missionId, current);
    try {
      return await current;
    } finally {
      if (this.tails.get(missionId) === current) this.tails.delete(missionId);
    }
  }

  private eventsPath(missionId: string): string {
    return join(this.root, encodeURIComponent(missionId), 'events.jsonl');
  }

  private checkpointPath(missionId: string): string {
    return join(this.root, encodeURIComponent(missionId), 'checkpoint.json');
  }
}

function eventWithoutHash(event: RuntimeEvent): Omit<RuntimeEvent, 'hash'> {
  const { hash: _hash, ...rest } = event;
  return rest;
}

function hashEvent(event: Omit<RuntimeEvent, 'hash'>): string {
  return createHash('sha256').update(canonical(event)).digest('hex');
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const object = value as Record<string, unknown>;
  return '{' + Object.keys(object).filter(key => object[key] !== undefined).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(object[key])).join(',') + '}';
}

function cloneEvent(event: RuntimeEvent): RuntimeEvent {
  return structuredClone(event);
}

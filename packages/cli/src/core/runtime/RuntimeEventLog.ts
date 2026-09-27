import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { RuntimeEventSchema, type RuntimeEvent } from './types.js';

export class RuntimeEventLog {
  private readonly cache = new Map<string, RuntimeEvent[]>();
  constructor(private readonly file?: string) {}

  async append(input: Omit<RuntimeEvent, 'eventId' | 'sequence' | 'timestamp' | 'hash' | 'previousEventHash'> & { timestamp?: string }): Promise<RuntimeEvent> {
    const list = await this.load(input.missionId);
    const previous = list.at(-1);
    const base = { ...input, eventId: randomUUID(), sequence: list.length, timestamp: input.timestamp ?? new Date().toISOString(), previousEventHash: previous?.hash };
    const normalized = RuntimeEventSchema.parse({ ...base, hash: 'pending' });
    const { hash: _pendingHash, ...hashable } = normalized;
    void _pendingHash;
    const hash = createHash('sha256').update(canonical(hashable)).digest('hex');
    const event = RuntimeEventSchema.parse({ ...hashable, hash });
    list.push(event);
    this.cache.set(event.missionId, list);
    if (this.file) {
      await mkdir(dirname(this.file), { recursive: true });
      await appendFile(this.file, JSON.stringify(event) + '\n', 'utf8');
    }
    return event;
  }

  async load(missionId: string): Promise<RuntimeEvent[]> {
    const cached = this.cache.get(missionId);
    if (cached) return [...cached];
    if (!this.file) { this.cache.set(missionId, []); return []; }
    try {
      const raw = await readFile(this.file, 'utf8');
      const all = raw.split('\n').filter(Boolean).map((line) => RuntimeEventSchema.parse(JSON.parse(line)));
      const list = all.filter((event) => event.missionId === missionId);
      this.cache.set(missionId, list);
      return [...list];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { this.cache.set(missionId, []); return []; }
      throw error;
    }
  }

  async replay(missionId: string): Promise<RuntimeEvent[]> {
    const events = await this.load(missionId);
    let previous: string | undefined;
    for (const event of events) {
      if (event.previousEventHash !== previous) throw new Error('Runtime event chain is broken at sequence ' + event.sequence);
      const { hash: _hash, ...hashable } = event;
      void _hash;
      const expected = createHash('sha256').update(canonical(hashable)).digest('hex');
      if (expected !== event.hash) throw new Error('Runtime event hash mismatch at sequence ' + event.sequence);
      previous = event.hash;
    }
    return events;
  }

  async recent(missionId: string, limit = 50): Promise<RuntimeEvent[]> {
    const events = await this.load(missionId);
    return events.slice(-limit);
  }
}

function canonical(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).filter((key) => object[key] !== undefined).sort();
  return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonical(object[key])).join(',') + '}';
}
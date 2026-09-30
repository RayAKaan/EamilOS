import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface SessionEvent<T = Record<string, unknown>> {
  seq: number;
  id: string;
  sessionId: string;
  type: string;
  timestamp: string;
  data: T;
}

export interface SessionProjection<T> {
  apply(state: T, event: SessionEvent): T;
}

export class EventSourcedSession<T = Record<string, unknown>> {
  private readonly events: SessionEvent[] = [];
  private state: T;
  private loaded = false;

  constructor(
    readonly sessionId: string,
    initialState: T,
    private readonly root = join(process.cwd(), '.eamilos', 'session-events'),
  ) {
    this.state = structuredClone(initialState);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.path(), 'utf8');
      for (const line of raw.split('\n').filter(Boolean)) {
        const event = JSON.parse(line) as SessionEvent;
        this.events.push(Object.freeze(event));
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async append<P extends Record<string, unknown>>(type: string, data: P): Promise<SessionEvent<P>> {
    await this.load();
    const event = Object.freeze({
      seq: this.events.length,
      id: randomUUID(),
      sessionId: this.sessionId,
      type,
      timestamp: new Date().toISOString(),
      data: structuredClone(data),
    }) as SessionEvent<P>;
    await mkdir(dirname(this.path()), { recursive: true });
    await appendFile(this.path(), JSON.stringify(event) + '\n', 'utf8');
    this.events.push(event);
    return event;
  }

  eventsSnapshot(): readonly SessionEvent[] {
    return this.events.slice();
  }

  reduce<R>(projection: SessionProjection<R>, initial: R): R {
    return this.events.reduce((state, event) => projection.apply(state, event), structuredClone(initial));
  }

  private path(): string {
    return join(this.root, `${this.sessionId}.jsonl`);
  }
}

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { canonicalJson } from '../cognitive-graph/CognitiveGraph.js';
import type { AutonomousLoopState, LoopEvent, LoopPhase } from './types.js';

export class LoopEventLog {
  constructor(private readonly root = join(process.cwd(), '.eamilos', 'loops')) {}

  private path(missionId: string): string {
    return join(this.root, `${missionId}.events.jsonl`);
  }

  async append(input: {
    missionId: string;
    iteration: number;
    phase: LoopPhase;
    type: string;
    payload?: Record<string, unknown>;
  }): Promise<LoopEvent> {
    await mkdir(dirname(this.path(input.missionId)), { recursive: true });
    const existing = await this.all(input.missionId);
    const previousEventHash = existing.at(-1)?.hash;
    const event = {
      eventId: `loop_event_${randomUUID()}`,
      missionId: input.missionId,
      iteration: input.iteration,
      phase: input.phase,
      type: input.type,
      timestamp: new Date().toISOString(),
      payload: input.payload ?? {},
      previousEventHash,
      hash: '',
    } satisfies Omit<LoopEvent, 'hash'> & { hash: string };
    const unsigned = { ...event, hash: undefined };
    event.hash = createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
    await appendFile(this.path(input.missionId), JSON.stringify(event) + '\n', 'utf8');
    return event;
  }

  async all(missionId: string): Promise<LoopEvent[]> {
    try {
      const raw = await readFile(this.path(missionId), 'utf8');
      return raw.split('\n').filter(Boolean).map(line => JSON.parse(line) as LoopEvent);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? (error as { code?: string }).code
        : undefined;
      if (code === 'ENOENT') return [];
      throw error;
    }
  }

  async verify(missionId: string): Promise<boolean> {
    let previous: string | undefined;
    for (const event of await this.all(missionId)) {
      if (event.previousEventHash !== previous) return false;
      const expected = createHash('sha256').update(canonicalJson({ ...event, hash: undefined })).digest('hex');
      if (expected !== event.hash) return false;
      previous = event.hash;
    }
    return true;
  }

  async summarize(missionId: string): Promise<Partial<AutonomousLoopState>> {
    const events = await this.all(missionId);
    const last = events.at(-1);
    return last ? { missionId, iteration: last.iteration, phase: last.phase, updatedAt: last.timestamp } : { missionId };
  }
}

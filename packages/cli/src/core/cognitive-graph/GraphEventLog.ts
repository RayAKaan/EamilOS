import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson } from './CognitiveGraph.js';
import { GraphEventSchema, type GraphEvent } from './types.js';

export class GraphEventLog {
  private readonly events = new Map<string, GraphEvent[]>();
  private readonly heads = new Map<string, string | undefined>();

  append(input: Omit<GraphEvent, 'eventId' | 'sequence' | 'previousEventHash' | 'hash'>): GraphEvent {
    const list = this.events.get(input.missionId) ?? [];
    const previousEventHash = this.heads.get(input.missionId);
    const event = {
      ...input,
      eventId: `graph_event_${randomUUID()}`,
      sequence: list.length + 1,
      previousEventHash,
      hash: '',
    };
    event.hash = createHash('sha256').update(canonicalJson({
      eventId: event.eventId, missionId: event.missionId, sequence: event.sequence,
      version: event.version, type: event.type, timestamp: event.timestamp,
      actor: event.actor, mutationId: event.mutationId, payload: event.payload,
      previousEventHash: event.previousEventHash,
    })).digest('hex');
    const parsed = GraphEventSchema.parse(event);
    list.push(parsed);
    this.events.set(input.missionId, list);
    this.heads.set(input.missionId, parsed.hash);
    return parsed;
  }

  eventsSince(missionId: string, sequence = 0): GraphEvent[] {
    return [...(this.events.get(missionId) ?? [])].filter(event => event.sequence > sequence);
  }

  all(missionId: string): GraphEvent[] { return [...(this.events.get(missionId) ?? [])]; }

  verify(missionId: string): boolean {
    let previous: string | undefined;
    for (const event of this.all(missionId)) {
      if (event.previousEventHash !== previous) return false;
      const expected = createHash('sha256').update(canonicalJson({
        eventId: event.eventId, missionId: event.missionId, sequence: event.sequence,
        version: event.version, type: event.type, timestamp: event.timestamp,
        actor: event.actor, mutationId: event.mutationId, payload: event.payload,
        previousEventHash: event.previousEventHash,
      })).digest('hex');
      if (expected !== event.hash) return false;
      previous = event.hash;
    }
    return true;
  }
}

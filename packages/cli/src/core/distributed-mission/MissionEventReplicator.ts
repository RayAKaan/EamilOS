import type { FabricMessage } from '../fabric/types.js';
import type { FabricTransport } from '../fabric/FabricTransport.js';
import type { DistributedMissionEvent } from './types.js';

export interface MissionEventEnvelope {
  missionId: string;
  events: DistributedMissionEvent[];
  sourceNodeId: string;
}

export class MissionEventReplicator {
  private readonly seen = new Set<string>();

  constructor(
    private readonly transport: FabricTransport,
    private readonly nodeId: string,
  ) {}

  publish(missionId: string, events: DistributedMissionEvent[]): void {
    const fresh = events.filter((event) => !this.seen.has(event.eventId));
    if (fresh.length === 0) return;
    fresh.forEach((event) => this.seen.add(event.eventId));
    const peers = this.transport.connectedPeers();
    for (const peerId of peers) {
      const message = this.transportMessage('mission:events', {
        missionId,
        events: fresh,
        sourceNodeId: this.nodeId,
      }, peerId);
      this.transport.send(peerId, message);
    }
  }

  accept(message: FabricMessage<MissionEventEnvelope>): DistributedMissionEvent[] {
    if (message.type !== 'mission:events') return [];
    const fresh = message.payload.events.filter((event) => !this.seen.has(event.eventId));
    fresh.forEach((event) => this.seen.add(event.eventId));
    return fresh;
  }

  private transportMessage(type: 'mission:events', payload: MissionEventEnvelope, to: string): FabricMessage<MissionEventEnvelope> {
    return this.transport['node'].createMessage(type, payload, to);
  }
}

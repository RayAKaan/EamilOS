import type { FabricMessage } from '../fabric/types.js';
import type { FabricTransport } from '../fabric/FabricTransport.js';
import type { DistributedMissionEvent } from './types.js';
import type { DistributedMissionPersistenceSnapshot } from './DistributedMissionStateStore.js';

export interface MissionEventEnvelope {
  missionId: string;
  events: DistributedMissionEvent[];
  sourceNodeId: string;
}

export interface MissionEventAckEnvelope {
  missionId: string;
  sourceNodeId: string;
  contiguousSequence: number;
}

export interface MissionEventReplayRequestEnvelope {
  missionId: string;
  sourceNodeId: string;
  fromSequence: number;
  toSequence?: number;
}

export interface MissionEventSnapshotEnvelope {
  missionId: string;
  sourceNodeId: string;
  snapshot: DistributedMissionPersistenceSnapshot;
}

export interface MissionEventReplicationHandlers {
  onEvents?: (events: DistributedMissionEvent[], sourceNodeId: string) => void;
  onSnapshot?: (snapshot: DistributedMissionPersistenceSnapshot, sourceNodeId: string) => void;
  getEvents?: (missionId: string, fromSequence: number, toSequence?: number) => DistributedMissionEvent[];
  getSnapshot?: (missionId: string) => DistributedMissionPersistenceSnapshot | undefined;
  listMissions?: () => string[];
  maxReplayBatch?: number;
}

export interface ReplicationStatus {
  peerId: string;
  missionId: string;
  contiguousSequence: number;
  pendingSequences: number[];
  lastAckedSequence: number;
}

/**
 * Replicates mission events over the authenticated Fabric transport.
 *
 * Sequence numbers are mission-local and form the ordering boundary. Event IDs
 * provide idempotency; the sequence cursor provides gap detection. Out-of-order
 * events are retained until the missing prefix arrives or a snapshot is used.
 */
export class MissionEventReplicator {
  private readonly seen = new Set<string>();
  private readonly contiguous = new Map<string, number>();
  private readonly pending = new Map<string, Map<number, DistributedMissionEvent>>();
  private readonly acked = new Map<string, number>();
  private readonly handlers: Required<Pick<MissionEventReplicationHandlers, 'maxReplayBatch'>> &
    Omit<MissionEventReplicationHandlers, 'maxReplayBatch'>;

  constructor(
    private readonly transport: FabricTransport,
    private readonly nodeId: string,
    handlers: MissionEventReplicationHandlers = {},
  ) {
    this.handlers = { ...handlers, maxReplayBatch: handlers.maxReplayBatch ?? 500 };

    this.transport.on('message', (message: FabricMessage) => this.handleMessage(message));
    this.transport.on('peer:connected', (peerId: string) => this.onPeerConnected(peerId));
    this.transport.on('peer:disconnected', (peerId: string) => this.onPeerDisconnected(peerId));
  }

  publish(missionId: string, events: DistributedMissionEvent[]): void {
    if (events.length === 0) return;
    const fresh = events.filter((event) => {
      if (event.missionId !== missionId || this.seen.has(event.eventId)) return false;
      this.seen.add(event.eventId);
      return true;
    });
    if (fresh.length === 0) return;

    for (const peerId of this.transport.connectedPeers()) {
      this.sendEvents(peerId, missionId, fresh);
    }
  }

  accept(message: FabricMessage<MissionEventEnvelope>): DistributedMissionEvent[] {
    if (message.type !== 'mission:events') return [];
    return this.acceptEvents(message.payload, message.from);
  }

  status(peerId: string, missionId: string): ReplicationStatus {
    const key = this.key(peerId, missionId);
    return {
      peerId,
      missionId,
      contiguousSequence: this.contiguous.get(key) ?? 0,
      pendingSequences: [...(this.pending.get(key)?.keys() ?? [])].sort((a, b) => a - b),
      lastAckedSequence: this.acked.get(key) ?? 0,
    };
  }

  disconnect(peerId: string): void {
    for (const key of [...this.contiguous.keys()]) if (key.startsWith(peerId + '\0')) this.contiguous.delete(key);
    for (const key of [...this.pending.keys()]) if (key.startsWith(peerId + '\0')) this.pending.delete(key);
    for (const key of [...this.acked.keys()]) if (key.startsWith(peerId + '\0')) this.acked.delete(key);
  }

  private handleMessage(message: FabricMessage): void {
    switch (message.type) {
      case 'mission:events':
        this.acceptEvents(message.payload as MissionEventEnvelope, message.from);
        return;
      case 'mission:events:ack':
        this.handleAck(message as FabricMessage<MissionEventAckEnvelope>);
        return;
      case 'mission:events:replay-request':
        this.handleReplayRequest(message as FabricMessage<MissionEventReplayRequestEnvelope>);
        return;
      case 'mission:events:snapshot':
        this.handleSnapshot(message as FabricMessage<MissionEventSnapshotEnvelope>);
        return;
      default:
        return;
    }
  }

  private acceptEvents(envelope: MissionEventEnvelope, sourceNodeId: string): DistributedMissionEvent[] {
    if (envelope.sourceNodeId !== sourceNodeId || envelope.missionId === '') return [];
    const key = this.key(sourceNodeId, envelope.missionId);
    const cursor = this.contiguous.get(key) ?? 0;
    const buffer = this.pending.get(key) ?? new Map<number, DistributedMissionEvent>();
    this.pending.set(key, buffer);

    for (const event of envelope.events) {
      if (event.missionId !== envelope.missionId || this.seen.has(event.eventId)) continue;
      if (event.sequence <= cursor || buffer.has(event.sequence)) {
        this.seen.add(event.eventId);
        continue;
      }
      buffer.set(event.sequence, event);
    }

    const ready: DistributedMissionEvent[] = [];
    let next = (this.contiguous.get(key) ?? 0) + 1;
    while (buffer.has(next)) {
      const event = buffer.get(next)!;
      buffer.delete(next);
      this.seen.add(event.eventId);
      ready.push(event);
      this.contiguous.set(key, next);
      next += 1;
    }

    const newCursor = this.contiguous.get(key) ?? 0;
    if (newCursor > cursor) this.sendAck(sourceNodeId, envelope.missionId, newCursor);

    const highest = Math.max(cursor, ...[...buffer.keys(), 0]);
    if (highest > newCursor && this.handlers.getEvents) {
      this.requestGap(sourceNodeId, envelope.missionId, newCursor + 1, Math.min(highest, newCursor + this.handlers.maxReplayBatch));
    }

    if (ready.length > 0) this.handlers.onEvents?.(ready, sourceNodeId);
    return ready;
  }

  private handleAck(message: FabricMessage<MissionEventAckEnvelope>): void {
    const payload = message.payload;
    if (payload.sourceNodeId !== message.from) return;
    this.acked.set(this.key(message.from, payload.missionId), Math.max(
      this.acked.get(this.key(message.from, payload.missionId)) ?? 0,
      payload.contiguousSequence,
    ));
  }

  private handleReplayRequest(message: FabricMessage<MissionEventReplayRequestEnvelope>): void {
    const request = message.payload;
    if (request.sourceNodeId !== message.from || !this.handlers.getEvents) return;
    const max = this.handlers.maxReplayBatch;
    const to = Math.min(request.toSequence ?? Number.MAX_SAFE_INTEGER, request.fromSequence + max - 1);
    const events = this.handlers.getEvents(request.missionId, request.fromSequence, to);
    if (events.length > 0) this.sendEvents(message.from, request.missionId, events);
    else this.sendSnapshot(message.from, request.missionId);
  }

  private handleSnapshot(message: FabricMessage<MissionEventSnapshotEnvelope>): void {
    const payload = message.payload;
    if (payload.sourceNodeId !== message.from || payload.snapshot.state.missionId !== payload.missionId) return;
    const key = this.key(message.from, payload.missionId);
    const snapshotSequence = payload.snapshot.state.sequence;
    this.contiguous.set(key, snapshotSequence);
    this.pending.delete(key);
    this.handlers.onSnapshot?.(payload.snapshot, message.from);
    this.sendAck(message.from, payload.missionId, snapshotSequence);
  }

  private onPeerConnected(peerId: string): void {
    if (!this.handlers.getEvents || !this.handlers.listMissions) return;
    for (const missionId of this.handlers.listMissions()) {
      const cursor = this.contiguous.get(this.key(peerId, missionId)) ?? 0;
      const latest = this.handlers.getEvents(missionId, cursor + 1);
      if (latest.length > 0) this.sendEvents(peerId, missionId, latest.slice(0, this.handlers.maxReplayBatch));
      else this.sendSnapshot(peerId, missionId);
    }
  }

  private onPeerDisconnected(peerId: string): void {
    this.disconnect(peerId);
  }

  private sendEvents(peerId: string, missionId: string, events: DistributedMissionEvent[]): void {
    const message = this.transport.createMessage<MissionEventEnvelope>('mission:events', {
      missionId,
      events,
      sourceNodeId: this.nodeId,
    }, peerId);
    this.transport.send(peerId, message);
  }

  private sendAck(peerId: string, missionId: string, contiguousSequence: number): void {
    const message = this.transport.createMessage<MissionEventAckEnvelope>('mission:events:ack', {
      missionId,
      sourceNodeId: this.nodeId,
      contiguousSequence,
    }, peerId);
    this.transport.send(peerId, message);
  }

  private requestGap(peerId: string, missionId: string, fromSequence: number, toSequence: number): void {
    const message = this.transport.createMessage<MissionEventReplayRequestEnvelope>('mission:events:replay-request', {
      missionId,
      sourceNodeId: this.nodeId,
      fromSequence,
      toSequence,
    }, peerId);
    this.transport.send(peerId, message);
  }

  private sendSnapshot(peerId: string, missionId: string): void {
    const snapshot = this.handlers.getSnapshot?.(missionId);
    if (!snapshot) return;
    const message = this.transport.createMessage<MissionEventSnapshotEnvelope>('mission:events:snapshot', {
      missionId,
      sourceNodeId: this.nodeId,
      snapshot,
    }, peerId);
    this.transport.send(peerId, message);
  }

  private key(peerId: string, missionId: string): string {
    return peerId + '\0' + missionId;
  }
}

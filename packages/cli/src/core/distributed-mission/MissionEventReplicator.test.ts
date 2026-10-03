import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { MissionEventReplicator, type MissionEventEnvelope } from './MissionEventReplicator.js';
import type { DistributedMissionEvent } from './types.js';

class FakeTransport extends EventEmitter {
  peers = ['peer-a'];
  sent: Array<{ peerId: string; message: any }> = [];

  connectedPeers(): string[] { return [...this.peers]; }

  createMessage<T>(type: any, payload: T, to?: string): any {
    return {
      protocolVersion: 1,
      messageId: Math.random().toString(36),
      timestamp: Date.now(),
      type,
      from: 'local',
      to,
      payload,
      signature: 'test',
    };
  }

  send(peerId: string, message: any): void {
    this.sent.push({ peerId, message });
  }
}

function event(sequence: number, missionId = 'mission-1'): DistributedMissionEvent {
  return {
    eventId: `event-${sequence}`,
    sequence,
    missionId,
    type: 'TASK_COMPLETED',
    taskId: 'task-1',
    nodeId: 'node-a',
    graphVersion: sequence,
    timestamp: new Date(sequence * 1000).toISOString(),
    data: {},
    previousHash: sequence > 1 ? `hash-${sequence - 1}` : undefined,
    hash: `hash-${sequence}`,
  };
}

function message(events: DistributedMissionEvent[], from = 'peer-a'): any {
  return {
    protocolVersion: 1,
    messageId: 'message-' + events.map(e => e.sequence).join('-'),
    timestamp: Date.now(),
    type: 'mission:events',
    from,
    payload: { missionId: 'mission-1', events, sourceNodeId: from },
    signature: 'test',
  };
}

describe('MissionEventReplicator', () => {
  it('deduplicates events and advances only through contiguous sequences', () => {
    const transport = new FakeTransport();
    const received: DistributedMissionEvent[] = [];
    const replicator = new MissionEventReplicator(transport as never, 'local', {
      onEvents: events => received.push(...events),
    });

    expect(replicator.accept(message([event(2)])).length).toBe(0);
    expect(replicator.status('peer-a', 'mission-1').pendingSequences).toEqual([2]);
    expect(replicator.accept(message([event(1), event(2)])).map(e => e.sequence)).toEqual([1, 2]);
    expect(received.map(e => e.sequence)).toEqual([1, 2]);
    expect(replicator.accept(message([event(1), event(2)])).length).toBe(0);
    expect(replicator.status('peer-a', 'mission-1').contiguousSequence).toBe(2);
    expect(transport.sent.some(item => item.message.type === 'mission:events:ack')).toBe(true);
  });

  it('requests missing ranges when a sequence gap is observed', () => {
    const transport = new FakeTransport();
    const replicator = new MissionEventReplicator(transport as never, 'local', {
      getEvents: () => [],
    });

    replicator.accept(message([event(4)]));
    const request = transport.sent.find(item => item.message.type === 'mission:events:replay-request');
    expect(request?.message.payload.fromSequence).toBe(1);
    expect(request?.message.payload.toSequence).toBe(4);
  });

  it('serves bounded replay requests and falls back to a snapshot', () => {
    const transport = new FakeTransport();
    const events = [event(1), event(2), event(3)];
    const snapshot = {
      state: {
        missionId: 'mission-1',
        graphVersion: 3,
        sequence: 3,
        tasks: [],
        assignments: [],
      },
      events,
    };

    const replicator = new MissionEventReplicator(transport as never, 'local', {
      maxReplayBatch: 2,
      getEvents: (_missionId, from, to) => events.filter(e => e.sequence >= from && (!to || e.sequence <= to)),
      getSnapshot: () => snapshot,
      listMissions: () => ['mission-1'],
    });

    transport.emit('message', {
      protocolVersion: 1,
      messageId: 'request-1',
      timestamp: Date.now(),
      type: 'mission:events:replay-request',
      from: 'peer-a',
      to: 'local',
      payload: { missionId: 'mission-1', sourceNodeId: 'peer-a', fromSequence: 1, toSequence: 3 },
      signature: 'test',
    });

    const replay = transport.sent.find(item => item.message.type === 'mission:events');
    expect(replay?.message.payload.events.map((e: DistributedMissionEvent) => e.sequence)).toEqual([1, 2]);

    transport.sent.length = 0;
    transport.emit('message', {
      protocolVersion: 1,
      messageId: 'request-2',
      timestamp: Date.now(),
      type: 'mission:events:replay-request',
      from: 'peer-a',
      to: 'local',
      payload: { missionId: 'mission-1', sourceNodeId: 'peer-a', fromSequence: 99 },
      signature: 'test',
    });
    expect(transport.sent.some(item => item.message.type === 'mission:events:snapshot')).toBe(true);
  });

  it('reconnects a peer from its known contiguous cursor', () => {
    const transport = new FakeTransport();
    const events = [event(1), event(2), event(3)];
    new MissionEventReplicator(transport as never, 'local', {
      listMissions: () => ['mission-1'],
      getEvents: (_missionId, from, to) => events.filter(e => e.sequence >= from && (!to || e.sequence <= to)),
    });

    transport.emit('peer:connected', 'peer-a');
    const replay = transport.sent.find(item => item.message.type === 'mission:events');
    expect(replay?.message.payload.events.map((e: DistributedMissionEvent) => e.sequence)).toEqual([1, 2, 3]);
  });

  it('accepts a snapshot as the partition-recovery boundary', () => {
    const transport = new FakeTransport();
    let recovered = false;
    const replicator = new MissionEventReplicator(transport as never, 'local', {
      onSnapshot: snapshot => {
        recovered = snapshot.state.sequence === 10;
      },
    });

    transport.emit('message', {
      protocolVersion: 1,
      messageId: 'snapshot-1',
      timestamp: Date.now(),
      type: 'mission:events:snapshot',
      from: 'peer-a',
      to: 'local',
      payload: {
        missionId: 'mission-1',
        sourceNodeId: 'peer-a',
        snapshot: {
          state: { missionId: 'mission-1', graphVersion: 10, sequence: 10, tasks: [], assignments: [] },
          events: [],
        },
      },
      signature: 'test',
    });

    expect(recovered).toBe(true);
    expect(replicator.status('peer-a', 'mission-1').contiguousSequence).toBe(10);
    expect(transport.sent.some(item => item.message.type === 'mission:events:ack')).toBe(true);
  });
});

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TaskGraph } from '../mission/TaskGraph.js';
import { DistributedMissionCoordinator } from './DistributedMissionCoordinator.js';
import { DistributedMissionLedger } from './DistributedMissionLedger.js';
import {
  DistributedMissionStateIntegrityError,
  SqliteDistributedMissionStateStore,
} from './DistributedMissionStateStore.js';

function missionGraph() {
  const graph = new TaskGraph();
  graph.add({
    missionId: 'mission-durable',
    title: 'Build backend',
    description: 'Implement backend',
    requiredCapabilities: ['node'],
  });
  return graph;
}

function assignment(assignmentId = 'assignment-1') {
  const now = new Date().toISOString();
  return {
    assignmentId,
    missionId: 'mission-durable',
    taskId: 'task-durable',
    nodeId: 'node-a',
    state: 'OFFERED' as const,
    attempt: 1,
    branch: 'eamilos/mission/mission-durable/task/task-durable/attempt-1',
    createdAt: now,
    updatedAt: now,
  };
}

describe('Phase 7A durable distributed mission authority', () => {
  it('survives restart with mission graph, assignments, and event history intact', () => {
    const filename = '.eamilos-phase7a-' + randomUUID() + '.sqlite';
    const firstStore = new SqliteDistributedMissionStateStore({ filename });
    const firstGraph = missionGraph();
    const firstLedger = new DistributedMissionLedger('mission-durable', firstGraph, firstStore);

    firstLedger.sync();
    const task = firstGraph.all()[0];
    const now = new Date().toISOString();
    firstLedger.addAssignment({
      ...assignment(),
      taskId: task.id,
      createdAt: now,
      updatedAt: now,
    });

    const coordinator = new DistributedMissionCoordinator(firstLedger, firstGraph, () => [{
      nodeId: 'node-a',
      state: 'online',
      capabilities: ['node'],
      activeTasks: 0,
      maxConcurrentTasks: 1,
      lastSeenAt: Date.now(),
    }]);
    const assignmentId = firstLedger.listAssignments()[0].assignmentId;
    coordinator.claim(assignmentId, 'lease-1', new Date(Date.now() + 60_000).toISOString());

    const beforeRestart = firstLedger.snapshot();
    expect(beforeRestart.tasks[0].state).toBe('CLAIMED');
    expect(beforeRestart.assignments[0].state).toBe('LEASED');

    firstStore.close();

    const secondStore = new SqliteDistributedMissionStateStore({ filename });
    const restored = DistributedMissionLedger.restore('mission-durable', secondStore);

    expect(restored.graphVersion).toBe(beforeRestart.graphVersion + 1);
    expect(restored.tasks()[0].state).toBe('CLAIMED');
    expect(restored.listAssignments()[0].state).toBe('LEASED');
    expect(restored.eventsSince(0)).toHaveLength(beforeRestart.events.length);
    expect(secondStore.verify('mission-durable').valid).toBe(true);

    secondStore.close();
    const cleanup = new Database(filename);
    cleanup.close();
  });

  it('reconstructs the authoritative state from the latest event rather than trusting the snapshot cache', () => {
    const filename = '.eamilos-phase7a-' + randomUUID() + '.sqlite';
    const store = new SqliteDistributedMissionStateStore({ filename });
    const graph = missionGraph();
    const ledger = new DistributedMissionLedger('mission-durable', graph, store);
    ledger.sync();

    const stateBefore = ledger.snapshot();
    const task = graph.all()[0];
    ledger.addAssignment({
      ...assignment(),
      taskId: task.id,
      createdAt: stateBefore.events[0].timestamp,
      updatedAt: stateBefore.events[0].timestamp,
    });

    const db = new Database(filename);
    db.prepare(
      'UPDATE eamilos_distributed_mission_snapshots SET state_json = ?, state_hash = ? WHERE mission_id = ?',
    ).run(JSON.stringify({
      missionId: 'mission-durable',
      graphVersion: 999,
      sequence: 999,
      tasks: [],
      assignments: [],
    }), 'invalid', 'mission-durable');
    db.close();

    expect(() => store.load('mission-durable')).toThrow(DistributedMissionStateIntegrityError);
    store.close();
  });

  it('detects tampering in the hash-chained event log', () => {
    const filename = '.eamilos-phase7a-' + randomUUID() + '.sqlite';
    const store = new SqliteDistributedMissionStateStore({ filename });
    const ledger = new DistributedMissionLedger('mission-durable', missionGraph(), store);
    ledger.sync();

    const db = new Database(filename);
    db.prepare(
      'UPDATE eamilos_distributed_mission_events SET data_json = ? WHERE mission_id = ? AND sequence = 1',
    ).run(JSON.stringify({ taskCount: 999, state: {} }), 'mission-durable');
    db.close();

    expect(() => store.verify('mission-durable')).toThrow(/EVENT_HASH_MISMATCH/);
    store.close();
  });

  it('rejects restoring a mission whose persisted state belongs to another mission', () => {
    const filename = '.eamilos-phase7a-' + randomUUID() + '.sqlite';
    const store = new SqliteDistributedMissionStateStore({ filename });
    const ledger = new DistributedMissionLedger('mission-durable', missionGraph(), store);
    ledger.sync();
    store.close();

    const reopened = new SqliteDistributedMissionStateStore({ filename });
    expect(() => DistributedMissionLedger.restore('different-mission', reopened))
      .toThrow('DISTRIBUTED_MISSION_NOT_FOUND:different-mission');
    reopened.close();
  });
});

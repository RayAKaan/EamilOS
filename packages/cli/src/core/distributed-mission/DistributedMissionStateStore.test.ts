import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TaskGraph } from '../mission/TaskGraph.js';
import { DistributedMissionCoordinator } from './DistributedMissionCoordinator.js';
import { DistributedMissionLedger } from './DistributedMissionLedger.js';
import { SqliteDistributedMissionStateStore } from './DistributedMissionStateStore.js';

function filename(): string {
  return join(tmpdir(), 'eamilos-phase7a-' + randomUUID() + '.sqlite');
}

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

function cleanup(path: string): void {
  rmSync(path, { force: true });
  rmSync(path + '-wal', { force: true });
  rmSync(path + '-shm', { force: true });
}

describe('Phase 7A durable distributed mission authority', () => {
  it('survives restart with mission graph, assignments, and event history intact', () => {
    const path = filename();
    const firstStore = new SqliteDistributedMissionStateStore({ filename: path });
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

    const secondStore = new SqliteDistributedMissionStateStore({ filename: path });
    const restored = DistributedMissionLedger.restore('mission-durable', secondStore);

    expect(restored.graphVersion).toBe(beforeRestart.graphVersion);
    expect(restored.tasks()[0].state).toBe('CLAIMED');
    expect(restored.listAssignments()[0].state).toBe('LEASED');
    expect(restored.eventsSince(0)).toHaveLength(beforeRestart.events.length);
    expect(secondStore.verify('mission-durable').valid).toBe(true);

    secondStore.close();
    cleanup(path);
  });

  it('reconstructs authoritative state from the event log when the snapshot cache is corrupted', () => {
    const path = filename();
    const store = new SqliteDistributedMissionStateStore({ filename: path });
    const graph = missionGraph();
    const ledger = new DistributedMissionLedger('mission-durable', graph, store);
    ledger.sync();

    const task = graph.all()[0];
    ledger.addAssignment({
      ...assignment(),
      taskId: task.id,
    });

    const db = new Database(path);
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

    const restored = DistributedMissionLedger.restore('mission-durable', store);
    expect(restored.tasks()).toHaveLength(1);
    expect(restored.listAssignments()).toHaveLength(1);
    expect(restored.listAssignments()[0].taskId).toBe(task.id);

    store.close();
    cleanup(path);
  });

  it('detects tampering in the hash-chained event log', () => {
    const path = filename();
    const store = new SqliteDistributedMissionStateStore({ filename: path });
    const ledger = new DistributedMissionLedger('mission-durable', missionGraph(), store);
    ledger.sync();

    const db = new Database(path);
    db.prepare(
      'UPDATE eamilos_distributed_mission_events SET data_json = ? WHERE mission_id = ? AND sequence = 1',
    ).run(JSON.stringify({ taskCount: 999, state: {} }), 'mission-durable');
    db.close();

    expect(() => store.verify('mission-durable')).toThrow(/EVENT_HASH_MISMATCH/);
    store.close();
    cleanup(path);
  });

  it('rejects restoring a mission that has no durable event history', () => {
    const path = filename();
    const store = new SqliteDistributedMissionStateStore({ filename: path });

    expect(() => DistributedMissionLedger.restore('missing-mission', store))
      .toThrow('DISTRIBUTED_MISSION_NOT_FOUND:missing-mission');

    store.close();
    cleanup(path);
  });
});

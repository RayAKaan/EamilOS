import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MissionEngine } from './MissionEngine.js';
import { MissionStore } from './MissionStore.js';
import { TaskGraph } from './TaskGraph.js';
import { GraphScheduler } from './GraphScheduler.js';

function tempStore(): MissionStore {
  return new MissionStore(mkdtempSync(join(tmpdir(), 'eamilos-phase1-')));
}

describe('Phase 1 mission runtime', () => {
  it('creates a persistent mission and task graph', () => {
    const store = tempStore();
    const engine = new MissionEngine(store);
    const mission = engine.createMission({
      id: 'mission_test',
      goal: 'Build authentication',
      workingDir: '/tmp/project',
      requirements: { acceptanceCriteria: ['login works'] },
    });

    const root = engine.addTask(mission.id, {
      id: 'task_db',
      title: 'Create database',
      description: 'Create the authentication schema',
    });
    const api = engine.addTask(mission.id, {
      id: 'task_api',
      title: 'Create API',
      description: 'Implement authentication endpoints',
      dependencies: [root.id],
    });

    expect(root.state).toBe('READY');
    expect(api.state).toBe('PENDING');

    const reloaded = new MissionEngine(store).snapshot(mission.id);
    expect(reloaded.tasks.map((t) => t.id)).toEqual(['task_db', 'task_api']);
    expect(reloaded.events.some((e) => e.type === 'TASK_READY' && e.taskId === 'task_db')).toBe(true);
  });

  it('rejects dependency cycles', () => {
    const now = new Date().toISOString();
    const a = {
      id: 'a', missionId: 'm', title: 'A', description: 'A', state: 'PENDING' as const,
      priority: 'MEDIUM' as const, dependencies: ['b'], requiredCapabilities: [],
      acceptanceCriteria: [], inputs: {}, outputs: {}, artifacts: [], evidenceIds: [],
      attempt: 0, maxAttempts: 3, idempotencyKey: 'm:a', createdAt: now, updatedAt: now,
    };
    const b = {
      id: 'b', missionId: 'm', title: 'B', description: 'B', state: 'PENDING' as const,
      priority: 'MEDIUM' as const, dependencies: ['a'], requiredCapabilities: [],
      acceptanceCriteria: [], inputs: {}, outputs: {}, artifacts: [], evidenceIds: [],
      attempt: 0, maxAttempts: 3, idempotencyKey: 'm:b', createdAt: now, updatedAt: now,
    };
    expect(() => new TaskGraph([a, b])).toThrow(/cycle/i);
  });

  it('enforces leases and recovers expired work', () => {
    const store = tempStore();
    const engine = new MissionEngine(store);
    const mission = engine.createMission({ id: 'lease_mission', goal: 'Lease test', workingDir: '/tmp/project' });
    engine.addTask(mission.id, {
      id: 'lease_task',
      title: 'Leased task',
      description: 'Test leasing',
    });

    const lease = engine.acquireLease(mission.id, 'lease_task', 'worker-a', 10);
    expect(engine.snapshot(mission.id).tasks[0].state).toBe('CLAIMED');

    const expired = engine.expireLeases(mission.id, Date.parse(lease.expiresAt) + 1);
    expect(expired).toEqual(['lease_task']);
    expect(engine.snapshot(mission.id).tasks[0].state).toBe('RECOVERABLE');
  });

  it('only completes after terminal tasks and required evidence exist', () => {
    const store = tempStore();
    const engine = new MissionEngine(store);
    const mission = engine.createMission({
      id: 'completion_mission',
      goal: 'Complete a task',
      workingDir: '/tmp/project',
      requirements: {
        completionCriteria: [{
          id: 'tests',
          description: 'Tests pass',
          required: true,
          evidenceTypes: ['test'],
        }],
      },
    });
    engine.addTask(mission.id, {
      id: 'task_1',
      title: 'Implementation',
      description: 'Implement it',
    });

    engine.transitionTask(mission.id, 'task_1', 'CLAIMED');
    engine.transitionTask(mission.id, 'task_1', 'RUNNING');
    engine.transitionTask(mission.id, 'task_1', 'VALIDATING');
    engine.transitionTask(mission.id, 'task_1', 'COMPLETED');

    expect(engine.evaluateCompletion(mission.id).complete).toBe(false);

    engine.recordEvidence(mission.id, {
      id: 'evidence_tests',
      type: 'test',
      description: 'Unit tests pass',
      reference: 'vitest',
      passed: true,
      metadata: {},
    });

    expect(engine.evaluateCompletion(mission.id).complete).toBe(true);
    expect(engine.snapshot(mission.id).mission.status).toBe('completed');
  });

  it('deduplicates task creation by idempotency key', () => {
    const store = tempStore();
    const engine = new MissionEngine(store);
    const mission = engine.createMission({ id: 'idem_mission', goal: 'Idempotency', workingDir: '/tmp/project' });
    const first = engine.addTask(mission.id, {
      title: 'Same task',
      description: 'First submission',
      idempotencyKey: 'idem-1',
    });
    const second = engine.addTask(mission.id, {
      title: 'Same task',
      description: 'Duplicate submission',
      idempotencyKey: 'idem-1',
    });
    expect(second.id).toBe(first.id);
    expect(engine.snapshot(mission.id).tasks).toHaveLength(1);
  });

  it('schedules ready work by dependency and priority', () => {
    const store = tempStore();
    const engine = new MissionEngine(store);
    const mission = engine.createMission({
      id: 'schedule_mission',
      goal: 'Schedule',
      workingDir: '/tmp/project',
      constraints: { maxConcurrentTasks: 1 },
    });
    engine.addTask(mission.id, { id: 'low', title: 'Low', description: 'Low', priority: 'LOW' });
    engine.addTask(mission.id, { id: 'high', title: 'High', description: 'High', priority: 'HIGH' });
    const snapshot = engine.snapshot(mission.id);
    const plan = new GraphScheduler(snapshot.mission.constraints).plan(new TaskGraph(snapshot.tasks));
    expect(plan.ready.map((task) => task.id)).toEqual(['high']);
    expect(plan.availableSlots).toBe(1);
  });

  it('lists persisted missions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eamilos-list-'));
    const store = new MissionStore(dir);
    const engine = new MissionEngine(store);
    engine.createMission({ id: 'one', goal: 'One', workingDir: dir });
    engine.createMission({ id: 'two', goal: 'Two', workingDir: dir });
    expect(store.list().map((m) => m.id).sort()).toEqual(['one', 'two']);
    rmSync(dir, { recursive: true, force: true });
  });
});

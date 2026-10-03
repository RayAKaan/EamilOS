import { describe, expect, it, vi } from 'vitest';
import { InMemoryPtyBackend, EamilosPtyManager } from './PtyManager.js';
import { SchedulerPtyDispatcher, ptySessionIdForExecution } from './SchedulerPtyDispatcher.js';
import type { FleetWorker } from '../comms/a2a/EamilosFleetRegistry.js';
import type { ScheduleDecision, SchedulingCandidate } from '../scheduler/GlobalSchedulerTypes.js';

const worker: FleetWorker = {
  workerId: 'worker-1', agentId: 'agent-1', harnessId: 'harness-1',
  name: 'worker', description: 'worker', endpoint: 'http://localhost',
  capabilities: ['shell'], maxConcurrency: 1, activeExecutions: 0, capacity: 1,
  streaming: true, checkpointResume: true, authentication: [], metadata: {},
  status: 'online', advertisedAt: '2026-10-03T00:00:00.000Z',
  lastHeartbeatAt: '2026-10-03T00:00:00.000Z', heartbeatSequence: 1,
  revision: 1, updatedAt: '2026-10-03T00:00:00.000Z',
};

const decision: ScheduleDecision = {
  decisionId: 'decision-1', idempotencyKey: 'key-1', schedulerRevision: 1,
  missionId: 'mission-1', taskId: 'task-1', executionId: 'exec-1',
  workerId: 'worker-1', agentId: 'agent-1', harnessId: 'harness-1',
  priority: 'HIGH', fencingToken: 7, leaseId: 'lease-1', state: 'scheduled',
  createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z',
};

const candidate: SchedulingCandidate = {
  missionId: 'mission-1', taskId: 'task-1',
  task: {
    id: 'task-1', missionId: 'mission-1', title: 'run', description: 'run',
    state: 'READY', priority: 'HIGH', dependencies: [], requiredCapabilities: ['shell'],
    acceptanceCriteria: [], inputs: { command: 'agent', args: ['--run'] }, outputs: {},
    artifacts: [], evidenceIds: [], attempt: 0, maxAttempts: 3, idempotencyKey: 'task-key',
    createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z',
  },
  missionCreatedAt: '2026-10-03T00:00:00.000Z', priorityRank: 1,
  requiredCapabilities: ['shell'], resources: { readSet: [], writeSet: [] },
};

describe('SchedulerPtyDispatcher', () => {
  it('creates a PTY from a scheduler decision and returns without waiting for exit', async () => {
    const manager = new EamilosPtyManager(new InMemoryPtyBackend());
    const started = vi.fn();
    const complete = vi.fn();
    const dispatcher = new SchedulerPtyDispatcher({ pty: manager, onStarted: started }, complete);

    await dispatcher.dispatch(decision, candidate, worker);

    expect(manager.get(ptySessionIdForExecution('exec-1'))?.state).toBe('running');
    expect(started).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
    dispatcher.close();
    manager.close();
  });

  it('completes the scheduler execution when the PTY exits', async () => {
    const backend = new InMemoryPtyBackend();
    const manager = new EamilosPtyManager(backend);
    const complete = vi.fn();
    const dispatcher = new SchedulerPtyDispatcher({ pty: manager }, complete);

    await dispatcher.dispatch(decision, candidate, worker);
    backend.exit(ptySessionIdForExecution('exec-1'), 0);

    expect(complete).toHaveBeenCalledWith('exec-1', 'completed');
    dispatcher.close();
    manager.close();
  });

  it('translates a failed or terminated PTY into scheduler terminal state', async () => {
    const backend = new InMemoryPtyBackend();
    const manager = new EamilosPtyManager(backend);
    const complete = vi.fn();
    const dispatcher = new SchedulerPtyDispatcher({ pty: manager }, complete);

    await dispatcher.dispatch(decision, candidate, worker);
    backend.exit(ptySessionIdForExecution('exec-1'), 17, 'SIGTERM');
    expect(complete).toHaveBeenCalledWith('exec-1', 'failed');

    dispatcher.close();
    manager.close();
  });
});

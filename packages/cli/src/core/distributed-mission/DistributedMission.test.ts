import { describe, expect, it } from 'vitest';
import { TaskGraph } from '../mission/TaskGraph.js';
import { DistributedMissionLedger } from './DistributedMissionLedger.js';
import { DistributedMissionCoordinator } from './DistributedMissionCoordinator.js';
import { GitWorkspaceCoordinator } from './GitWorkspaceCoordinator.js';

function setup() {
  const graph = new TaskGraph();
  const first = graph.add({
    missionId: 'mission-1',
    title: 'Build backend',
    description: 'Implement backend',
    requiredCapabilities: ['node', 'git'],
  });
  const second = graph.add({
    missionId: 'mission-1',
    title: 'Build frontend',
    description: 'Implement frontend',
    dependencies: [first.id],
    requiredCapabilities: ['node', 'git'],
  });
  const ledger = new DistributedMissionLedger('mission-1', graph);
  const nodes = [
    {
      nodeId: 'node-a',
      state: 'online' as const,
      capabilities: ['node', 'git'],
      activeTasks: 0,
      maxConcurrentTasks: 2,
      lastSeenAt: Date.now(),
    },
    {
      nodeId: 'node-b',
      state: 'online' as const,
      capabilities: ['node', 'git', 'gpu'],
      activeTasks: 1,
      maxConcurrentTasks: 2,
      lastSeenAt: Date.now(),
    },
  ];
  return { graph, first, second, ledger, nodes };
}

describe('Phase 7 distributed mission fabric', () => {
  it('creates one global ledger with versioned assignment state', () => {
    const { ledger, nodes } = setup();
    const event = ledger.sync();
    expect(event.type).toBe('MISSION_SYNCED');
    expect(ledger.graphVersion).toBeGreaterThan(0);
    expect(ledger.snapshot(nodes).tasks).toHaveLength(2);
  });

  it('assigns ready work to a capable node deterministically', () => {
    const { graph, ledger, nodes, first } = setup();
    const coordinator = new DistributedMissionCoordinator(ledger, graph, () => nodes);
    const [assignmentId] = coordinator.scheduleReady();
    expect(assignmentId).toBeDefined();
    const assignment = ledger.getAssignment(assignmentId);
    expect(assignment?.taskId).toBe(first.id);
    expect(assignment?.nodeId).toBe('node-a');
    expect(assignment?.branch).toBe(`eamilos/mission/mission-1/task/${first.id}/attempt-1`);
  });

  it('does not assign a task to a node without required capabilities', () => {
    const { graph, ledger, nodes, first } = setup();
    nodes[0].capabilities = ['git'];
    nodes[1].capabilities = ['gpu'];
    const coordinator = new DistributedMissionCoordinator(ledger, graph, () => nodes);
    expect(coordinator.scheduleReady()).toEqual([]);
    expect(ledger.getTaskAssignment(first.id)).toBeUndefined();
  });

  it('requeues leased work when its node disappears', () => {
    const { graph, ledger, nodes, first } = setup();
    const coordinator = new DistributedMissionCoordinator(ledger, graph, () => nodes);
    const [assignmentId] = coordinator.scheduleReady();
    coordinator.claim(assignmentId, 'lease-1', new Date(Date.now() + 60_000).toISOString());
    coordinator.start(assignmentId);
    expect(coordinator.nodeLost('node-a')).toEqual([first.id]);
    expect(ledger.getAssignment(assignmentId)?.state).toBe('REQUEUED');
    expect(ledger.eventsSince(0).some((event) => event.type === 'TASK_REQUEUED')).toBe(true);
  });

  it('expires leases and makes the work eligible for rescheduling', () => {
    const { graph, ledger, nodes, first } = setup();
    const coordinator = new DistributedMissionCoordinator(ledger, graph, () => nodes);
    const [assignmentId] = coordinator.scheduleReady();
    coordinator.claim(assignmentId, 'lease-1', new Date(Date.now() + 60_000).toISOString());
    expect(coordinator.expireLeases(Date.now() + 61_000)).toEqual([first.id]);
    expect(ledger.getAssignment(assignmentId)?.state).toBe('REQUEUED');
  });

  it('creates isolated Git branches/worktrees per task attempt', () => {
    const git = new GitWorkspaceCoordinator({ baseRef: 'main', worktreeRoot: '/tmp/eamilos' });
    const workspace = git.allocate('mission-1', 'task-7', 'node-a', 2);
    expect(workspace.branch).toBe('eamilos/mission/mission-1/task/task-7/attempt-2');
    expect(workspace.worktreePath).toBe('/tmp/eamilos/task-7/attempt-2');
    expect(git.markReadyForIntegration(git.markActive(workspace)).status).toBe('ready_for_integration');
  });

  it('rejects stale optimistic writes', () => {
    const { ledger } = setup();
    const version = ledger.graphVersion;
    ledger.sync();
    expect(() => ledger.addAssignment({
      assignmentId: 'assignment-1',
      missionId: 'mission-1',
      taskId: 'task-missing',
      nodeId: 'node-a',
      state: 'OFFERED',
      attempt: 1,
      branch: 'eamilos/mission/mission-1/task/task-missing/attempt-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, version)).toThrow(/Stale distributed mission version/);
  });
  it('fences stale worker results after a task is requeued and reassigned', () => {
    const { graph, ledger, nodes, first } = setup();
    const coordinator = new DistributedMissionCoordinator(ledger, graph, () => nodes);

    const [firstAssignmentId] = coordinator.scheduleReady();
    const firstAssignment = ledger.getAssignment(firstAssignmentId)!;
    coordinator.claim(firstAssignmentId, 'lease-1', new Date(Date.now() + 60_000).toISOString());
    coordinator.start(firstAssignmentId);
    expect(graph.get(first.id)?.attempt).toBe(firstAssignment.attempt);

    coordinator.nodeLost(firstAssignment.nodeId);
    const [secondAssignmentId] = coordinator.scheduleReady();
    const secondAssignment = ledger.getAssignment(secondAssignmentId)!;
    expect(secondAssignment.assignmentId).not.toBe(firstAssignment.assignmentId);
    expect(secondAssignment.attempt).toBe(firstAssignment.attempt + 1);
    expect(secondAssignment.fencingToken).toBeGreaterThan(firstAssignment.fencingToken ?? 0);

    coordinator.claim(secondAssignmentId, 'lease-2', new Date(Date.now() + 60_000).toISOString());
    coordinator.start(secondAssignmentId);

    expect(() => coordinator.complete({
      taskId: first.id,
      assignmentId: firstAssignment.assignmentId,
      nodeId: firstAssignment.nodeId,
      attempt: firstAssignment.attempt,
      fencingToken: firstAssignment.fencingToken!,
      success: true,
      state: 'COMPLETED',
    })).toThrow('STALE_TASK_RESULT');

    coordinator.complete({
      taskId: first.id,
      assignmentId: secondAssignment.assignmentId,
      nodeId: secondAssignment.nodeId,
      attempt: secondAssignment.attempt,
      fencingToken: secondAssignment.fencingToken!,
      success: true,
      state: 'COMPLETED',
    });

    expect(ledger.getAssignment(secondAssignmentId)?.state).toBe('COMPLETED');
  });

  it('invalidates task ownership when its lease expires', () => {
    const { graph, ledger, nodes, first } = setup();
    const coordinator = new DistributedMissionCoordinator(ledger, graph, () => nodes);
    const [assignmentId] = coordinator.scheduleReady();
    const assignment = ledger.getAssignment(assignmentId)!;

    coordinator.claim(assignmentId, 'lease-expired', new Date(Date.now() + 60_000).toISOString());
    coordinator.start(assignmentId);

    expect(coordinator.expireLeases(Date.now() + 61_000)).toEqual([first.id]);
    expect(graph.get(first.id)?.state).toBe('RECOVERABLE');
    expect(graph.get(first.id)?.owner).toBeUndefined();
    expect(graph.get(first.id)?.leaseId).toBeUndefined();
    expect(ledger.getAssignment(assignmentId)?.state).toBe('REQUEUED');
  });

});

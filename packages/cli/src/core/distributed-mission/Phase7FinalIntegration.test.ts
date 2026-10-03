import { describe, expect, it } from 'vitest';
import { TaskGraph } from '../mission/TaskGraph.js';
import { DistributedMissionLedger } from './DistributedMissionLedger.js';
import { DistributedMissionCoordinator } from './DistributedMissionCoordinator.js';
import { GitWorkspaceCoordinator, type GitOperations } from './GitWorkspaceCoordinator.js';

function makeOperations(): GitOperations {
  return {
    async inspectCommit(commit) {
      return { commit, branch: commit, files: [commit + '.ts'], parent: 'base' };
    },
    async merge(_base, commit) { return { commit: 'merged-' + commit }; },
    async abortMerge() {},
    async removeWorktree() {},
  };
}

describe('Phase 7 final distributed mission path', () => {
  it('schedules, owns, completes, and integrates a task with durable mission events', async () => {
    const graph = new TaskGraph();
    const task = graph.add({
      missionId: 'mission-final',
      title: 'final task',
      description: 'final task',
      requiredCapabilities: ['node'],
    });
    const ledger = new DistributedMissionLedger('mission-final', graph);
    const nodes = [{
      nodeId: 'node-a',
      state: 'online' as const,
      capabilities: ['node'],
      activeTasks: 0,
      maxConcurrentTasks: 1,
      lastSeenAt: Date.now(),
    }];
    const coordinator = new DistributedMissionCoordinator(ledger, graph, () => nodes);
    const [assignmentId] = coordinator.scheduleReady();
    const assignment = ledger.getAssignment(assignmentId)!;

    coordinator.claim(assignmentId, 'lease-final', new Date(Date.now() + 60_000).toISOString());
    coordinator.start(assignmentId);
    coordinator.complete({
      taskId: task.id,
      assignmentId,
      attempt: assignment.attempt,
      fencingToken: assignment.fencingToken!,
      nodeId: assignment.nodeId,
      success: true,
      state: 'COMPLETED',
      commit: 'commit-final',
    });

    const workspace = coordinator.git.markReadyForIntegration(
      coordinator.git.markActive(
        coordinator.git.allocate('mission-final', task.id, 'node-a', assignment.attempt),
      ),
    );
    const result = await coordinator.integrateReadyWorkspaces([workspace], makeOperations());

    expect(result.integrated).toHaveLength(1);
    expect(result.integrated[0].status).toBe('integrated');
    expect(result.conflicts).toEqual([]);
    expect(ledger.eventsSince(0).some(e => e.type === 'GIT_INTEGRATED')).toBe(true);
    expect(ledger.getAssignment(assignmentId)?.state).toBe('COMPLETED');
  });

  it('keeps conflicting completed work out of integration and records evidence', async () => {
    const graph = new TaskGraph();
    const first = graph.add({ missionId: 'm', title: 'a', description: 'a', requiredCapabilities: [] });
    const second = graph.add({ missionId: 'm', title: 'b', description: 'b', requiredCapabilities: [] });
    const ledger = new DistributedMissionLedger('m', graph);
    const nodes = [
      { nodeId: 'a', state: 'online' as const, capabilities: [], activeTasks: 0, maxConcurrentTasks: 1, lastSeenAt: Date.now() },
      { nodeId: 'b', state: 'online' as const, capabilities: [], activeTasks: 0, maxConcurrentTasks: 1, lastSeenAt: Date.now() },
    ];
    const coordinator = new DistributedMissionCoordinator(ledger, graph, () => nodes);
    const makeWorkspace = (taskId: string, nodeId: string) =>
      coordinator.git.markReadyForIntegration(
        coordinator.git.markActive(coordinator.git.allocate('m', taskId, nodeId, 1)),
      );

    const result = await coordinator.integrateReadyWorkspaces(
      [makeWorkspace(second.id, 'b'), makeWorkspace(first.id, 'a')],
      {
        ...makeOperations(),
        async inspectCommit(commit) { return { commit, branch: commit, files: ['shared.ts'] }; },
      },
    );

    expect(result.integrated).toEqual([]);
    expect(result.conflicts[0].reason).toBe('overlapping_files');
    expect(ledger.eventsSince(0).some(e => e.type === 'GIT_CONFLICT_DETECTED')).toBe(true);
  });
});

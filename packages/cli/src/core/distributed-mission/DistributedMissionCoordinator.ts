import type { TaskGraph } from '../mission/TaskGraph.js';
import type { DistributedMissionLedger } from './DistributedMissionLedger.js';
import type { DistributedNodeView, DistributedTaskResult } from './types.js';
import { DistributedTaskScheduler } from './DistributedTaskScheduler.js';
import { GitWorkspaceCoordinator } from './GitWorkspaceCoordinator.js';

export class DistributedMissionCoordinator {
  readonly scheduler: DistributedTaskScheduler;
  readonly git: GitWorkspaceCoordinator;

  constructor(
    private readonly ledger: DistributedMissionLedger,
    graph: TaskGraph,
    private readonly nodes: () => DistributedNodeView[],
    git: GitWorkspaceCoordinator = new GitWorkspaceCoordinator(),
  ) {
    this.scheduler = new DistributedTaskScheduler(ledger, graph, nodes);
    this.git = git;
  }

  scheduleReady(preferredNodeByTask = new Map<string, string>()): string[] {
    const scheduled: string[] = [];
    for (const task of this.ledger.tasks()) {
      if (!['READY', 'RECOVERABLE'].includes(task.state)) continue;
      if (this.ledger.getTaskAssignment(task.id)) continue;
      try {
        const assignment = this.scheduler.assign(task.id, preferredNodeByTask.get(task.id));
        scheduled.push(assignment.assignmentId);
      } catch {
        // A task can remain globally ready while no capable node is currently available.
      }
    }
    return scheduled;
  }

  claim(assignmentId: string, leaseId: string, leaseExpiresAt: string): void {
    const assignment = this.ledger.getAssignment(assignmentId);
    if (!assignment) throw new Error('Assignment not found: ' + assignmentId);
    if (assignment.state !== 'OFFERED') throw new Error('Assignment is not claimable: ' + assignment.state);

    const task = this.scheduler.graph.get(assignment.taskId);
    if (task) {
      task.owner = assignment.nodeId;
      task.leaseId = leaseId;
      task.leaseExpiresAt = leaseExpiresAt;
      if (task.state === 'READY' || task.state === 'RECOVERABLE') {
        this.scheduler.graph.transition(task.id, 'CLAIMED');
      }
    }

    this.ledger.updateAssignment(assignmentId, 'LEASED', { leaseId, leaseExpiresAt });
  }

  start(assignmentId: string): void {
    const assignment = this.requireActive(assignmentId);
    const task = this.scheduler.graph.get(assignment.taskId);
    if (task?.state === 'CLAIMED') {
      this.scheduler.graph.transition(task.id, 'RUNNING');
    }
    this.ledger.updateAssignment(assignmentId, 'RUNNING');
    this.ledger.append('TASK_ASSIGNED', assignment.taskId, assignment.nodeId, {
      assignmentId,
      state: 'RUNNING',
    });
  }

  checkpoint(assignmentId: string, checkpointId: string): void {
    const assignment = this.requireActive(assignmentId);
    this.ledger.updateAssignment(assignmentId, 'CHECKPOINTED', { updatedAt: new Date().toISOString() });
    this.ledger.append('TASK_CHECKPOINTED', assignment.taskId, assignment.nodeId, { assignmentId, checkpointId });
  }

  complete(result: DistributedTaskResult): void {
    const assignment = this.ledger.getTaskAssignment(result.taskId);
    if (!assignment || assignment.nodeId !== result.nodeId) {
      throw new Error('No active assignment for task ' + result.taskId + ' on node ' + result.nodeId);
    }

    const task = this.scheduler.graph.get(result.taskId);

    if (!result.success) {
      if (task && ['RUNNING', 'CHECKPOINTED', 'VALIDATING'].includes(task.state)) {
        this.scheduler.graph.transition(task.id, 'RECOVERABLE');
      }
      this.ledger.updateAssignment(assignment.assignmentId, 'FAILED', { updatedAt: new Date().toISOString() });
      this.ledger.append('TASK_FAILED', result.taskId, result.nodeId, { error: result.error });
      return;
    }

    if (task && ['RUNNING', 'CHECKPOINTED'].includes(task.state)) {
      this.scheduler.graph.transition(task.id, 'VALIDATING');
    }
    this.ledger.updateAssignment(assignment.assignmentId, 'COMPLETED', {
      updatedAt: new Date().toISOString(),
    });
    this.ledger.append('TASK_COMPLETED', result.taskId, result.nodeId, {
      artifacts: result.artifacts ?? [],
      commit: result.commit,
    });
  }

  nodeLost(nodeId: string): string[] {
    const affected = this.ledger.listAssignments().filter(
      (assignment) =>
        assignment.nodeId === nodeId &&
        !['COMPLETED', 'FAILED', 'REJECTED'].includes(assignment.state),
    );

    for (const assignment of affected) {
      const task = this.scheduler.graph.get(assignment.taskId);
      if (task) {
        task.owner = undefined;
        task.leaseId = undefined;
        task.leaseExpiresAt = undefined;
        if (['CLAIMED', 'RUNNING', 'CHECKPOINTED'].includes(task.state)) {
          this.scheduler.graph.transition(task.id, 'RECOVERABLE');
        }
      }

      this.ledger.updateAssignment(assignment.assignmentId, 'REQUEUED');
      this.ledger.append('NODE_LOST', assignment.taskId, nodeId, {
        assignmentId: assignment.assignmentId,
      });
      this.ledger.append('TASK_REQUEUED', assignment.taskId, undefined, {
        assignmentId: assignment.assignmentId,
      });
    }
    return affected.map((assignment) => assignment.taskId);
  }

  expireLeases(now = Date.now()): string[] {
    const expired = this.ledger.listAssignments().filter(
      (assignment) =>
        assignment.leaseExpiresAt &&
        Date.parse(assignment.leaseExpiresAt) <= now &&
        !['COMPLETED', 'FAILED', 'REJECTED', 'REQUEUED'].includes(assignment.state),
    );

    for (const assignment of expired) {
      this.ledger.updateAssignment(assignment.assignmentId, 'REQUEUED');
      this.ledger.append('LEASE_EXPIRED', assignment.taskId, assignment.nodeId, {
        assignmentId: assignment.assignmentId,
      });
      this.ledger.append('TASK_REQUEUED', assignment.taskId, undefined, {
        assignmentId: assignment.assignmentId,
      });
    }
    return expired.map((assignment) => assignment.taskId);
  }

  private requireActive(assignmentId: string) {
    const assignment = this.ledger.getAssignment(assignmentId);
    if (!assignment) throw new Error('Assignment not found: ' + assignmentId);
    if (!['LEASED', 'RUNNING', 'CHECKPOINTED'].includes(assignment.state)) {
      throw new Error('Assignment is not active: ' + assignment.state);
    }
    return assignment;
  }
}

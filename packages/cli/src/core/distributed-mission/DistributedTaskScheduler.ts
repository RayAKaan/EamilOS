import { randomUUID } from 'crypto';
import type { TaskGraph } from '../mission/TaskGraph.js';
import type { TaskNode } from '../mission/types.js';
import type { DistributedMissionLedger } from './DistributedMissionLedger.js';
import type {
  DistributedAssignment,
  DistributedNodeView,
  TaskAssignmentCandidate
} from './types.js';

export interface DistributedSchedulerOptions {
  leaseTtlMs?: number;
}

export class DistributedTaskScheduler {
  constructor(
    private readonly ledger: DistributedMissionLedger,
    private readonly graph: TaskGraph,
    private readonly nodes: () => DistributedNodeView[],
    private readonly options: DistributedSchedulerOptions = {},
  ) {}

  candidates(task: TaskNode): TaskAssignmentCandidate[] {
    const required = new Set(task.requiredCapabilities);
    return this.nodes()
      .filter((node) => node.state === 'online')
      .filter((node) => node.activeTasks < node.maxConcurrentTasks)
      .filter((node) => [...required].every((capability) => node.capabilities.includes(capability)))
      .map((node) => {
        const freeSlots = node.maxConcurrentTasks - node.activeTasks;
        const score = freeSlots * 100 - node.activeTasks;
        return { nodeId: node.nodeId, score, reason: `${freeSlots} free task slot(s)` };
      })
      .sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId));
  }

  assign(taskId: string, preferredNodeId?: string): DistributedAssignment {
    const task = this.graph.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (task.state !== 'READY' && task.state !== 'RECOVERABLE') {
      throw new Error(`Task ${taskId} is not ready for distributed assignment: ${task.state}`);
    }
    if (this.ledger.getTaskAssignment(taskId)) {
      throw new Error(`Task ${taskId} already has an active distributed assignment`);
    }

    const candidates = this.candidates(task);
    if (preferredNodeId) {
      const preferred = candidates.find((candidate) => candidate.nodeId === preferredNodeId);
      if (!preferred) throw new Error(`Preferred node cannot execute task ${taskId}: ${preferredNodeId}`);
      candidates.splice(0, candidates.length, preferred, ...candidates.filter((candidate) => candidate.nodeId !== preferredNodeId));
    }
    const candidate = candidates[0];
    if (!candidate) throw new Error(`No capable EamilOS node is available for task ${taskId}`);

    const now = new Date();
    const branch = `eamilos/mission/${task.missionId}/task/${task.id}/attempt-${task.attempt + 1}`;
    const assignment: DistributedAssignment = {
      assignmentId: `assignment_${randomUUID()}`,
      missionId: task.missionId,
      taskId: task.id,
      nodeId: candidate.nodeId,
      state: 'OFFERED',
      attempt: task.attempt + 1,
      branch,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.ledger.addAssignment(assignment);
    this.ledger.append('TASK_OFFERED', task.id, candidate.nodeId, {
      assignmentId: assignment.assignmentId,
      branch,
      requiredCapabilities: task.requiredCapabilities,
    });
    return assignment;
  }
}

import type { MissionConstraints, TaskNode, TaskPriority } from './types.js';
import { TaskGraph } from './TaskGraph.js';

const priorityWeight: Record<TaskPriority, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export interface SchedulePlan {
  ready: TaskNode[];
  blocked: TaskNode[];
  active: TaskNode[];
  availableSlots: number;
}

export class GraphScheduler {
  constructor(private readonly constraints: MissionConstraints) {}

  plan(graph: TaskGraph): SchedulePlan {
    graph.refreshReadiness();
    const all = graph.all();
    const active = all.filter((task) => ['CLAIMED', 'RUNNING', 'CHECKPOINTED', 'VALIDATING'].includes(task.state));
    const blocked = all.filter((task) => task.state === 'BLOCKED');
    const slots = Math.max(0, this.constraints.maxConcurrentTasks - active.length);

    const ready = graph.ready()
      .sort((a, b) => {
        const priority = priorityWeight[b.priority] - priorityWeight[a.priority];
        if (priority !== 0) return priority;
        return a.createdAt.localeCompare(b.createdAt);
      })
      .slice(0, slots);

    return { ready, blocked, active, availableSlots: slots };
  }

  canStart(task: TaskNode, graph: TaskGraph): boolean {
    if (task.state !== 'READY') return false;
    if (!graph.isDependencySatisfied(task)) return false;
    if (graph.hasFailedDependency(task)) return false;
    return true;
  }
}

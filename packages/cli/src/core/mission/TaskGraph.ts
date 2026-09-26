import { randomUUID } from 'crypto';
import {
  TaskNodeSchema,
  type MissionEvent,
  type TaskNode,
  type TaskState,
  type TaskPriority,
} from './types.js';

const TERMINAL: ReadonlySet<TaskState> = new Set(['COMPLETED', 'CANCELLED']);
const FAILED: ReadonlySet<TaskState> = new Set(['FAILED', 'RECOVERABLE', 'BLOCKED', 'ESCALATED']);

const TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  PENDING: ['READY', 'BLOCKED', 'CANCELLED'],
  READY: ['CLAIMED', 'BLOCKED', 'CANCELLED'],
  CLAIMED: ['RUNNING', 'READY', 'BLOCKED', 'CANCELLED'],
  RUNNING: ['CHECKPOINTED', 'VALIDATING', 'FAILED', 'RECOVERABLE', 'BLOCKED', 'ESCALATED', 'CANCELLED'],
  CHECKPOINTED: ['READY', 'RUNNING', 'VALIDATING', 'FAILED', 'RECOVERABLE', 'BLOCKED', 'CANCELLED'],
  VALIDATING: ['COMPLETED', 'FAILED', 'RECOVERABLE', 'BLOCKED', 'ESCALATED'],
  COMPLETED: [],
  FAILED: ['READY', 'RECOVERABLE', 'CANCELLED'],
  RECOVERABLE: ['READY', 'CLAIMED', 'CANCELLED', 'ESCALATED'],
  BLOCKED: ['READY', 'CANCELLED'],
  ESCALATED: ['READY', 'CANCELLED'],
  CANCELLED: [],
};

export class TaskGraph {
  constructor(private readonly tasks: TaskNode[] = []) {
    for (const task of tasks) TaskNodeSchema.parse(task);
    this.assertAcyclic();
  }

  all(): TaskNode[] {
    return [...this.tasks];
  }

  get(id: string): TaskNode | undefined {
    return this.tasks.find((task) => task.id === id);
  }

  add(input: {
    missionId: string;
    title: string;
    description: string;
    dependencies?: string[];
    parentTaskId?: string;
    priority?: TaskPriority;
    requiredCapabilities?: string[];
    acceptanceCriteria?: string[];
    inputs?: Record<string, unknown>;
    maxAttempts?: number;
    id?: string;
    idempotencyKey?: string;
  }): TaskNode {
    const now = new Date().toISOString();
    const id = input.id ?? `task_${randomUUID()}`;
    const task: TaskNode = {
      id,
      missionId: input.missionId,
      parentTaskId: input.parentTaskId,
      title: input.title,
      description: input.description,
      state: 'PENDING',
      priority: input.priority ?? 'MEDIUM',
      dependencies: [...new Set(input.dependencies ?? [])],
      requiredCapabilities: [...new Set(input.requiredCapabilities ?? [])],
      acceptanceCriteria: [...input.acceptanceCriteria ?? []],
      inputs: input.inputs ?? {},
      outputs: {},
      artifacts: [],
      evidenceIds: [],
      attempt: 0,
      maxAttempts: input.maxAttempts ?? 3,
      idempotencyKey: input.idempotencyKey ?? `${input.missionId}:${id}`,
      createdAt: now,
      updatedAt: now,
    };

    if (this.get(id)) throw new Error(`Task already exists: ${id}`);
    for (const dependency of task.dependencies) {
      if (!this.get(dependency)) throw new Error(`Unknown task dependency: ${dependency}`);
    }

    this.tasks.push(task);
    try {
      this.assertAcyclic();
    } catch (error) {
      this.tasks.pop();
      throw error;
    }
    this.refreshReadiness();
    return task;
  }

  transition(id: string, to: TaskState): TaskNode {
    const task = this.require(id);
    const allowed = TRANSITIONS[task.state];
    if (!allowed.includes(to)) {
      throw new Error(`Cannot transition task ${id} from ${task.state} to ${to}`);
    }
    task.state = to;
    task.updatedAt = new Date().toISOString();
    if (to === 'RUNNING' && !task.startedAt) task.startedAt = task.updatedAt;
    if (to === 'COMPLETED') task.completedAt = task.updatedAt;
    this.refreshReadiness();
    return task;
  }

  setOwner(id: string, owner: string): TaskNode {
    const task = this.require(id);
    if (!['READY', 'CLAIMED', 'RECOVERABLE'].includes(task.state)) {
      throw new Error(`Task ${id} cannot be claimed from state ${task.state}`);
    }
    task.owner = owner;
    task.attempt += 1;
    task.updatedAt = new Date().toISOString();
    return task;
  }

  releaseOwner(id: string): TaskNode {
    const task = this.require(id);
    task.owner = undefined;
    task.leaseId = undefined;
    task.leaseExpiresAt = undefined;
    task.updatedAt = new Date().toISOString();
    return task;
  }

  update(id: string, updates: Partial<Pick<TaskNode, 'outputs' | 'artifacts' | 'evidenceIds' | 'error' | 'inputs'>>): TaskNode {
    const task = this.require(id);
    Object.assign(task, updates);
    task.updatedAt = new Date().toISOString();
    return task;
  }

  ready(): TaskNode[] {
    this.refreshReadiness();
    return this.tasks.filter((t) => t.state === 'READY');
  }

  isDependencySatisfied(task: TaskNode): boolean {
    return task.dependencies.every((id) => this.get(id)?.state === 'COMPLETED');
  }

  hasFailedDependency(task: TaskNode): boolean {
    return task.dependencies.some((id) => FAILED.has(this.get(id)?.state as TaskState));
  }

  refreshReadiness(): void {
    for (const task of this.tasks) {
      if (TERMINAL.has(task.state)) continue;
      if (this.hasFailedDependency(task)) {
        if (task.state !== 'BLOCKED') task.state = 'BLOCKED';
        continue;
      }
      if (this.isDependencySatisfied(task) && ['PENDING', 'BLOCKED'].includes(task.state)) {
        task.state = 'READY';
      }
    }
  }

  topologicalOrder(): string[] {
    this.assertAcyclic();
    const indegree = new Map(this.tasks.map((t) => [t.id, 0]));
    const outgoing = new Map<string, string[]>();
    for (const task of this.tasks) {
      outgoing.set(task.id, []);
      for (const dep of task.dependencies) {
        indegree.set(task.id, (indegree.get(task.id) ?? 0) + 1);
        outgoing.get(dep)?.push(task.id);
      }
    }
    const queue = [...this.tasks.filter((t) => indegree.get(t.id) === 0).map((t) => t.id)];
    const result: string[] = [];
    while (queue.length) {
      const id = queue.shift()!;
      result.push(id);
      for (const next of outgoing.get(id) ?? []) {
        const nextDegree = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, nextDegree);
        if (nextDegree === 0) queue.push(next);
      }
    }
    return result;
  }

  private require(id: string): TaskNode {
    const task = this.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    return task;
  }

  private assertAcyclic(): void {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) throw new Error(`Task dependency cycle detected at ${id}`);
      if (visited.has(id)) return;
      visiting.add(id);
      const task = this.get(id);
      if (!task) throw new Error(`Unknown dependency: ${id}`);
      for (const dep of task.dependencies) visit(dep);
      visiting.delete(id);
      visited.add(id);
    };
    for (const task of this.tasks) visit(task.id);
  }
}

export { randomUUID };

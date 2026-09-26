import { randomUUID } from 'crypto';
import { CompletionEngine } from './CompletionEngine.js';
import { LeaseManager } from './LeaseManager.js';
import { MissionStore } from './MissionStore.js';
import type { MissionSnapshot } from './types.js';
import { TaskGraph } from './TaskGraph.js';
import {
  EvidenceSchema,
  type CompletionCriterion,
  type Mission,
  type MissionConstraints,
  type MissionEvent,
  type MissionEvidence,
  type MissionRequirements,
  type TaskCheckpoint,
  type TaskNode,
  type TaskPriority,
  type MissionStatus,
  type TaskState,
} from './types.js';

export class MissionEngine {
  readonly store: MissionStore;
  private readonly completion = new CompletionEngine();
  private readonly snapshots = new Map<string, MissionSnapshot>();
  private readonly leases = new Map<string, LeaseManager>();

  constructor(store?: MissionStore) {
    this.store = store ?? new MissionStore();
  }

  createMission(input: {
    goal: string;
    workingDir: string;
    projectId?: string;
    requirements?: Partial<MissionRequirements>;
    constraints?: Partial<MissionConstraints>;
    metadata?: Record<string, unknown>;
    id?: string;
  }): Mission {
    const now = new Date().toISOString();
    const mission: Mission = {
      id: input.id ?? `mission_${randomUUID()}`,
      goal: input.goal,
      status: 'created',
      projectId: input.projectId,
      workingDir: input.workingDir,
      requirements: {
        acceptanceCriteria: input.requirements?.acceptanceCriteria ?? [],
        completionCriteria: input.requirements?.completionCriteria ?? [],
        requiredArtifacts: input.requirements?.requiredArtifacts ?? [],
        requiredCapabilities: input.requirements?.requiredCapabilities ?? [],
      },
      constraints: {
        maxConcurrentTasks: input.constraints?.maxConcurrentTasks ?? 3,
        maxTaskAttempts: input.constraints?.maxTaskAttempts ?? 3,
        allowedPaths: input.constraints?.allowedPaths ?? [],
        deniedPaths: input.constraints?.deniedPaths ?? [],
        requireValidation: input.constraints?.requireValidation ?? true,
        requireEvidence: input.constraints?.requireEvidence ?? true,
      },
      taskIds: [],
      evidenceIds: [],
      checkpointIds: [],
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata ?? {},
    };
    this.store.create(mission);
    this.snapshots.set(mission.id, this.store.get(mission.id)!);
    this.leases.set(mission.id, new LeaseManager(new TaskGraph()));
    this.emit(mission.id, 'MISSION_CREATED', { goal: mission.goal });
    return mission;
  }

  load(missionId: string): MissionSnapshot {
    const snapshot = this.store.get(missionId);
    if (!snapshot) throw new Error(`Mission not found: ${missionId}`);
    this.snapshots.set(missionId, snapshot);
    this.leases.set(missionId, new LeaseManager(new TaskGraph(snapshot.tasks)));
    return snapshot;
  }

  start(missionId: string): Mission {
    const snapshot = this.load(missionId);
    if (!['created', 'paused'].includes(snapshot.mission.status)) {
      throw new Error(`Mission ${missionId} cannot start from ${snapshot.mission.status}`);
    }
    snapshot.mission.status = 'active';
    this.touch(snapshot);
    this.emitIn(snapshot, 'MISSION_STARTED', {});
    this.persist(snapshot);
    return snapshot.mission;
  }

  addTask(missionId: string, input: {
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
    const snapshot = this.load(missionId);
    const existing = input.idempotencyKey
      ? snapshot.tasks.find((candidate) => candidate.idempotencyKey === input.idempotencyKey)
      : input.id
        ? snapshot.tasks.find((candidate) => candidate.id === input.id)
        : undefined;
    if (existing) return existing;

    const graph = new TaskGraph(snapshot.tasks);
    const task = graph.add({ missionId, ...input });
    snapshot.tasks = graph.all();
    snapshot.mission.taskIds.push(task.id);
    this.touch(snapshot);
    this.emitIn(snapshot, 'TASK_CREATED', { title: task.title });
    this.refreshAndEmitReady(snapshot);
    this.persist(snapshot);
    return task;
  }

  transitionTask(missionId: string, taskId: string, state: TaskState): TaskNode {
    const snapshot = this.load(missionId);
    const graph = new TaskGraph(snapshot.tasks);
    const task = graph.transition(taskId, state);
    snapshot.tasks = graph.all();
    this.touch(snapshot);
    this.emitIn(snapshot, this.eventForTaskState(state), { state }, taskId);
    this.persist(snapshot);
    return task;
  }

  acquireLease(missionId: string, taskId: string, owner: string, ttlMs?: number) {
    const snapshot = this.load(missionId);
    const graph = new TaskGraph(snapshot.tasks);
    const manager = new LeaseManager(graph);
    const lease = manager.acquire(taskId, owner, ttlMs);
    snapshot.tasks = graph.all();
    this.touch(snapshot);
    this.emitIn(snapshot, 'TASK_CLAIMED', { owner, leaseId: lease.id }, taskId);
    this.emitIn(snapshot, 'LEASE_ACQUIRED', { owner, leaseId: lease.id, expiresAt: lease.expiresAt }, taskId);
    this.persist(snapshot);
    this.leases.set(missionId, manager);
    return lease;
  }

  renewLease(missionId: string, leaseId: string, ttlMs?: number) {
    const snapshot = this.load(missionId);
    const graph = new TaskGraph(snapshot.tasks);
    const manager = new LeaseManager(graph);
    const lease = manager.renew(leaseId, ttlMs);
    snapshot.tasks = graph.all();
    this.touch(snapshot);
    this.persist(snapshot);
    this.leases.set(missionId, manager);
    return lease;
  }

  releaseLease(missionId: string, leaseId: string): void {
    const snapshot = this.load(missionId);
    const graph = new TaskGraph(snapshot.tasks);
    const manager = new LeaseManager(graph);
    const task = graph.all().find((item) => item.leaseId === leaseId);
    manager.release(leaseId);
    snapshot.tasks = graph.all();
    this.touch(snapshot);
    this.emitIn(snapshot, 'LEASE_RELEASED', {}, task?.id);
    this.persist(snapshot);
  }

  expireLeases(missionId: string, now = Date.now()): string[] {
    const snapshot = this.load(missionId);
    const graph = new TaskGraph(snapshot.tasks);
    const manager = new LeaseManager(graph);
    const expired = manager.expire(now);
    snapshot.tasks = graph.all();
    this.touch(snapshot);
    for (const taskId of expired) this.emitIn(snapshot, 'LEASE_EXPIRED', {}, taskId);
    this.persist(snapshot);
    return expired;
  }

  checkpoint(missionId: string, checkpoint: Omit<TaskCheckpoint, 'createdAt'> & { createdAt?: string }): TaskCheckpoint {
    const snapshot = this.load(missionId);
    const value: TaskCheckpoint = {
      ...checkpoint,
      createdAt: checkpoint.createdAt ?? new Date().toISOString(),
    };
    snapshot.checkpoints.push(value);
    snapshot.mission.checkpointIds.push(value.id);
    this.touch(snapshot);
    this.emitIn(snapshot, 'CHECKPOINT_CREATED', { checkpointId: value.id }, value.taskId);
    this.persist(snapshot);
    return value;
  }

  recordEvidence(missionId: string, evidence: Omit<MissionEvidence, 'createdAt'> & { createdAt?: string }): MissionEvidence {
    const snapshot = this.load(missionId);
    const value = EvidenceSchema.parse({
      ...evidence,
      createdAt: evidence.createdAt ?? new Date().toISOString(),
    });
    snapshot.evidence.push(value);
    snapshot.mission.evidenceIds.push(value.id);
    this.touch(snapshot);
    this.emitIn(snapshot, 'EVIDENCE_RECORDED', { evidenceId: value.id }, undefined);
    this.persist(snapshot);
    return value;
  }

  updateTask(missionId: string, taskId: string, updates: Partial<Pick<TaskNode, 'outputs' | 'artifacts' | 'evidenceIds' | 'error' | 'inputs'>>): TaskNode {
    const snapshot = this.load(missionId);
    const graph = new TaskGraph(snapshot.tasks);
    const task = graph.update(taskId, updates);
    snapshot.tasks = graph.all();
    this.touch(snapshot);
    this.persist(snapshot);
    return task;
  }

  readyTasks(missionId: string): TaskNode[] {
    const snapshot = this.load(missionId);
    const graph = new TaskGraph(snapshot.tasks);
    graph.refreshReadiness();
    return graph.ready();
  }

  evaluateCompletion(missionId: string) {
    const snapshot = this.load(missionId);
    const result = this.completion.evaluate(snapshot.mission, snapshot.tasks, snapshot.evidence);
    if (result.complete && snapshot.mission.status !== 'completed') {
      snapshot.mission.status = 'completed';
      snapshot.mission.completedAt = new Date().toISOString();
      this.touch(snapshot);
      this.emitIn(snapshot, 'MISSION_COMPLETED', { reasons: result.reasons });
      this.persist(snapshot);
    } else if (result.blocked && snapshot.mission.status === 'active') {
      snapshot.mission.status = 'blocked';
      this.touch(snapshot);
      this.emitIn(snapshot, 'MISSION_BLOCKED', { reasons: result.reasons });
      this.persist(snapshot);
    }
    return result;
  }

  snapshot(missionId: string): MissionSnapshot {
    return this.load(missionId);
  }

  private refreshAndEmitReady(snapshot: MissionSnapshot): void {
    const graph = new TaskGraph(snapshot.tasks);
    const ready = graph.ready();
    snapshot.tasks = graph.all();
    for (const task of ready) {
      if (task.state === 'READY') this.emitIn(snapshot, 'TASK_READY', {}, task.id);
    }
  }

  private persist(snapshot: MissionSnapshot): void {
    this.store.save(snapshot);
    this.snapshots.set(snapshot.mission.id, snapshot);
  }

  private touch(snapshot: MissionSnapshot): void {
    snapshot.mission.updatedAt = new Date().toISOString();
  }

  private emit(missionId: string, type: MissionEvent['type'], data: Record<string, unknown>, taskId?: string): void {
    const snapshot = this.snapshots.get(missionId);
    if (!snapshot) return;
    this.emitIn(snapshot, type, data, taskId);
    this.persist(snapshot);
  }

  private emitIn(snapshot: MissionSnapshot, type: MissionEvent['type'], data: Record<string, unknown>, taskId?: string): void {
    snapshot.events.push({
      id: `event_${randomUUID()}`,
      missionId: snapshot.mission.id,
      type,
      taskId,
      timestamp: new Date().toISOString(),
      data,
    });
  }

  private eventForTaskState(state: TaskState): MissionEvent['type'] {
    const map: Partial<Record<TaskState, MissionEvent['type']>> = {
      CLAIMED: 'TASK_CLAIMED',
      RUNNING: 'TASK_STARTED',
      CHECKPOINTED: 'CHECKPOINT_CREATED',
      VALIDATING: 'TASK_VALIDATING',
      COMPLETED: 'TASK_COMPLETED',
      FAILED: 'TASK_FAILED',
      RECOVERABLE: 'TASK_RECOVERABLE',
      BLOCKED: 'TASK_BLOCKED',
      ESCALATED: 'TASK_FAILED',
      CANCELLED: 'TASK_CANCELLED',
    };
    return map[state] ?? 'TASK_CREATED';
  }
}

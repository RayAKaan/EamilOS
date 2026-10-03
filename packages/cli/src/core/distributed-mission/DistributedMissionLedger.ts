import { randomUUID } from 'crypto';
import { TaskGraph } from '../mission/TaskGraph.js';
import type { TaskNode } from '../mission/types.js';
import type {
  DistributedAssignment,
  DistributedMissionEvent,
  DistributedMissionSnapshot,
  DistributedNodeView,
} from './types.js';
import {
  SqliteDistributedMissionStateStore,
  type DistributedMissionLedgerState,
} from './DistributedMissionStateStore.js';

export class DistributedMissionLedger {
  private version = 0;
  private sequence = 0;
  private readonly assignments = new Map<string, DistributedAssignment>();
  private readonly events: DistributedMissionEvent[] = [];

  constructor(
    private readonly missionId: string,
    private readonly graph: TaskGraph,
    private readonly persistence?: SqliteDistributedMissionStateStore,
    restored?: {
      state: DistributedMissionLedgerState;
      events: DistributedMissionEvent[];
    },
  ) {
    if (restored) {
      if (restored.state.missionId !== missionId) {
        throw new Error('Distributed mission state belongs to ' + restored.state.missionId + ', not ' + missionId);
      }
      this.version = restored.state.graphVersion;
      this.sequence = restored.state.sequence;
      for (const assignment of restored.state.assignments) {
        this.assignments.set(assignment.assignmentId, {
          ...assignment,
          assignmentVersion: assignment.assignmentVersion ?? 1,
          fencingToken: assignment.fencingToken ?? 0,
        });
      }
      this.events.push(...restored.events.map((event) => ({
        ...event,
        data: { ...event.data },
      })));
    }
  }

  static restore(
    missionId: string,
    persistence: SqliteDistributedMissionStateStore,
  ): DistributedMissionLedger {
    const restored = persistence.load(missionId);
    if (!restored) throw new Error('DISTRIBUTED_MISSION_NOT_FOUND:' + missionId);
    return new DistributedMissionLedger(
      missionId,
      new TaskGraph(restored.state.tasks),
      persistence,
      restored,
    );
  }

  get graphVersion(): number {
    return this.version;
  }

  nextFencingToken(): number {
    const max = [...this.assignments.values()].reduce(
      (value, assignment) => Math.max(value, assignment.fencingToken ?? 0),
      0,
    );
    return Math.max(max + 1, this.sequence + 1);
  }

  snapshot(nodes: DistributedNodeView[] = []): DistributedMissionSnapshot {
    return {
      missionId: this.missionId,
      graphVersion: this.version,
      tasks: this.graph.all().map((task) => structuredClone(task)),
      nodes: nodes.map((node) => ({ ...node, capabilities: [...node.capabilities] })),
      assignments: [...this.assignments.values()].map((assignment) => ({ ...assignment })),
      events: this.events.map((event) => ({ ...event, data: { ...event.data } })),
    };
  }

  sync(): DistributedMissionEvent {
    return this.append('MISSION_SYNCED', undefined, undefined, {
      taskCount: this.graph.all().length,
    });
  }

  addAssignment(assignment: DistributedAssignment, expectedVersion?: number): DistributedAssignment {
    this.assertVersion(expectedVersion);
    if (this.assignments.has(assignment.assignmentId)) {
      throw new Error('Assignment already exists: ' + assignment.assignmentId);
    }

    this.assignments.set(assignment.assignmentId, {
      ...assignment,
      assignmentVersion: assignment.assignmentVersion ?? 1,
      fencingToken: assignment.fencingToken ?? this.nextFencingToken(),
    });
    const previousVersion = this.version;
    this.version += 1;

    try {
      this.append(
        'TASK_ASSIGNED',
        assignment.taskId,
        assignment.nodeId,
        {
          assignmentId: assignment.assignmentId,
          attempt: assignment.attempt,
        },
        false,
      );
      return { ...assignment };
    } catch (error) {
      this.assignments.delete(assignment.assignmentId);
      this.version = previousVersion;
      throw error;
    }
  }

  updateAssignment(
    assignmentId: string,
    state: DistributedAssignment['state'],
    patch: Partial<DistributedAssignment> = {},
  ): DistributedAssignment {
    const current = this.requireAssignment(assignmentId);
    const next = {
      ...current,
      ...patch,
      state,
      assignmentVersion: current.assignmentVersion + 1,
      updatedAt: new Date().toISOString(),
    };
    this.assignments.set(assignmentId, next);

    try {
      this.append('ASSIGNMENT_UPDATED', next.taskId, next.nodeId, {
        assignmentId,
        state,
      });
      return { ...next };
    } catch (error) {
      this.assignments.set(assignmentId, current);
      throw error;
    }
  }

  getAssignment(assignmentId: string): DistributedAssignment | undefined {
    const assignment = this.assignments.get(assignmentId);
    return assignment ? { ...assignment } : undefined;
  }

  getTaskAssignment(taskId: string): DistributedAssignment | undefined {
    return [...this.assignments.values()].find(
      (assignment) =>
        assignment.taskId === taskId &&
        !['COMPLETED', 'FAILED', 'REJECTED'].includes(assignment.state),
    );
  }

  append(
    type: DistributedMissionEvent['type'],
    taskId?: string,
    nodeId?: string,
    data: Record<string, unknown> = {},
    bumpVersion = true,
  ): DistributedMissionEvent {
    const previousVersion = this.version;
    const previousSequence = this.sequence;
    if (bumpVersion) this.version += 1;

    const event: DistributedMissionEvent = {
      eventId: 'event_' + randomUUID(),
      sequence: ++this.sequence,
      missionId: this.missionId,
      type,
      taskId,
      nodeId,
      graphVersion: this.version,
      timestamp: new Date().toISOString(),
      data,
    };

    this.events.push(event);

    try {
      if (this.persistence) {
        const persistedEvent = this.persistence.commit(this.persistedState(), event);
        this.events[this.events.length - 1] = persistedEvent;
      }
      const current = this.events[this.events.length - 1];
      return {
        ...current,
        data: { ...current.data },
      };
    } catch (error) {
      this.events.pop();
      this.sequence = previousSequence;
      this.version = previousVersion;
      throw error;
    }
  }

  eventsSince(sequence: number): DistributedMissionEvent[] {
    return this.events
      .filter((event) => event.sequence > sequence)
      .map((event) => ({
        ...event,
        data: { ...event.data },
      }));
  }

  tasks(): TaskNode[] {
    return this.graph.all();
  }

  listAssignments(): DistributedAssignment[] {
    return [...this.assignments.values()].map((assignment) => ({ ...assignment }));
  }

  private persistedState(): DistributedMissionLedgerState {
    return {
      missionId: this.missionId,
      graphVersion: this.version,
      sequence: this.sequence,
      tasks: this.graph.all().map((task) => structuredClone(task)),
      assignments: [...this.assignments.values()].map((assignment) => ({ ...assignment })),
    };
  }

  private assertVersion(expectedVersion?: number): void {
    if (expectedVersion !== undefined && expectedVersion !== this.version) {
      throw new Error('Stale distributed mission version: expected ' + expectedVersion + ', current ' + this.version);
    }
  }

  private requireAssignment(id: string): DistributedAssignment {
    const assignment = this.assignments.get(id);
    if (!assignment) throw new Error('Assignment not found: ' + id);
    return assignment;
  }
}

import { randomUUID } from 'crypto';
import type { TaskGraph } from '../mission/TaskGraph.js';
import type { TaskNode } from '../mission/types.js';
import type {
  DistributedAssignment,
  DistributedMissionEvent,
  DistributedMissionSnapshot,
  DistributedNodeView,
} from './types.js';

export class DistributedMissionLedger {
  private version = 0;
  private sequence = 0;
  private readonly assignments = new Map<string, DistributedAssignment>();
  private readonly events: DistributedMissionEvent[] = [];

  constructor(
    private readonly missionId: string,
    private readonly graph: TaskGraph,
  ) {}

  get graphVersion(): number {
    return this.version;
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
      throw new Error(`Assignment already exists: ${assignment.assignmentId}`);
    }
    this.assignments.set(assignment.assignmentId, { ...assignment });
    this.version += 1;
    this.append('TASK_ASSIGNED', assignment.taskId, assignment.nodeId, {
      assignmentId: assignment.assignmentId,
      attempt: assignment.attempt,
    }, false);
    return { ...assignment };
  }

  updateAssignment(assignmentId: string, state: DistributedAssignment['state'], patch: Partial<DistributedAssignment> = {}): DistributedAssignment {
    const current = this.requireAssignment(assignmentId);
    const next = { ...current, ...patch, state, updatedAt: new Date().toISOString() };
    this.assignments.set(assignmentId, next);
    this.version += 1;
    return { ...next };
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
    if (bumpVersion) this.version += 1;
    const event: DistributedMissionEvent = {
      eventId: `event_${randomUUID()}`,
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
    return { ...event, data: { ...event.data } };
  }

  eventsSince(sequence: number): DistributedMissionEvent[] {
    return this.events.filter((event) => event.sequence > sequence).map((event) => ({ ...event, data: { ...event.data } }));
  }

  tasks(): TaskNode[] {
    return this.graph.all();
  }

  listAssignments(): DistributedAssignment[] {
    return [...this.assignments.values()].map((assignment) => ({ ...assignment }));
  }

  private assertVersion(expectedVersion?: number): void {
    if (expectedVersion !== undefined && expectedVersion !== this.version) {
      throw new Error(`Stale distributed mission version: expected ${expectedVersion}, current ${this.version}`);
    }
  }

  private requireAssignment(id: string): DistributedAssignment {
    const assignment = this.assignments.get(id);
    if (!assignment) throw new Error(`Assignment not found: ${id}`);
    return assignment;
  }
}

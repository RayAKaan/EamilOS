import type { TaskNode, TaskPriority, TaskState } from '../mission/types.js';

export type DistributedAssignmentState =
  | 'OFFERED'
  | 'LEASED'
  | 'RUNNING'
  | 'CHECKPOINTED'
  | 'COMPLETED'
  | 'FAILED'
  | 'REQUEUED'
  | 'REJECTED';

export interface DistributedNodeView {
  nodeId: string;
  state: 'online' | 'degraded' | 'offline';
  capabilities: string[];
  activeTasks: number;
  maxConcurrentTasks: number;
  lastSeenAt: number;
}

export interface DistributedAssignment {
  assignmentId: string;
  missionId: string;
  taskId: string;
  nodeId: string;
  state: DistributedAssignmentState;
  leaseId?: string;
  leaseExpiresAt?: string;
  attempt: number;
  branch: string;
  createdAt: string;
  updatedAt: string;
}

export interface DistributedMissionEvent {
  eventId: string;
  sequence: number;
  missionId: string;
  type:
    | 'MISSION_SYNCED'
    | 'TASK_OFFERED'
    | 'TASK_ASSIGNED'
    | 'TASK_REQUEUED'
    | 'TASK_CHECKPOINTED'
    | 'TASK_COMPLETED'
    | 'TASK_FAILED'
    | 'NODE_LOST'
    | 'LEASE_EXPIRED'
    | 'GIT_WORKSPACE_ASSIGNED';
  taskId?: string;
  nodeId?: string;
  graphVersion: number;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface DistributedMissionSnapshot {
  missionId: string;
  graphVersion: number;
  tasks: TaskNode[];
  nodes: DistributedNodeView[];
  assignments: DistributedAssignment[];
  events: DistributedMissionEvent[];
}

export interface TaskAssignmentCandidate {
  nodeId: string;
  score: number;
  reason: string;
}

export interface GitWorkspace {
  missionId: string;
  taskId: string;
  nodeId: string;
  branch: string;
  baseRef: string;
  worktreePath?: string;
  status: 'allocated' | 'active' | 'ready_for_integration' | 'integrated' | 'abandoned';
}

export interface DistributedTaskRequirements {
  capabilities?: string[];
  priority?: TaskPriority;
  preferredNodeId?: string;
}

export interface DistributedTaskResult {
  taskId: string;
  nodeId: string;
  success: boolean;
  state: TaskState;
  checkpointId?: string;
  artifacts?: string[];
  commit?: string;
  error?: string;
}

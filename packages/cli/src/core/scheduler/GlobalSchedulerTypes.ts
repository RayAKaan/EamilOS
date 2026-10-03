import type { FleetWorker, FleetRegistry } from '../comms/a2a/EamilosFleetRegistry.js';
import type { ResourceLease, ResourceLeaseManager } from '../comms/a2a/EamilosResourceLeaseManager.js';
import type { DistributedEventLog } from '../comms/a2a/EamilosDistributedEventLog.js';
import type { MissionControlPlane } from '../mission-control/MissionControl.js';
import type { TaskNode, TaskPriority } from '../mission/types.js';

export type SchedulerDecisionState = 'scheduled' | 'dispatched' | 'completed' | 'failed' | 'cancelled' | 'rejected' | 'rescheduled';

export interface SchedulingConstraints {
  maxGlobalExecutions?: number;
  maxPerWorker?: number;
  allowStaleWorkers?: boolean;
  leaseTtlMs?: number;
  leaseRenewalThresholdMs?: number;
}

export interface SchedulingCandidate {
  missionId: string;
  taskId: string;
  task: TaskNode;
  missionCreatedAt: string;
  priorityRank: number;
  requiredCapabilities: string[];
  resources: { readSet: string[]; writeSet: string[] };
}

export interface ScheduleDecision {
  decisionId: string;
  idempotencyKey: string;
  schedulerRevision: number;
  missionId: string;
  taskId: string;
  executionId: string;
  workerId: string;
  agentId: string;
  harnessId: string;
  priority: TaskPriority;
  fencingToken: number;
  leaseId: string;
  state: SchedulerDecisionState;
  createdAt: string;
  updatedAt: string;
  reason?: string;
}

export interface SchedulerSnapshot {
  revision: number;
  updatedAt?: string;
  activeDecisionCount: number;
  decisions: ScheduleDecision[];
}

export interface SchedulerDispatcher {
  dispatch(decision: ScheduleDecision, candidate: SchedulingCandidate, worker: FleetWorker): Promise<void>;
}

export interface GlobalSchedulerOptions {
  missionControl: MissionControlPlane;
  fleet: FleetRegistry;
  leases: ResourceLeaseManager;
  store?: SchedulerStore;
  eventLog?: DistributedEventLog;
  dispatcher?: SchedulerDispatcher;
  constraints?: SchedulingConstraints;
}

export interface SchedulerStore {
  snapshot(): SchedulerSnapshot;
  nextRevision(): number;
  saveDecision(decision: ScheduleDecision): void;
  updateDecision(decisionId: string, patch: Partial<ScheduleDecision>): ScheduleDecision;
  getDecision(decisionId: string): ScheduleDecision | undefined;
  getByIdempotencyKey(key: string): ScheduleDecision | undefined;
  listActive(): ScheduleDecision[];
  close?(): void;
}

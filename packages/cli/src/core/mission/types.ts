import { z } from 'zod';

export const MissionStatusSchema = z.enum([
  'created',
  'active',
  'paused',
  'completed',
  'failed',
  'blocked',
  'cancelled',
]);
export type MissionStatus = z.infer<typeof MissionStatusSchema>;

export const TaskStateSchema = z.enum([
  'PENDING',
  'READY',
  'CLAIMED',
  'RUNNING',
  'CHECKPOINTED',
  'VALIDATING',
  'COMPLETED',
  'FAILED',
  'RECOVERABLE',
  'BLOCKED',
  'ESCALATED',
  'CANCELLED',
]);
export type TaskState = z.infer<typeof TaskStateSchema>;

export const TaskPrioritySchema = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const EvidenceSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['artifact', 'test', 'build', 'security', 'requirement', 'manual', 'validation']),
  description: z.string().min(1),
  reference: z.string().min(1),
  passed: z.boolean(),
  createdAt: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});
export type MissionEvidence = z.infer<typeof EvidenceSchema>;

export const CheckpointSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  status: TaskStateSchema,
  completedSteps: z.array(z.string()).default([]),
  remainingSteps: z.array(z.string()).default([]),
  filesChanged: z.array(z.string()).default([]),
  artifacts: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
  previousOwner: z.string().optional(),
  failure: z.string().optional(),
  createdAt: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});
export type TaskCheckpoint = z.infer<typeof CheckpointSchema>;

export const TaskNodeSchema = z.object({
  id: z.string().min(1),
  missionId: z.string().min(1),
  parentTaskId: z.string().optional(),
  title: z.string().min(1),
  description: z.string().min(1),
  state: TaskStateSchema,
  priority: TaskPrioritySchema.default('MEDIUM'),
  dependencies: z.array(z.string()).default([]),
  requiredCapabilities: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  inputs: z.record(z.unknown()).default({}),
  outputs: z.record(z.unknown()).default({}),
  artifacts: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
  owner: z.string().optional(),
  leaseId: z.string().optional(),
  leaseExpiresAt: z.string().datetime().optional(),
  attempt: z.number().int().min(0).default(0),
  maxAttempts: z.number().int().min(0).default(3),
  idempotencyKey: z.string().min(1),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
});
export type TaskNode = z.infer<typeof TaskNodeSchema>;

export const CompletionCriterionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  required: z.boolean().default(true),
  evidenceTypes: z.array(EvidenceSchema.shape.type).default([]),
});
export type CompletionCriterion = z.infer<typeof CompletionCriterionSchema>;

export const MissionRequirementsSchema = z.object({
  acceptanceCriteria: z.array(z.string()).default([]),
  completionCriteria: z.array(CompletionCriterionSchema).default([]),
  requiredArtifacts: z.array(z.string()).default([]),
  requiredCapabilities: z.array(z.string()).default([]),
});
export type MissionRequirements = z.infer<typeof MissionRequirementsSchema>;

export const MissionConstraintsSchema = z.object({
  maxConcurrentTasks: z.number().int().positive().default(3),
  maxTaskAttempts: z.number().int().nonnegative().default(3),
  allowedPaths: z.array(z.string()).default([]),
  deniedPaths: z.array(z.string()).default([]),
  requireValidation: z.boolean().default(true),
  requireEvidence: z.boolean().default(true),
});
export type MissionConstraints = z.infer<typeof MissionConstraintsSchema>;

export const MissionSchema = z.object({
  id: z.string().min(1),
  goal: z.string().min(1),
  status: MissionStatusSchema,
  projectId: z.string().optional(),
  workingDir: z.string().min(1),
  requirements: MissionRequirementsSchema,
  constraints: MissionConstraintsSchema,
  taskIds: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
  checkpointIds: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type Mission = z.infer<typeof MissionSchema>;

export type MissionEventType =
  | 'MISSION_CREATED'
  | 'MISSION_STARTED'
  | 'MISSION_PAUSED'
  | 'MISSION_RESUMED'
  | 'MISSION_COMPLETED'
  | 'MISSION_FAILED'
  | 'MISSION_BLOCKED'
  | 'MISSION_CANCELLED'
  | 'TASK_CREATED'
  | 'TASK_READY'
  | 'TASK_CLAIMED'
  | 'TASK_STARTED'
  | 'CHECKPOINT_CREATED'
  | 'TASK_VALIDATING'
  | 'TASK_COMPLETED'
  | 'TASK_FAILED'
  | 'TASK_RECOVERABLE'
  | 'TASK_BLOCKED'
  | 'TASK_REASSIGNED'
  | 'TASK_CANCELLED'
  | 'LEASE_ACQUIRED'
  | 'LEASE_RELEASED'
  | 'LEASE_EXPIRED'
  | 'EVIDENCE_RECORDED';

export interface MissionEvent {
  id: string;
  missionId: string;
  type: MissionEventType;
  taskId?: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface TaskLease {
  id: string;
  taskId: string;
  owner: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface MissionSnapshot {
  mission: Mission;
  tasks: TaskNode[];
  checkpoints: TaskCheckpoint[];
  evidence: MissionEvidence[];
  events: MissionEvent[];
}

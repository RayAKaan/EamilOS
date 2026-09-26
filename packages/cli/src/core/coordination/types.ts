import { z } from 'zod';

export const ResourceKindSchema = z.enum([
  'file',
  'directory',
  'artifact',
  'database',
  'service',
  'environment',
  'network',
  'workspace',
  'custom',
]);
export type ResourceKind = z.infer<typeof ResourceKindSchema>;

export const ResourceRefSchema = z.object({
  id: z.string().min(1),
  kind: ResourceKindSchema,
  mode: z.enum(['read', 'write']),
  scope: z.string().optional(),
});
export type ResourceRef = z.infer<typeof ResourceRefSchema>;

export const ConflictTypeSchema = z.enum([
  'DUPLICATE_TASK',
  'RESOURCE_READ_WRITE',
  'RESOURCE_WRITE_WRITE',
  'DEPENDENCY',
  'STALE_PLAN',
  'UNKNOWN_TASK',
  'CAPABILITY',
  'STRATEGIC',
]);
export type ConflictType = z.infer<typeof ConflictTypeSchema>;

export const ReconciliationActionSchema = z.enum([
  'ACCEPT',
  'MERGE',
  'SEQUENCE',
  'RESCHEDULE',
  'ESCALATE',
]);
export type ReconciliationAction = z.infer<typeof ReconciliationActionSchema>;

export const TaskProposalSchema = z.object({
  proposalId: z.string().min(1),
  missionId: z.string().min(1),
  agentId: z.string().min(1),
  baseGraphVersion: z.number().int().nonnegative(),
  globalTaskId: z.string().optional(),
  parentTaskId: z.string().optional(),
  title: z.string().min(1),
  objective: z.string().min(1),
  dependencies: z.array(z.string()).default([]),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
  requiredCapabilities: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  readSet: z.array(ResourceRefSchema).default([]),
  writeSet: z.array(ResourceRefSchema).default([]),
  idempotencyKey: z.string().min(1),
  orderingAfter: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});
export type TaskProposal = z.infer<typeof TaskProposalSchema>;

export const LocalTodoSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  agentId: z.string().min(1),
  title: z.string().min(1),
  objective: z.string().min(1),
  dependencies: z.array(z.string()).default([]),
  readSet: z.array(ResourceRefSchema).default([]),
  writeSet: z.array(ResourceRefSchema).default([]),
  state: z.enum(['TODO', 'WAITING', 'RESCHEDULED', 'CONFLICT', 'DONE']).default('TODO'),
  reconciliationAction: ReconciliationActionSchema.default('ACCEPT'),
  reason: z.string().optional(),
});
export type LocalTodo = z.infer<typeof LocalTodoSchema>;

export const LocalPlanSchema = z.object({
  planId: z.string().min(1),
  missionId: z.string().min(1),
  agentId: z.string().min(1),
  baseGraphVersion: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  todos: z.array(LocalTodoSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});
export type LocalPlan = z.infer<typeof LocalPlanSchema>;

export const PlanRevisionSchema = z.object({
  id: z.string().min(1),
  planId: z.string().min(1),
  missionId: z.string().min(1),
  fromRevision: z.number().int().positive(),
  toRevision: z.number().int().positive(),
  reason: z.string().min(1),
  changedTodoIds: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
});
export type PlanRevision = z.infer<typeof PlanRevisionSchema>;

export const ConflictSchema = z.object({
  id: z.string().min(1),
  missionId: z.string().min(1),
  type: ConflictTypeSchema,
  action: ReconciliationActionSchema,
  proposalIds: z.array(z.string()).default([]),
  taskIds: z.array(z.string()).default([]),
  resourceIds: z.array(z.string()).default([]),
  reason: z.string().min(1),
  resolved: z.boolean().default(false),
  escalatedToJev: z.boolean().default(false),
  createdAt: z.string().datetime(),
});
export type CoordinationConflict = z.infer<typeof ConflictSchema>;

export const ResourceLeaseSchema = z.object({
  id: z.string().min(1),
  missionId: z.string().min(1),
  resourceId: z.string().min(1),
  taskId: z.string().min(1),
  agentId: z.string().min(1),
  mode: z.enum(['read', 'write']),
  acquiredAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  status: z.enum(['ACTIVE', 'RELEASED', 'EXPIRED']).default('ACTIVE'),
});
export type ResourceLease = z.infer<typeof ResourceLeaseSchema>;

export const TaskReservationSchema = z.object({
  id: z.string().min(1),
  missionId: z.string().min(1),
  taskId: z.string().min(1),
  agentId: z.string().min(1),
  resourceIds: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  status: z.enum(['ACTIVE', 'RELEASED', 'RESCHEDULED']).default('ACTIVE'),
});
export type TaskReservation = z.infer<typeof TaskReservationSchema>;

export const PlanVersionSchema = z.object({
  missionId: z.string().min(1),
  version: z.number().int().nonnegative(),
  graphVersion: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});
export type PlanVersion = z.infer<typeof PlanVersionSchema>;

export const CoordinationSnapshotSchema = z.object({
  version: PlanVersionSchema,
  proposals: z.array(TaskProposalSchema).default([]),
  localPlans: z.array(LocalPlanSchema).default([]),
  revisions: z.array(PlanRevisionSchema).default([]),
  conflicts: z.array(ConflictSchema).default([]),
  resourceLeases: z.array(ResourceLeaseSchema).default([]),
  reservations: z.array(TaskReservationSchema).default([]),
});
export type CoordinationSnapshot = z.infer<typeof CoordinationSnapshotSchema>;

export interface ReconciliationResult {
  action: ReconciliationAction;
  proposalId: string;
  conflicts: CoordinationConflict[];
  sequencedAfter: string[];
  rescheduled: boolean;
  mergedInto?: string;
  escalateToJev: boolean;
  reason: string;
}

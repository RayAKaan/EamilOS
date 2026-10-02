import { createHash } from 'node:crypto';
import { z } from 'zod';

export const EAMILOS_A2A_VERSION = 1 as const;

export const ResourceSetSchema = z.object({
  readSet: z.array(z.string().min(1)).default([]),
  writeSet: z.array(z.string().min(1)).default([]),
}).strict();
export type ResourceSet = z.infer<typeof ResourceSetSchema>;

export const CapabilityAdvertisementSchema = z.object({
  kind: z.literal('capability.advertisement'),
  protocolVersion: z.literal(EAMILOS_A2A_VERSION),
  workerId: z.string().min(1),
  agentId: z.string().min(1),
  harnessId: z.string().min(1),
  capabilities: z.array(z.string().min(1)),
  maxConcurrency: z.number().int().positive(),
  activeExecutions: z.number().int().nonnegative(),
  metadata: z.record(z.unknown()).default({}),
  advertisedAt: z.string().datetime(),
}).strict();
export type CapabilityAdvertisement = z.infer<typeof CapabilityAdvertisementSchema>;

export const AgentCardSchema = z.object({
  kind: z.literal('agent.card'),
  protocolVersion: z.literal(EAMILOS_A2A_VERSION),
  workerId: z.string().min(1),
  agentId: z.string().min(1),
  harnessId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  endpoint: z.string().url(),
  capabilities: z.array(z.string().min(1)),
  maxConcurrency: z.number().int().positive(),
  streaming: z.boolean(),
  checkpointResume: z.boolean(),
  authentication: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).default({}),
  advertisedAt: z.string().datetime(),
}).strict();
export type AgentCard = z.infer<typeof AgentCardSchema>;

export const TaskRequestSchema = z.object({
  kind: z.literal('task.request'),
  protocolVersion: z.literal(EAMILOS_A2A_VERSION),
  missionId: z.string().min(1),
  taskId: z.string().min(1),
  executionId: z.string().min(1),
  requestId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  graphVersion: z.number().int().nonnegative(),
  contextVersion: z.number().int().nonnegative(),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/),
  capabilities: z.array(z.string().min(1)),
  resources: ResourceSetSchema,
  constraints: z.record(z.unknown()).default({}),
  deadline: z.string().datetime().optional(),
  timeoutMs: z.number().int().positive(),
  checkpoint: z.record(z.unknown()).optional(),
  acceptanceCriteria: z.array(z.string().min(1)).default([]),
  input: z.record(z.unknown()).default({}),
}).strict();
export type TaskRequest = z.infer<typeof TaskRequestSchema>;

const CorrelatedSchema = z.object({
  kind: z.string(),
  protocolVersion: z.literal(EAMILOS_A2A_VERSION),
  missionId: z.string().min(1),
  taskId: z.string().min(1),
  executionId: z.string().min(1),
  requestId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  graphVersion: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
}).strict();

export const TaskAcceptedSchema = CorrelatedSchema.extend({
  kind: z.literal('task.accepted'),
  workerId: z.string().min(1),
  leaseId: z.string().min(1).optional(),
  fencingToken: z.number().int().positive().optional(),
}).strict();
export type TaskAccepted = z.infer<typeof TaskAcceptedSchema>;

export const TaskRejectedSchema = CorrelatedSchema.extend({
  kind: z.literal('task.rejected'),
  workerId: z.string().min(1),
  reason: z.enum(['unsupported_capability', 'capacity', 'resource_conflict', 'invalid_request', 'unauthorized', 'busy', 'unsupported_protocol', 'policy']),
  details: z.string().optional(),
}).strict();
export type TaskRejected = z.infer<typeof TaskRejectedSchema>;

export const TaskProgressSchema = CorrelatedSchema.extend({
  kind: z.literal('task.progress'),
  workerId: z.string().min(1),
  progress: z.number().min(0).max(1).optional(),
  message: z.string().optional(),
  checkpoint: z.record(z.unknown()).optional(),
}).strict();
export type TaskProgress = z.infer<typeof TaskProgressSchema>;

export const TaskCompletedSchema = CorrelatedSchema.extend({
  kind: z.literal('task.completed'),
  workerId: z.string().min(1),
  evidenceIds: z.array(z.string()).default([]),
  artifactIds: z.array(z.string()).default([]),
  output: z.record(z.unknown()).default({}),
}).strict();
export type TaskCompleted = z.infer<typeof TaskCompletedSchema>;

export const TaskFailedSchema = CorrelatedSchema.extend({
  kind: z.literal('task.failed'),
  workerId: z.string().min(1),
  error: z.string().min(1),
  retryable: z.boolean(),
  checkpoint: z.record(z.unknown()).optional(),
}).strict();
export type TaskFailed = z.infer<typeof TaskFailedSchema>;

export const TaskCancelledSchema = CorrelatedSchema.extend({
  kind: z.literal('task.cancelled'),
  workerId: z.string().min(1),
  reason: z.string().optional(),
}).strict();
export type TaskCancelled = z.infer<typeof TaskCancelledSchema>;

export const HeartbeatSchema = z.object({
  kind: z.literal('heartbeat'),
  protocolVersion: z.literal(EAMILOS_A2A_VERSION),
  workerId: z.string().min(1),
  timestamp: z.string().datetime(),
  activeExecutions: z.number().int().nonnegative(),
  capacity: z.number().int().nonnegative(),
  sequence: z.number().int().nonnegative(),
}).strict();
export type Heartbeat = z.infer<typeof HeartbeatSchema>;

export const A2AEnvelopeSchema = z.discriminatedUnion('kind', [
  AgentCardSchema,
  CapabilityAdvertisementSchema,
  TaskRequestSchema,
  TaskAcceptedSchema,
  TaskRejectedSchema,
  TaskProgressSchema,
  TaskCompletedSchema,
  TaskFailedSchema,
  TaskCancelledSchema,
  HeartbeatSchema,
]);
export type EamilosA2AMessage = z.infer<typeof A2AEnvelopeSchema>;

export function taskRequestFingerprint(request: TaskRequest): string {
  return createHash('sha256').update(canonicalize(request)).digest('hex');
}

export function assertTaskRequestFresh(
  request: TaskRequest,
  currentGraphVersion: number,
  currentContextHash?: string,
  now = Date.now(),
): void {
  if (request.graphVersion !== currentGraphVersion) {
    throw new Error(`STALE_GRAPH_VERSION:${request.graphVersion}:${currentGraphVersion}`);
  }
  if (currentContextHash && request.contextHash !== currentContextHash) {
    throw new Error('STALE_CONTEXT_HASH');
  }
  if (request.deadline && Date.parse(request.deadline) <= now) {
    throw new Error('TASK_DEADLINE_EXPIRED');
  }
}

export function isTerminalMessage(message: EamilosA2AMessage): boolean {
  return message.kind === 'task.completed' || message.kind === 'task.failed' || message.kind === 'task.cancelled' || message.kind === 'task.rejected';
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const object = value as Record<string, unknown>;
  return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + canonicalize(object[key])).join(',') + '}';
}

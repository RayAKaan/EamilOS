import { z } from 'zod';
import { ResourceRefSchema } from '../coordination/types.js';
import type { ResourceRef } from '../coordination/types.js';

export const HarnessKindSchema = z.enum(['cli', 'local', 'remote', 'api', 'plugin']);
export type HarnessKind = z.infer<typeof HarnessKindSchema>;

export const HarnessStatusSchema = z.enum([
  'DISCOVERED',
  'AVAILABLE',
  'UNAVAILABLE',
  'NOT_INSTALLED',
  'AUTH_REQUIRED',
  'AUTH_FAILED',
  'QUOTA_EXHAUSTED',
  'COOLDOWN',
]);
export type HarnessStatus = z.infer<typeof HarnessStatusSchema>;

export const HarnessCapabilitiesSchema = z.object({
  codeGeneration: z.boolean(),
  fileEditing: z.boolean(),
  commandExecution: z.boolean(),
  webResearch: z.boolean(),
  communication: z.boolean(),
  execution: z.boolean(),
  local: z.boolean(),
  remote: z.boolean(),
  streaming: z.boolean(),
  cancellation: z.boolean(),
  checkpointResume: z.boolean(),
  workspaceIsolation: z.boolean(),
  multimodal: z.boolean(),
  longContext: z.boolean(),
});
export type HarnessCapabilities = z.infer<typeof HarnessCapabilitiesSchema>;

export const HarnessAvailabilitySchema = z.object({
  installed: z.boolean(),
  authenticated: z.boolean(),
  executable: z.boolean(),
  quotaAvailable: z.boolean().optional(),
  checkedAt: z.string().datetime(),
  reason: z.string().optional(),
});
export type HarnessAvailability = z.infer<typeof HarnessAvailabilitySchema>;

export const HarnessLimitsSchema = z.object({
  maxConcurrentTasks: z.number().int().positive().optional(),
  maxContextTokens: z.number().int().positive().optional(),
  maxRuntimeMs: z.number().int().positive().optional(),
});
export type HarnessLimits = z.infer<typeof HarnessLimitsSchema>;

export const HarnessDescriptorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: HarnessKindSchema,
  provider: z.string().min(1),
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  capabilities: HarnessCapabilitiesSchema,
  supportedModes: z.array(z.enum(['communication', 'execution'])).min(1),
  status: HarnessStatusSchema,
  version: z.string().optional(),
  availability: HarnessAvailabilitySchema,
  limits: HarnessLimitsSchema.optional(),
});
export type HarnessDescriptor = z.infer<typeof HarnessDescriptorSchema>;

export const ExecutionStateSchema = z.enum([
  'CREATED',
  'RESERVED',
  'STARTING',
  'RUNNING',
  'CHECKPOINTING',
  'VALIDATING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
  'INTERRUPTED',
  'QUOTA_EXHAUSTED',
  'AUTH_FAILED',
  'ESCALATED',
  'RECOVERABLE',
  'RESCHEDULED',
]);
export type ExecutionState = z.infer<typeof ExecutionStateSchema>;

export const ExecutionFailureSchema = z.enum([
  'RATE_LIMIT',
  'QUOTA_EXHAUSTED',
  'AUTH_REQUIRED',
  'AUTH_FAILED',
  'HARNESS_NOT_FOUND',
  'WORKER_UNAVAILABLE',
  'WORKER_LOST',
  'TIMEOUT',
  'CRASH',
  'CONTEXT_LIMIT',
  'INVALID_OUTPUT',
  'VALIDATION_FAILED',
  'PERMISSION_DENIED',
  'RESOURCE_CONFLICT',
  'UNKNOWN',
]);
export type ExecutionFailure = z.infer<typeof ExecutionFailureSchema>;

export const ArtifactReferenceSchema = z.object({
  path: z.string().min(1),
  type: z.string().min(1),
  hash: z.string().optional(),
});
export type ArtifactReference = z.infer<typeof ArtifactReferenceSchema>;

export const FileChangeSchema = z.object({
  path: z.string().min(1),
  action: z.enum(['create', 'modify', 'delete']),
  hash: z.string().optional(),
});
export type FileChange = z.infer<typeof FileChangeSchema>;

export const ExecutionCheckpointSchema = z.object({
  id: z.string().min(1),
  missionId: z.string().min(1),
  taskId: z.string().min(1),
  executionId: z.string().min(1),
  harnessId: z.string().min(1),
  nodeId: z.string().min(1),
  createdAt: z.string().datetime(),
  progress: z.object({
    phase: z.string().optional(),
    completedSteps: z.array(z.string()).default([]),
    remainingSteps: z.array(z.string()).default([]),
  }),
  output: z.string().default(''),
  artifacts: z.array(ArtifactReferenceSchema).default([]),
  workspaceSnapshot: z.string().optional(),
  resumeContext: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type ExecutionCheckpoint = z.infer<typeof ExecutionCheckpointSchema>;

export const ExecutionRequestSchema = z.object({
  executionId: z.string().min(1),
  missionId: z.string().min(1),
  taskId: z.string().min(1),
  harnessId: z.string().min(1),
  nodeId: z.string().min(1),
  workingDir: z.string().min(1),
  prompt: z.string().min(1),
  context: z.object({
    missionGoal: z.string().min(1),
    taskObjective: z.string().min(1),
    acceptanceCriteria: z.array(z.string()).default([]),
    relevantFiles: z.array(z.string()).default([]),
    dependencies: z.array(z.string()).default([]),
    priorOutput: z.string().optional(),
    checkpoint: ExecutionCheckpointSchema.optional(),
  }),
  resources: z.object({
    readSet: z.array(ResourceRefSchema),
    writeSet: z.array(z.custom<ResourceRef>()),
  }),
  timeoutMs: z.number().int().positive(),
  environment: z.record(z.string()).default({}),
  policy: z.record(z.unknown()).default({}),
});
export type HarnessExecutionRequest = z.infer<typeof ExecutionRequestSchema>;

export const ValidationSummarySchema = z.object({
  passed: z.boolean(),
  checks: z.array(z.object({
    name: z.string().min(1),
    passed: z.boolean(),
    details: z.string().optional(),
  })).default([]),
});
export type ValidationSummary = z.infer<typeof ValidationSummarySchema>;

export const ExecutionMetricsSchema = z.object({
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  durationMs: z.number().nonnegative().optional(),
  tokensUsed: z.number().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
});
export type ExecutionMetrics = z.infer<typeof ExecutionMetricsSchema>;

export const HarnessExecutionResultSchema = z.object({
  executionId: z.string().min(1),
  missionId: z.string().min(1),
  taskId: z.string().min(1),
  harnessId: z.string().min(1),
  nodeId: z.string().min(1),
  status: ExecutionStateSchema,
  output: z.string().optional(),
  artifacts: z.array(ArtifactReferenceSchema).default([]),
  fileChanges: z.array(FileChangeSchema).default([]),
  evidence: z.array(z.string()).default([]),
  checkpoint: ExecutionCheckpointSchema.optional(),
  validation: ValidationSummarySchema.optional(),
  error: z.object({
    type: ExecutionFailureSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
    fallbackEligible: z.boolean(),
  }).optional(),
  metrics: ExecutionMetricsSchema,
});
export type HarnessExecutionResult = z.infer<typeof HarnessExecutionResultSchema>;

export const ExecutionRecordSchema = z.object({
  executionId: z.string().min(1),
  missionId: z.string().min(1),
  taskId: z.string().min(1),
  harnessId: z.string().min(1),
  nodeId: z.string().min(1),
  state: ExecutionStateSchema,
  attempts: z.number().int().nonnegative(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  checkpointId: z.string().optional(),
  failure: ExecutionFailureSchema.optional(),
  result: HarnessExecutionResultSchema.optional(),
  updatedAt: z.string().datetime(),
});
export type ExecutionRecord = z.infer<typeof ExecutionRecordSchema>;

export const HarnessHealthSchema = z.object({
  harnessId: z.string().min(1),
  status: HarnessStatusSchema,
  lastCheckedAt: z.string().datetime(),
  successCount: z.number().int().nonnegative().default(0),
  failureCount: z.number().int().nonnegative().default(0),
  consecutiveFailures: z.number().int().nonnegative().default(0),
  lastFailure: ExecutionFailureSchema.optional(),
  cooldownUntil: z.string().datetime().optional(),
});
export type HarnessHealth = z.infer<typeof HarnessHealthSchema>;

export const ExecutionSnapshotSchema = z.object({
  version: z.number().int().positive(),
  missionId: z.string().min(1),
  executions: z.array(ExecutionRecordSchema).default([]),
  checkpoints: z.array(ExecutionCheckpointSchema).default([]),
  updatedAt: z.string().datetime(),
});
export type ExecutionSnapshot = z.infer<typeof ExecutionSnapshotSchema>;

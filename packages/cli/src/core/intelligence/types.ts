import { z } from 'zod';
import type { Mission, MissionEvidence, TaskCheckpoint, TaskNode } from '../mission/types.js';
import type { CoordinationSnapshot, ResourceRef, TaskProposal } from '../coordination/types.js';

export const IntelligenceModeSchema = z.enum(['DISABLED', 'ASSISTED', 'PLANNING', 'AUTONOMOUS']);
export type IntelligenceMode = z.infer<typeof IntelligenceModeSchema>;

export const DecisionActionSchema = z.enum([
  'DECOMPOSE', 'EXECUTE', 'REASSIGN', 'RETRY', 'PARALLELIZE', 'SEQUENCE',
  'REPLAN', 'VERIFY', 'CONTINUE', 'COMPLETE', 'ESCALATE', 'ABORT',
]);
export type DecisionAction = z.infer<typeof DecisionActionSchema>;

export const DecisionTriggerSchema = z.enum([
  'MISSION_CREATED', 'MISSION_BLOCKED', 'TASK_BLOCKED', 'TASK_FAILED',
  'TASK_COMPLETED', 'EXECUTION_FAILED', 'QUOTA_EXHAUSTED', 'WORKER_LOST',
  'VALIDATION_FAILED', 'PLAN_REJECTED', 'RESOURCE_CONFLICT',
  'CHECKPOINT_CREATED', 'PERIODIC_REVIEW', 'USER_REQUESTED', 'MISSION_NEAR_COMPLETION',
]);
export type DecisionTrigger = z.infer<typeof DecisionTriggerSchema>;

export const ExecutionStatusSchema = z.enum([
  'QUEUED', 'RUNNING', 'CHECKPOINTED', 'COMPLETED', 'FAILED',
  'CANCELLED', 'TIMED_OUT', 'INTERRUPTED',
]);
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;

export const FailureTypeSchema = z.enum([
  'RATE_LIMIT', 'QUOTA_EXHAUSTED', 'AUTH_REQUIRED', 'AUTH_FAILED',
  'HARNESS_NOT_FOUND', 'WORKER_UNAVAILABLE', 'WORKER_LOST', 'TIMEOUT',
  'CRASH', 'CONTEXT_LIMIT', 'INVALID_OUTPUT', 'VALIDATION_FAILED',
  'PERMISSION_DENIED', 'RESOURCE_CONFLICT', 'UNKNOWN',
]);
export type FailureType = z.infer<typeof FailureTypeSchema>;

export const TaskSummarySchema = z.object({
  id: z.string().min(1),
  parentTaskId: z.string().optional(),
  title: z.string(),
  state: z.string(),
  priority: z.string(),
  dependencies: z.array(z.string()),
  requiredCapabilities: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  owner: z.string().optional(),
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive().optional(),
});
export type TaskSummary = z.infer<typeof TaskSummarySchema>;

export const FailureContextSchema = z.object({
  id: z.string().min(1),
  type: FailureTypeSchema,
  taskId: z.string().optional(),
  executionId: z.string().optional(),
  harnessId: z.string().optional(),
  workerId: z.string().optional(),
  recoverable: z.boolean(),
  details: z.string(),
  timestamp: z.string().datetime(),
});
export type FailureContext = z.infer<typeof FailureContextSchema>;

export const JevDecisionSchema = z.object({
  decisionId: z.string().min(1),
  missionId: z.string().min(1),
  action: DecisionActionSchema,
  reasoning: z.string().default(''),
  targets: z.array(z.object({
    taskId: z.string().optional(),
    executionId: z.string().optional(),
    agentId: z.string().optional(),
    harnessId: z.string().optional(),
  })).default([]),
  assignments: z.array(z.object({
    taskId: z.string().min(1),
    agentId: z.string().optional(),
    harnessId: z.string().optional(),
    priority: z.number().int(),
  })).optional(),
  createdTasks: z.array(z.unknown()).optional(),
  dependencies: z.array(z.unknown()).optional(),
  requirements: z.array(z.string()).optional(),
  verification: z.record(z.unknown()).optional(),
  recovery: z.record(z.unknown()).optional(),
  conditions: z.array(z.record(z.unknown())).optional(),
  confidence: z.number().min(0).max(1).optional(),
  expectedOutcome: z.string().optional(),
  contextVersion: z.number().int().nonnegative().optional(),
  contextHash: z.string().optional(),
});
export type JevDecision = z.infer<typeof JevDecisionSchema>;

export interface DecisionContext {
  schemaVersion: '1.0';
  mission: {
    id: string;
    goal: string;
    status: string;
    projectId?: string;
    constraints: Record<string, unknown>;
    completionCriteria: unknown[];
    requirements: Record<string, unknown>;
    graphVersion: number;
  };
  project: {
    repository?: string;
    workspace: { workingDir: string };
    stack?: string[];
    relevantFiles: string[];
  };
  agents: {
    id: string;
    harness: string;
    capabilities: string[];
    status: string;
    health: string;
  }[];
  taskGraph: {
    version: number;
    tasks: TaskSummary[];
    dependencies: { from: string; to: string }[];
    readyTasks: string[];
    runningTasks: string[];
    blockedTasks: string[];
    completedTasks: string[];
    failedTasks: string[];
  };
  coordination: {
    conflicts: CoordinationSnapshot['conflicts'];
    activeReservations: CoordinationSnapshot['reservations'];
    activeLeases: CoordinationSnapshot['resourceLeases'];
    localPlans: CoordinationSnapshot['localPlans'];
  };
  executions: IntelligenceExecutionContext[];
  failures: FailureContext[];
  checkpoints: CheckpointContext[];
  evidence: EvidenceContext[];
  artifacts: { files: string[]; diffs: string[]; evidence: string[] };
  decisions: DecisionRecordSummary[];
  progress: MissionProgress;
  fleet?: {
    nodes: Array<{ nodeId: string; state: string; capabilities: string[]; activeTasks: number; maxConcurrentTasks: number; lastSeenAt: number }>;
    healthyNodeCount: number;
    capableNodeCount: number;
    activeAssignments: number;
    recoverableAssignments: number;
  };
  timestamp: string;
}

export interface IntelligenceExecutionContext {
  executionId: string;
  taskId: string;
  harnessId?: string;
  workerId?: string;
  status: ExecutionStatus | string;
  startedAt?: string;
  durationMs?: number;
  checkpointId?: string;
  metrics?: Record<string, number>;
}

export interface CheckpointContext {
  id: string;
  taskId: string;
  status: string;
  completedSteps: string[];
  remainingSteps: string[];
  artifacts: string[];
  evidenceIds: string[];
}

export interface EvidenceContext {
  id: string;
  taskId?: string;
  type: string;
  passed?: boolean;
  description: string;
  reference: string;
}

export interface MissionProgress {
  totalTasks: number;
  completedTasks: number;
  runningTasks: number;
  blockedTasks: number;
  failedTasks: number;
  readyTasks: number;
  completionRatio: number;
  progressSinceLastDecision: boolean;
}

export interface DecisionRecordSummary {
  decisionId: string;
  trigger: DecisionTrigger;
  action: DecisionAction;
  status: 'PROPOSED' | 'ACCEPTED' | 'REJECTED' | 'PARTIALLY_APPLIED' | 'FAILED';
  createdAt: string;
}

export interface JevProviderResponse {
  decision: JevDecision;
  provider: string;
  model?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; costUsd?: number };
  latencyMs: number;
}

export interface JevProvider {
  readonly id: string;
  decide(context: DecisionContext): Promise<JevProviderResponse>;
  health(): Promise<{ healthy: boolean; error?: string }>;
}

export interface LayaRequest {
  missionId: string;
  objective: string;
  parentTaskId?: string;
  context: {
    missionGoal: string;
    constraints: Record<string, unknown>;
    existingTasks: TaskSummary[];
    dependencies: { from: string; to: string }[];
    resources: ResourceRef[];
    acceptanceCriteria: string[];
  };
  planningPolicy: PlanningPolicy;
}

export interface LayaPlan {
  planId: string;
  missionId: string;
  parentTaskId?: string;
  objective: string;
  tasks: TaskProposal[];
  dependencies: { fromProposalId: string; toProposalId: string }[];
  assumptions: string[];
  risks: string[];
  createdAt: string;
}

export interface LayaModelAdapter {
  readonly id: string;
  load(): Promise<void>;
  unload(): Promise<void>;
  generate(request: LayaRequest): Promise<LayaPlan>;
  health(): Promise<{ healthy: boolean; error?: string }>;
}

export interface PlanningPolicy {
  maxDepth: number;
  maxTasksPerPlan: number;
  maxTotalTasks: number;
  maxDependencyEdges: number;
  maxPlanRevisions: number;
}

export interface IntelligencePolicy {
  allowAutonomousExecution: boolean;
  allowReplanning: boolean;
  allowParallelization: boolean;
  allowTaskCreation: boolean;
  allowTaskCancellation: boolean;
  requireApprovalFor: DecisionAction[];
  maxRetriesPerTask: number;
  maxReplansPerTask: number;
  maxStrategicEscalationsPerTask: number;
}

export interface DecisionBudget {
  maxDecisions?: number;
  maxCostUsd?: number;
  maxTokens?: number;
  decisionsUsed: number;
  estimatedCostUsd: number;
  tokensUsed: number;
}

export interface LayaBudget {
  maxInferenceTokens?: number;
  maxPlanningTimeMs?: number;
  maxPlanDepth: number;
  maxTasksPerPlan: number;
  maxRevisions: number;
}

export interface IntelligenceConfig {
  mode: IntelligenceMode;
  jev: { enabled: boolean; provider: string; timeoutMs: number; maxRetries: number };
  laya: { enabled: boolean; runtime: string; model: string; timeoutMs: number };
  policies: IntelligencePolicy;
  planning: PlanningPolicy;
  budgets: { jev: DecisionBudget; laya: LayaBudget };
  loop: { maxIterations: number; maxReplans: number; stagnationThreshold: number };
}

export interface DecisionEvaluation {
  accepted: boolean;
  decision?: JevDecision;
  reasons: string[];
  stale: boolean;
}

export interface DecisionRecord {
  decisionId: string;
  missionId: string;
  trigger: DecisionTrigger;
  contextVersion: number;
  contextHash: string;
  provider: string;
  model?: string;
  usage?: JevProviderResponse['usage'];
  decision: JevDecision;
  status: DecisionRecordSummary['status'];
  rejectionReason?: string;
  appliedActions: string[];
  createdAt: string;
}

export interface StrategicLoopState {
  iterations: number;
  decisions: number;
  replans: number;
  consecutiveNoProgress: number;
}

export interface IntelligenceSnapshot {
  mission: Mission;
  tasks: TaskNode[];
  checkpoints: TaskCheckpoint[];
  evidence: MissionEvidence[];
}

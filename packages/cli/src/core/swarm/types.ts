export type SwarmAgentRole = 'planner' | 'executor' | 'validator' | 'optimizer' | 'researcher' | 'critic';

export type Lifecycle = 'persistent' | 'ephemeral';

export type ControlMode = 'manual' | 'guided' | 'auto';

export type ExecutionStrategy = 'sequential' | 'pipeline' | 'parallel' | 'competitive' | 'iterative' | 'hierarchical' | 'adaptive';

export type SwarmMessageType =
  | 'plan'
  | 'task'
  | 'claim'
  | 'progress'
  | 'result'
  | 'feedback'
  | 'decision'
  | 'request'
  | 'alert'
  | 'heartbeat'
  | 'checkpoint'
  | 'rollback'
  | 'ack'
  | 'sync-request'
  | 'sync-response'
  | 'state-sync'
  | 'nack';

export type FailureType = 'timeout' | 'error' | 'invalid-output' | 'model-unavailable' | 'cost-exceeded' | 'unresponsive';

export type HealingAction = 'retry-same' | 'retry-different-model' | 'replace-agent' | 'escalate-to-operator' | 'skip-subtask' | 'terminate';

export type TaskComplexity = 'low' | 'medium' | 'high' | 'critical';

export type TaskDomain = 'coding' | 'reasoning' | 'planning' | 'research' | 'review' | 'data-analysis';

export type AmbiguityLevel = 'clear' | 'moderate' | 'high';

export interface TaskAnalysis {
  complexity: TaskComplexity;
  domains: TaskDomain[];
  decomposable: boolean;
  estimatedSteps: number;
  requiresIteration: boolean;
  ambiguityLevel: AmbiguityLevel;
}

export interface Task {
  id: string;
  description: string;
  constraints?: Record<string, unknown>;
}

export interface AgentConstraints {
  maxRetries: number;
  perAgentTimeoutMs: number;
  maxTokensPerCall: number;
}

export interface SpawnedAgent {
  id: string;
  role: SwarmAgentRole;
  assignedModel: string;
  priority: number;
  lifecycle: Lifecycle;
  parentTask: string;
  constraints: AgentConstraints;
  status: AgentStatus;
  costSoFar: number;
  tokensIn: number;
  tokensOut: number;
  lastHeartbeat: number;
  failureCount: number;
}

export type AgentStatus = 'idle' | 'working' | 'paused' | 'waiting' | 'failed' | 'recovering' | 'terminated';

export interface ModelAllocation {
  model: string;
  reason: string;
  estimatedCostPerCall: number;
  fallbackChain: string[];
}

export interface SwarmMessage {
  id: string;
  type: SwarmMessageType;
  from: string;
  to: string | '*';
  payload: unknown;
  timestamp: number;
  causalParent?: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  topic?: string;
  requiresAck?: boolean;
  retryCount?: number;
  maxRetries?: number;
  vectorClock?: Record<string, number>;
  causalRank?: number;
  synced?: boolean;
  syncedTo?: string[];
  summarized?: boolean;
}

export interface Subtask {
  id: string;
  description: string;
  status: 'unclaimed' | 'claimed' | 'in-progress' | 'completed' | 'failed' | 'blocked';
  claimedBy?: string;
  parentTaskId: string;
  priority: number;
  result?: unknown;
  error?: string;
  attempts: number;
}

export interface TaskPlan {
  taskId: string;
  subtasks: Subtask[];
  createdAt: number;
  createdBy: string;
}

export interface Decision {
  id: string;
  type: 'strategy' | 'model' | 'healing' | 'operator' | 'agent';
  description: string;
  reasoning: string;
  timestamp: number;
  source: string;
  binding: boolean;
  resolved: boolean;
}

export interface FailureRecord {
  id: string;
  agentId: string;
  type: FailureType;
  error: string;
  timestamp: number;
  attemptNumber: number;
  recovered: boolean;
  healingAction?: HealingAction;
  relatedSubtask?: string;
}

export interface HealingStrategy {
  attempt: number;
  action: HealingAction;
  newModel?: string;
  reason: string;
}

export interface StrategyDecision {
  chosen: ExecutionStrategy;
  reasoning: string;
  fallbackStrategy: ExecutionStrategy;
  maxIterations?: number;
  competitorCount?: number;
}

export interface ProgressMetrics {
  ticksElapsed: number;
  subtasksCompleted: number;
  subtasksTotal: number;
  subtasksFailed: number;
  failureRate: number;
  validationPassRate: number;
  costSoFar: number;
  budgetRemaining: number;
}

export interface SwarmCheckpoint {
  tick: number;
  timestamp: number;
  agents: SpawnedAgent[];
  memory: unknown;
  strategy: StrategyDecision;
  pendingDecisions: Decision[];
}

export type ControlCommand =
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop'; force?: boolean }
  | { type: 'add-agent'; role: SwarmAgentRole }
  | { type: 'remove-agent'; agentId: string }
  | { type: 'change-model'; agentId: string; model: string }
  | { type: 'set-strategy'; strategy: ExecutionStrategy }
  | { type: 'set-mode'; mode: ControlMode }
  | { type: 'limit-cost'; maxCost: number }
  | { type: 'limit-agents'; maxAgents: number }
  | { type: 'inject-message'; message: Partial<SwarmMessage> }
  | { type: 'prioritize'; taskId: string; priority: number }
  | { type: 'approve'; decisionId: string }
  | { type: 'reject'; decisionId: string; reason: string }
  | { type: 'checkpoint'; checkpointId?: string }
  | { type: 'rollback'; checkpointId: string }
  | { type: 'query-status' }
  | { type: 'query-agents' }
  | { type: 'query-cost' }
  | { type: 'query-decisions' }
  | { type: 'inject-goal'; goal: string; priority?: number }
  | { type: 'blacklist-model'; model: string }
  | { type: 'whitelist-model'; model: string }
  | { type: 'set-rate-limit'; maxConcurrent: number }
  | { type: 'emergency-stop' };

export interface ControlResult {
  status: 'ok' | 'error' | 'pending';
  message?: string;
  data?: unknown;
}

export interface Violation {
  constraint: string;
  detail?: string;
  current?: number;
  limit?: number;
  projected?: number;
}

export interface GuardResult {
  allowed: boolean;
  violations?: Violation[];
  suggestion?: string;
}

export interface SwarmConstraints {
  maxAgents: number;
  maxCostUSD: number;
  maxTicks: number;
  maxParallelInferences: number;
  maxRetries: number;
  allowedModels: string[];
  forbiddenModels: string[];
  preferLocalModels: boolean;
  requireValidation: boolean;
  requirePlanApproval: boolean;
  maxAutonomousDecisions: number;
  noFileSystemWrites: boolean;
  noNetworkCalls: boolean;
  sandboxExecution: boolean;
  maxWallClockSeconds: number;
  perAgentTimeoutSeconds: number;
  perAgentCostLimit: number;
}

export interface SwarmControlState {
  paused: boolean;
  mode: ControlMode;
  activeConstraints: SwarmConstraints;
  pendingDecisions: Decision[];
}

export interface SwarmConfig {
  constraints: SwarmConstraints;
  mode: ControlMode;
  strategy: ExecutionStrategy;
  task: Task;
}

export interface SwarmResult {
  status: 'completed' | 'failed' | 'timeout' | 'stopped-by-operator' | 'partial';
  outputs: unknown[];
  cost: number;
  ticksElapsed: number;
  wallTimeMs: number;
  agents: SpawnedAgent[];
  decisions: Decision[];
  failures: FailureRecord[];
  checkpoints: SwarmCheckpoint[];
  budgetRemaining: number;
}

export interface ModelPerformanceRecord {
  model: string;
  role: SwarmAgentRole;
  successRate: number;
  avgLatencyMs: number;
  avgCostPerCall: number;
  totalCalls: number;
}

export interface AuditEntry {
  timestamp: number;
  source: 'operator' | 'system' | 'agent';
  type: string;
  details: Record<string, unknown>;
}

export interface Summary {
  id: string;
  content: string;
  preserves: 'decisions' | 'dependencies' | 'references';
  references: string[];
  summarizedMessageIds: string[];
  summarizedCount: number;
  summarizedTimeRange: { earliest: number; latest: number };
  dependencyChains: string[];
  decisions: string[];
  unresolvedIssues: string[];
  referencedArtifacts: string[];
}

export interface AckMessage {
  originalMessageId: string;
  from: string;
  timestamp: number;
}

export interface SyncRequest {
  type: 'sync-request' | 'sync-response' | 'ack' | 'nack';
  vectorClock: Record<string, number>;
  knownMessageIds: string[];
  missingMessages?: SwarmMessage[];
  memorySnapshot?: Record<string, unknown>;
  requestId?: string;
}

export interface ConflictVersion {
  version: number;
  node: string;
  value: unknown;
  vectorClock: Record<string, number>;
  timestamp: number;
}

export interface MemoryEntry<T = unknown> {
  key: string;
  value: T;
  version: number;
  timestamp: number;
  agentId: string;
  role?: SwarmAgentRole;
  tags?: string[];
  metadata?: Record<string, unknown>;
  vectorClock: Record<string, number>;
  conflicts?: ConflictVersion[];
}

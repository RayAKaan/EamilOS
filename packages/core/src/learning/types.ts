import type { SwarmAgentRole, ExecutionStrategy, TaskDomain } from '../swarm/types.js';

export type { SwarmAgentRole, ExecutionStrategy, TaskDomain };

export interface ModelContext {
  taskDomains: string[];
  taskComplexity: 'low' | 'medium' | 'high' | 'critical';
  controlMode: 'manual' | 'guided' | 'auto';
  sessionId?: string;
}

export interface ExecutionRecord {
  id: string;
  timestamp: number;
  sessionId: string;
  goal: string;
  taskType: TaskDomain;
  taskComplexity: 'low' | 'medium' | 'high' | 'critical';
  taskDomains: string[];
  strategy: ExecutionStrategy;
  agentsUsed: AgentRecord[];
  modelsUsed: string[];
  controlMode: 'manual' | 'guided' | 'auto';
  success: boolean;
  partialSuccess: boolean;
  subtaskResults: SubtaskResult[];
  totalLatencyMs: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUSD: number;
  tickCount: number;
  retryCount: number;
  failureCount: number;
  healingActions: HealingAction[];
  modelSwaps: ModelSwap[];
  strategyAdaptations: StrategyChange[];
  errors: ErrorRecord[];
  promptVariantsUsed: PromptUsage[];
}

export interface AgentRecord {
  agentId: string;
  role: SwarmAgentRole;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUSD: number;
  latencyMs: number;
  success: boolean;
  retries: number;
}

export interface SubtaskResult {
  subtaskId: string;
  description: string;
  assignedAgent: string;
  model: string;
  success: boolean;
  attempts: number;
  latencyMs: number;
  validationPassed: boolean;
}

export interface ErrorRecord {
  agentId: string;
  model: string;
  errorType: ErrorType;
  errorMessage: string;
  timestamp: number;
  resolved: boolean;
  resolution?: string;
}

export type ErrorType = 
  | 'timeout' 
  | 'api_error' 
  | 'invalid_output' 
  | 'validation_failure' 
  | 'rate_limit' 
  | 'context_overflow' 
  | 'unknown';

export interface HealingAction {
  agentId: string;
  failureType: string;
  action: 'retry-same' | 'retry-different-model' | 'replace-agent' | 'escalate';
  success: boolean;
  newModel?: string;
}

export interface ModelSwap {
  agentId: string;
  fromModel: string;
  toModel: string;
  reason: 'healing' | 'operator' | 'optimization';
  timestamp: number;
}

export interface StrategyChange {
  from: ExecutionStrategy;
  to: ExecutionStrategy;
  reason: string;
  timestamp: number;
}

export interface PromptUsage {
  agentId: string;
  variantId: string;
  promptText: string;
}

export interface ModelProfile {
  modelId: string;
  global: ModelMetrics;
  byRole: Map<SwarmAgentRole, ModelMetrics>;
  byTaskDomain: Map<TaskDomain, ModelMetrics>;
  byComplexity: Map<string, ModelMetrics>;
  availability: AvailabilityMetrics;
  lastUsed: number;
  firstSeen: number;
  usageCount: number;
  costProfile: CostMetrics;
}

export interface ModelMetrics {
  sampleSize: number;
  confidence: ConfidenceLevel;
  successRate: number;
  successRateCI: [number, number];
  avgLatencyMs: number;
  medianLatencyMs: number;
  p95LatencyMs: number;
  avgTokensIn: number;
  avgTokensOut: number;
  tokenEfficiency: number;
  avgRetries: number;
  trend: 'improving' | 'stable' | 'degrading';
}

export interface AvailabilityMetrics {
  uptimeRate: number;
  rateLimitRate: number;
  avgResponseTime: number;
  lastDowntime?: number;
  consecutiveFailures: number;
}

export interface CostMetrics {
  avgCostPerCall: number;
  avgCostPerSuccessfulCall: number;
  costPer1kTokensIn: number;
  costPer1kTokensOut: number;
}

export interface StrategyProfile {
  strategy: ExecutionStrategy;
  global: StrategyMetrics;
  byTaskDomain: Map<TaskDomain, StrategyMetrics>;
  byComplexity: Map<string, StrategyMetrics>;
  byTeamSize: Map<string, StrategyMetrics>;
}

export interface StrategyMetrics {
  sampleSize: number;
  confidence: ConfidenceLevel;
  successRate: number;
  successRateCI: [number, number];
  avgLatencyMs: number;
  avgCostUSD: number;
  avgTicks: number;
  avgRetries: number;
  adaptationRate: number;
  trend: 'improving' | 'stable' | 'degrading';
}

export interface PromptVariant {
  id: string;
  basePromptHash: string;
  promptText: string;
  enrichmentsApplied: EnrichmentType[];
  generation: number;
  parentVariantId?: string;
  role: SwarmAgentRole;
  taskType: TaskDomain;
  model: string;
  usageCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  successRateCI: [number, number];
  avgTokensOut: number;
  createdAt: number;
  lastUsed: number;
  retired: boolean;
}

export type EnrichmentType = 
  | 'specificity' 
  | 'constraint_addition' 
  | 'chain_of_thought' 
  | 'failure_context' 
  | 'example_addition' 
  | 'role_framing' 
  | 'output_format' 
  | 'negative_examples';

export interface TrendIndicator {
  slope: number;
  direction: 'improving' | 'stable' | 'decreasing' | 'increasing' | 'declining';
}

export interface ModelPerformanceMetrics {
  modelId: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  avgLatencyMs: number;
  avgCostUSD: number;
  avgTokensIn: number;
  avgTokensOut: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  successRate: number;
  successRateCI: { lower: number; upper: number };
  costPerSuccess: number;
  throughput: number;
  reliabilityScore: number;
  qualityScore: number;
  efficiencyScore: number;
  overallScore: number;
  lastUpdated: number;
  sampleSize: number;
  latencyTrend: TrendIndicator;
  successTrend: TrendIndicator;
}

export interface ContextualScore {
  modelId: string;
  context: string;
  rawScore: number;
  adjustedScore: number;
  confidence: number;
  sampleSize: number;
  isFallback: boolean;
}

export interface PerformanceSnapshot {
  timestamp: number;
  models: ModelPerformanceMetrics[];
  totalExecutions: number;
  averageSuccessRate: number;
}

export interface FailurePattern {
  id: string;
  errorType: ErrorType;
  errorSignature: string;
  occurrenceCount: number;
  firstSeen: number;
  lastSeen: number;
  frequency: 'rare' | 'occasional' | 'frequent' | 'systematic';
  correlatedModels: Map<string, number>;
  correlatedRoles: Map<SwarmAgentRole, number>;
  correlatedTaskDomains: Map<TaskDomain, number>;
  correlatedStrategies: Map<string, number>;
  rootCauseHypothesis: string;
  recommendedActions: Action[];
  status: 'active' | 'mitigated' | 'resolved';
  mitigationApplied?: string;
}

export type Action = 
  | { type: 'avoid-model'; model: string; duration: number; reason: string }
  | { type: 'switch-strategy'; from: string; to: string; reason: string }
  | { type: 'enrich-prompt'; enrichment: EnrichmentType; reason: string }
  | { type: 'adjust-timeout'; multiplier: number; reason: string }
  | { type: 'add-agent-role'; role: SwarmAgentRole; reason: string }
  | { type: 'alert-operator'; message: string; severity: 'info' | 'warning' | 'critical' };

export interface TunableParameters {
  agentTimeoutMs: number;
  tickIntervalMs: number;
  heartbeatIntervalMs: number;
  maxRetriesPerAgent: number;
  retryBackoffMultiplier: number;
  maxParallelInferences: number;
  maxParallelAgents: number;
  contextWindowUtilization: number;
  checkpointIntervalTicks: number;
}

export interface ParameterBounds {
  min: number;
  max: number;
  stepSize: number;
  currentValue: number;
  direction: 'increase' | 'decrease' | 'hold';
  confidenceInDirection: number;
}

export interface TuningObservation {
  params: Partial<TunableParameters>;
  success: boolean;
  latencyMs: number;
  retries: number;
  cost: number;
  timeoutCount: number;
  timestamp: number;
}

export interface ScoredModel {
  modelId: string;
  totalScore: number;
  components: {
    effectiveness: number;
    speed: number;
    costEfficiency: number;
    reliability: number;
    exploration: number;
    penalty: number;
  };
  explanation: string;
  confidence: ConfidenceLevel;
  fallbackChain: string[];
}

export interface StrategyDecision {
  chosen: ExecutionStrategy;
  reasoning: string;
  fallbackStrategy: ExecutionStrategy;
  maxIterations?: number;
  competitorCount?: number;
  source: 'learned' | 'heuristic-fallback';
  confidence?: ConfidenceLevel;
}

export interface AggregateStats {
  sampleSize: number;
  confidence: ConfidenceLevel;
  successRate: number;
  successRateRaw: number;
  successRateCI: [number, number];
  avgLatencyMs: number;
  medianLatencyMs: number;
  p95LatencyMs: number;
  avgRetries: number;
  avgCostUSD: number;
  avgTokens: number;
  trend: 'improving' | 'stable' | 'degrading';
}

export interface StatsFilter {
  taskType?: string;
  model?: string;
  strategy?: string;
  sinceTimestamp?: number;
  lastN?: number;
}

export interface CompactionSummary {
  recordCount: number;
  timeRange: [number, number];
  aggregateStats: AggregateStats;
}

export interface FailureReport {
  totalPatternsDetected: number;
  activePatternsCount: number;
  systematicPatterns: FailurePattern[];
  frequentPatterns: FailurePattern[];
  topModelsWithFailures: Array<{ model: string; count: number }>;
  recommendations: Action[];
}

export interface FeedbackReport {
  executionId: string;
  processingTimeMs: number;
  modelUpdates: unknown[];
  strategyInsights: unknown[];
  promptEvolutions: unknown[];
  failurePatternsDetected: FailureReport;
  parameterAdjustments: unknown;
  actionsApplied: Array<{ applied: boolean; source: string; reason?: string }>;
  actionsPending: Array<{ applied: boolean; source: string; reason?: string }>;
  systemMetrics: {
    totalExecutions: number;
    overallSuccessRate: number;
    successTrend: string;
    avgLatencyTrend: string;
    avgCostTrend: string;
  };
}

export type ConfidenceLevel = 'none' | 'low' | 'medium' | 'high';

export interface LearningConfig {
  storagePath?: string;
  maxRecords?: number;
  emaAlpha?: number;
  scoringWeights?: ScoringWeights;
  enabled?: boolean;
}

export interface ScoringWeights {
  effectiveness: number;
  speed: number;
  costEfficiency: number;
  reliability: number;
  exploration: number;
}

export interface TuningState {
  agentTimeoutMs: { current: number; default: number; min: number; max: number; direction: string; deviation: string };
  maxRetriesPerAgent: { current: number; default: number; min: number; max: number; direction: string; deviation: string };
  maxParallelInferences: { current: number; default: number; min: number; max: number; direction: string; deviation: string };
  contextWindowUtilization: { current: number; default: number; min: number; max: number; direction: string; deviation: string };
  checkpointIntervalTicks: { current: number; default: number; min: number; max: number; direction: string; deviation: string };
}

export const DEFAULT_LEARNING_CONFIG: LearningConfig = {
  storagePath: './.eamilos/learning',
  maxRecords: 10000,
  emaAlpha: 0.3,
  enabled: true,
};

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  effectiveness: 0.35,
  speed: 0.15,
  costEfficiency: 0.20,
  reliability: 0.15,
  exploration: 0.15,
};

export const DEFAULT_TUNABLE_PARAMS: TunableParameters = {
  agentTimeoutMs: 30000,
  tickIntervalMs: 100,
  heartbeatIntervalMs: 10000,
  maxRetriesPerAgent: 3,
  retryBackoffMultiplier: 1.5,
  maxParallelInferences: 4,
  maxParallelAgents: 8,
  contextWindowUtilization: 0.7,
  checkpointIntervalTicks: 10,
};

import { FailureType, StageName } from './stateful-types.js';

export interface PredictionSignals {
  sessionId: string;
  nodeId?: string;
  goal: string;
  goalEmbedding?: number[];
  failureType?: FailureType;
  failureStage?: StageName;
  targetModel: string;
  attempt: number;
  fileExtensions: string[];
  complexityScore: number;
  contextSimilarity?: number;
  previousStrategy?: string;
}

export interface HistoricalMatch {
  sessionId: string;
  nodeId: string;
  strategyUsed: string;
  outcome: 'success' | 'failed';
  similarity: number;
  failureType?: FailureType;
  targetModel: string;
  fileExtensions: string[];
  timeToCompleteMs?: number;
  timestamp: number;
}

export interface StrategyOption {
  id: string;
  label: string;
  strategy: string;
  action: () => Promise<void>;
  fallback?: () => Promise<void>;
}

export interface ScoredStrategy {
  id: string;
  label: string;
  strategy: string;
  reasoning: string;
  confidence: number;
  riskLevel: 'safe' | 'moderate' | 'high';
  dataPoints: number;
  historicalSuccessRate?: number;
  applied: boolean;
}

export type DecisionPolicy = 'auto' | 'enriched_hitl' | 'safe_fallback';

export interface PredictionResult {
  signals: PredictionSignals;
  strategies: ScoredStrategy[];
  recommendedStrategyId: string;
  recommendedStrategy: ScoredStrategy;
  policy: DecisionPolicy;
  reasoning: string;
  confidence: number;
  timestamp: number;
}

export interface ExecutionOutcome {
  id?: number;
  sessionId: string;
  nodeId: string;
  strategyUsed: string;
  failureType?: FailureType;
  targetModel: string;
  fileExtensions: string;
  outcome: 'success' | 'failed';
  timeToCompleteMs?: number;
  timestamp: number;
}

export interface OutcomeAggregation {
  strategyUsed: string;
  totalAttempts: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgTimeToCompleteMs?: number;
}

export interface PredictionConfig {
  autoThreshold: number;
  enrichedThreshold: number;
  coldStartBaseline: number;
  minDataPoints: number;
  historicalWeight: number;
  contextWeight: number;
  attemptPenalty: number;
  maxOutcomes: number;
  outcomeRetentionDays: number;
}

export const DEFAULT_PREDICTION_CONFIG: PredictionConfig = {
  autoThreshold: 0.75,
  enrichedThreshold: 0.40,
  coldStartBaseline: 0.35,
  minDataPoints: 5,
  historicalWeight: 0.6,
  contextWeight: 0.3,
  attemptPenalty: 0.1,
  maxOutcomes: 10000,
  outcomeRetentionDays: 90,
};

export const BUILT_IN_STRATEGIES: Array<{
  id: string;
  label: string;
  strategy: string;
  baseConfidence: number;
  riskLevel: 'safe' | 'moderate' | 'high';
  applicableFailureTypes: FailureType[];
}> = [
  {
    id: 'retry_standard',
    label: 'Retry with Standard Prompt',
    strategy: 'retry_standard',
    baseConfidence: 0.30,
    riskLevel: 'safe',
    applicableFailureTypes: ['format_error', 'schema_error', 'content_error'],
  },
  {
    id: 'retry_strict',
    label: 'Retry with Strict Prompt',
    strategy: 'retry_strict',
    baseConfidence: 0.40,
    riskLevel: 'safe',
    applicableFailureTypes: ['format_error', 'schema_error', 'content_error'],
  },
  {
    id: 'retry_decompose',
    label: 'Decompose and Retry Per-File',
    strategy: 'retry_decompose',
    baseConfidence: 0.45,
    riskLevel: 'moderate',
    applicableFailureTypes: ['content_error', 'schema_error'],
  },
  {
    id: 'switch_model',
    label: 'Switch to Alternative Model',
    strategy: 'switch_model',
    baseConfidence: 0.50,
    riskLevel: 'moderate',
    applicableFailureTypes: ['format_error', 'schema_error', 'content_error'],
  },
  {
    id: 'simplify_task',
    label: 'Simplify Task Scope',
    strategy: 'simplify_task',
    baseConfidence: 0.35,
    riskLevel: 'high',
    applicableFailureTypes: ['content_error', 'schema_error'],
  },
  {
    id: 'abort',
    label: 'Abort Execution',
    strategy: 'abort',
    baseConfidence: 0.90,
    riskLevel: 'safe',
    applicableFailureTypes: ['security_error'],
  },
];

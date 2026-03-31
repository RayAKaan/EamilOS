import type { ParsedFile, ParseResult as OriginalParseResult } from '../parsers/ResponseParser.js';

export type TaskCategory = 'code' | 'multi_file' | 'json' | 'reasoning' | 'simple' | 'refactor' | 'debug' | 'test' | 'documentation';

export type ParseResult = OriginalParseResult;

export interface FeatureContext {
  instruction: string;
  taskCategory: TaskCategory;
  taskComplexity: string;
  estimatedTokens: number;

  selectedModel: {
    modelId: string;
    provider: string;
    score: number;
  };
  alternateModels: Array<{
    modelId: string;
    provider: string;
    score: number;
  }>;
  availableModels: Array<{
    modelId: string;
    provider: string;
  }>;

  systemPrompt: string;
  userPrompt: string;
  promptMode: string;

  currentAttempt: number;
  maxRetries: number;
  totalTokensUsed: number;
  totalLatencyMs: number;

  executionResult?: {
    success: boolean;
    files: ParsedFile[];
    retriesUsed: number;
    latencyMs: number;
    tokensUsed: number;
    parseSucceeded: boolean;
    validationSucceeded: boolean;
    failureReason?: string;
  };

  featureData: Map<string, unknown>;

  signals: {
    skipExecution: boolean;
    overrideResult: ParseResult | null;
    forceRetry: boolean;
    abortExecution: boolean;
    abortReason?: string;
  };

  executionId: string;
  startTime: number;
  config: Record<string, unknown>;
}

export interface FeatureHooks {
  beforeClassification?(ctx: FeatureContext): Promise<void>;
  afterClassification?(ctx: FeatureContext): Promise<void>;
  afterModelSelection?(ctx: FeatureContext): Promise<void>;
  beforeExecution?(ctx: FeatureContext): Promise<void>;
  afterAttempt?(ctx: FeatureContext): Promise<void>;
  afterExecution?(ctx: FeatureContext): Promise<void>;
  onError?(ctx: FeatureContext, error: Error): Promise<void>;
}

export interface Feature extends FeatureHooks {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  enabled: boolean;
  initialize(config: Record<string, unknown>): Promise<void>;
  destroy?(): Promise<void>;
  getStatus(): FeatureStatus;
}

export interface FeatureStatus {
  id: string;
  enabled: boolean;
  initialized: boolean;
  health: 'healthy' | 'degraded' | 'failed';
  stats: Record<string, number | string | boolean>;
  lastActivity?: string;
  errors: string[];
}

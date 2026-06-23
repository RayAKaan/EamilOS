import { z } from "zod";

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.unknown()),
});

export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.record(z.unknown()),
});

export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export type ProviderType =
  | "local"
  | "api"
  | "openai-compatible"
  | "custom";

export interface ProviderCredentials {
  apiKey?: string;
  token?: string;
  headers?: Record<string, string>;
  organization?: string;
}

export interface CredentialSource {
  type: "env" | "config" | "keychain" | "inline";
  reference: string;
}

export interface ProviderConfig {
  id: string;
  type: ProviderType;
  engine?: string;
  baseUrl?: string;
  credentials?: {
    apiKey?: string;
    token?: string;
    headers?: Record<string, string>;
    organization?: string;
  };
  models?: string[];
  rateLimitRpm?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  stream?: boolean;
  tokenEstimate?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ChatResponse {
  content: string;
  model: string;
  usage: TokenUsage;
  durationMs: number;
  provider: string;
  finishReason?: string;
}

export interface ModelInfo {
  name: string;
  size?: string;
  quantization?: string;
  verified: boolean;
  tags?: string[];
  contextWindow?: number;
}

export interface ProviderCapabilities {
  chat: boolean;
  streaming: boolean;
  embeddings: boolean;
  functionCalling: boolean;
  maxContextLength?: number;
}

export interface ProviderIssue {
  severity: "fatal" | "warning" | "info";
  code: string;
  message: string;
  fix: string[];
  autoFixable: boolean;
}

export interface ProviderStatus {
  id: string;
  type: ProviderType;
  engine: string;
  available: boolean;
  latencyMs: number;
  issues: ProviderIssue[];
  models: ModelInfo[];
  capabilities: ProviderCapabilities;
  lastChecked: Date;
  score: number;
  successRate?: number;
  errorRate?: number;
  avgLatency?: number;
  totalRequests?: number;
}

export interface LLMProvider {
  readonly id: string;
  readonly type: ProviderType;
  readonly engine: string;

  chat(request: ChatRequest): Promise<ChatResponse>;
  listModels(): Promise<ModelInfo[]>;
  healthCheck(): Promise<ProviderStatus>;
  supportsModel(modelId: string): boolean;
}

export interface InitializationResult {
  providers: LLMProvider[];
  failed: ProviderStatus[];
  totalConfigured: number;
  totalAvailable: number;
}

export interface DetectedProvider extends ProviderConfig {
  autoDetected: boolean;
}

export interface ModelResolution {
  resolvedModel: string;
  resolvedProvider: string;
  source: "agent" | "task" | "fallback" | "config" | "auto";
}

export type ModelTag =
  | "coding"
  | "reasoning"
  | "fast"
  | "cheap"
  | "local"
  | "premium"
  | "multimodal"
  | "long-context"
  | "general"
  | "small"
  | "moe"
  | "chat"
  | "instruction"
  | "embedding";

export interface ModelMetadata {
  id: string;
  aliases: string[];
  provider: string;
  tags: ModelTag[];
  contextWindow: number;
  costTier: "free" | "cheap" | "moderate" | "premium";
  minRAM?: number;
  recommendedFor: string[];
  description: string;
}

export type FallbackStrategyType =
  | "specific-model"
  | "same-provider"
  | "any-local"
  | "any-api"
  | "any-available";

export interface FallbackStrategy {
  type: FallbackStrategyType;
  model?: string;
  preferTags?: ModelTag[];
}

export interface AgentConfig {
  id: string;
  role: string;
  model?: string;
  provider?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  retryAttempts?: number;
  fallbackChain?: FallbackStrategy[];
}

import { ContextSnapshot } from './multi-agent-types.js';

export type ProviderType = 'local' | 'api' | 'cli' | 'mcp';

export type ProviderCapability =
  | 'code_generation'
  | 'system_design'
  | 'reasoning'
  | 'documentation'
  | 'testing'
  | 'multi_file_edit'
  | 'code_review'
  | 'refactoring';

export type ProviderHealthStatus = 'healthy' | 'degraded' | 'offline';

export interface ProviderHealth {
  status: ProviderHealthStatus;
  avgLatencyMs: number;
  successRate: number;
  lastChecked: number;
}

export interface ExecutionRequest {
  taskId: string;
  prompt: string;
  contextSnapshot?: ContextSnapshot;
  constraints?: {
    maxTokens?: number;
    timeoutMs?: number;
    requiredCapabilities?: ProviderCapability[];
  };
}

export interface RawProviderOutput {
  providerId: string;
  rawText: string;
  exitCode?: number;
  metadata: {
    model: string;
    latencyMs: number;
    tokenUsage?: { input: number; output: number };
  };
}

export type OutputFormat = 'json' | 'markdown' | 'text' | 'unknown';

export interface NormalizedProviderOutput {
  providerId: string;
  sanitizedText: string;
  format: OutputFormat;
  extractedPayload?: unknown;
}

export interface ProviderRegistryEntry {
  id: string;
  name: string;
  type: ProviderType;
  capabilities: ProviderCapability[];
  driver: ProviderDriver;
  health: ProviderHealth;
  costWeight: number;
  isActive: boolean;
}

export interface ProviderDriver {
  id: string;
  name: string;
  type: ProviderType;
  capabilities: ProviderCapability[];

  initialize(config: Record<string, unknown>): Promise<void>;
  healthCheck(): Promise<ProviderHealth>;
  execute(request: ExecutionRequest): Promise<RawProviderOutput>;
  terminate(): Promise<void>;
}

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  capabilities: ProviderCapability[];
  config: Record<string, unknown>;
  costWeight: number;
}

export const DEFAULT_PROVIDER_CONFIGS: ProviderConfig[] = [
  {
    id: 'api:anthropic',
    name: 'Anthropic API',
    type: 'api',
    capabilities: ['code_generation', 'system_design', 'reasoning', 'documentation', 'testing', 'code_review', 'refactoring'],
    config: { model: 'claude-sonnet-4-20250514' },
    costWeight: 0.8,
  },
  {
    id: 'api:openai',
    name: 'OpenAI API',
    type: 'api',
    capabilities: ['code_generation', 'system_design', 'reasoning', 'documentation', 'testing'],
    config: { model: 'gpt-4o' },
    costWeight: 0.9,
  },
  {
    id: 'local:ollama',
    name: 'Ollama Local',
    type: 'local',
    capabilities: ['code_generation', 'reasoning', 'documentation'],
    config: { model: 'llama3', baseUrl: 'http://localhost:11434' },
    costWeight: 0.0,
  },
  {
    id: 'cli:claude',
    name: 'Claude CLI',
    type: 'cli',
    capabilities: ['code_generation', 'system_design', 'reasoning', 'documentation', 'testing', 'multi_file_edit', 'code_review', 'refactoring'],
    config: { command: 'claude' },
    costWeight: 0.1,
  },
];

export const ROLE_TO_CAPABILITIES: Record<string, ProviderCapability[]> = {
  architect: ['system_design', 'reasoning'],
  builder: ['code_generation', 'multi_file_edit'],
  validator: ['code_review', 'testing'],
  documenter: ['documentation'],
  tester: ['testing'],
  reviewer: ['code_review', 'refactoring'],
};

export function getCapabilitiesForRole(role: string): ProviderCapability[] {
  return ROLE_TO_CAPABILITIES[role] || ['code_generation'];
}
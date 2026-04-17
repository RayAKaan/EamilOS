import { ProviderDriver, ExecutionRequest, RawProviderOutput } from './provider-types.js';
import { AgentDefinition } from './multi-agent-types.js';
import { PredictionSignals } from './prediction-types.js';

export type PluginPermission =
  | 'read_context'
  | 'write_context'
  | 'execute_tool'
  | 'network_access'
  | 'filesystem_read'
  | 'filesystem_write';

export interface PluginHookContext {
  sessionId: string;
  goal: string;
  signals?: PredictionSignals;
  metadata: Record<string, unknown>;
}

export type HookResult = PluginHookContext | void;

export interface PluginHooks {
  onPreExecution?: (context: PluginHookContext) => HookResult;
  onPostValidation?: (result: unknown) => void;
  onTaskFailed?: (error: unknown) => void;
  onPreProviderExecute?: (request: ExecutionRequest) => ExecutionRequest;
  onPostProviderExecute?: (output: RawProviderOutput) => RawProviderOutput;
}

export interface PluginManifest {
  name: string;
  version: string;
  author: string;
  description: string;
  entry?: string;
  permissions: PluginPermission[];
  providers?: ProviderDriver[];
  agents?: AgentDefinition[];
  tools?: ToolDefinition[];
  hooks?: PluginHooks;
  capabilities?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  execute(input: unknown, context: ToolExecutionContext): Promise<unknown>;
}

export interface ToolExecutionContext {
  sessionId: string;
  taskId: string;
  logger: {
    info: (msg: string) => void;
    error: (msg: string) => void;
    warn: (msg: string) => void;
  };
  getContext: () => Record<string, unknown>;
}

export interface Tenant {
  id: string;
  name: string;
  quotas: TenantQuotas;
  installedPlugins: string[];
  createdAt: number;
}

export interface TenantQuotas {
  maxConcurrentTasks: number;
  maxApiCallsPerDay: number;
  maxStorageBytes: number;
}

export interface ApiKey {
  id: string;
  tenantId: string;
  keyHash: string;
  permissions: ApiKeyPermission[];
  createdAt: number;
  expiresAt?: number;
}

export type ApiKeyPermission = 'read' | 'execute' | 'admin';

export interface TenantConfig {
  id: string;
  name: string;
  quotas: TenantQuotas;
  installedPlugins: string[];
}

export const DEFAULT_TENANT_QUOTAS: TenantQuotas = {
  maxConcurrentTasks: 10,
  maxApiCallsPerDay: 10000,
  maxStorageBytes: 100 * 1024 * 1024,
};

export function createDefaultTenant(id: string, name: string): Tenant {
  return {
    id,
    name,
    quotas: DEFAULT_TENANT_QUOTAS,
    installedPlugins: [],
    createdAt: Date.now(),
  };
}

export type PluginStatus = 'active' | 'disabled' | 'crashed' | 'loading';

export interface PluginRegistration {
  name: string;
  version: string;
  manifest: PluginManifest;
  status: PluginStatus;
  loadedAt: number;
  workerId?: number;
}
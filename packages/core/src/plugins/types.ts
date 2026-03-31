import { Feature } from '../features/types.js';

export type PluginType =
  | "feature"
  | "agent"
  | "tool"
  | "hook"
  | "provider"
  | "formatter"
  | "composite";

export interface PluginPermissions {
  workspaceRead: boolean;
  workspaceWrite: boolean;
  filesystemRead: boolean;
  filesystemWrite: boolean;
  networkAccess: boolean;
  allowedHosts: string[];
  shellAccess: boolean;
  allowedCommands: string[];
  envAccess: boolean;
  allowedEnvVars: string[];
  metricsRead: boolean;
  metricsWrite: boolean;
  hookAccess: boolean;
  pluginInteraction: boolean;
}

export const DEFAULT_PERMISSIONS: PluginPermissions = {
  workspaceRead: false,
  workspaceWrite: false,
  filesystemRead: false,
  filesystemWrite: false,
  networkAccess: false,
  allowedHosts: [],
  shellAccess: false,
  allowedCommands: [],
  envAccess: false,
  allowedEnvVars: [],
  metricsRead: false,
  metricsWrite: false,
  hookAccess: false,
  pluginInteraction: false,
};

export interface PluginManifest {
  id: string;
  version: string;
  name: string;
  description: string;
  author: string;
  license: string;
  type: PluginType;
  entry: string;
  coreVersion: string;
  permissions: PluginPermissions;
  dependencies?: string[];
  conflicts?: string[];
  configSchema?: Record<string, {
    type: "string" | "number" | "boolean" | "array" | "object";
    default?: unknown;
    description: string;
    required?: boolean;
  }>;
  riskLevel?: "safe" | "moderate" | "elevated" | "dangerous";
}

export interface PluginHealthStatus {
  healthy: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface EamilOSPlugin {
  readonly id: string;
  readonly type: PluginType;
  register(ctx: PluginContext, config: Record<string, unknown>): Promise<void>;
  unregister?(): Promise<void>;
  healthCheck?(): Promise<PluginHealthStatus>;
}

export interface PluginContext {
  registerFeature(feature: Feature): void;
  registerAgent(agent: AgentDefinition): void;
  registerTool(tool: PluginToolDefinition): void;
  registerHook(event: PluginEvent, handler: PluginEventHandler): void;
  registerCommand(command: PluginCommand): void;
  registerProvider(provider: ProviderDefinition): void;
  readWorkspaceFile(relativePath: string): Promise<string>;
  writeWorkspaceFile(relativePath: string, content: string): Promise<void>;
  listWorkspaceFiles(directory?: string): Promise<string[]>;
  httpRequest(url: string, options: HttpRequestOptions): Promise<HttpResponse>;
  getModelMetrics(modelId: string): Promise<ModelMetrics | null>;
  getAllModelMetrics(): Promise<ModelMetrics[]>;
  log(level: "debug" | "info" | "warn" | "error", message: string, data?: Record<string, unknown>): void;
  getStorage(): PluginStorage;
  getCoreVersion(): string;
  getConfig(): Record<string, unknown>;
  getInstalledPlugins(): PluginInfo[];
}

export interface PluginStorage {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
  clear(): Promise<void>;
}

export type PluginEvent =
  | "system.startup"
  | "system.shutdown"
  | "task.received"
  | "task.classified"
  | "model.selected"
  | "execution.started"
  | "execution.attempt"
  | "execution.succeeded"
  | "execution.failed"
  | "execution.completed"
  | "artifact.created"
  | "artifact.validated"
  | "model.blacklisted"
  | "model.restored"
  | "plugin.loaded"
  | "plugin.unloaded"
  | "config.changed";

export type PluginEventHandler = (data: Record<string, unknown>) => Promise<void> | void;

export interface PluginCommand {
  name: string;
  description: string;
  args?: Array<{
    name: string;
    description: string;
    required: boolean;
    type: "string" | "number" | "boolean";
  }>;
  handler: (args: Record<string, unknown>) => Promise<void>;
}

export interface HttpRequestOptions {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  body?: string | Record<string, unknown>;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  handler: (instruction: string, context: Record<string, unknown>) => Promise<unknown>;
}

export interface PluginToolDefinition {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, {
    type: string;
    description: string;
    required: boolean;
  }>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  models: string[];
  generate: (options: {
    model: string;
    system: string;
    prompt: string;
  }) => Promise<string>;
}

export interface PluginInfo {
  id: string;
  version: string;
  name: string;
  type: PluginType;
  enabled: boolean;
  riskLevel: string;
}

export interface ModelMetrics {
  modelId: string;
  provider: string;
  successRate: number;
  averageLatency: number;
  totalRequests: number;
  totalTokens: number;
  lastUsed: string;
  costEstimate: number;
}

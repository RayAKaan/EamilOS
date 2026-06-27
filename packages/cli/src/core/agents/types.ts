export type AgentKind = 'cli' | 'api' | 'local' | 'plugin';

export type AgentMode = 'communication' | 'execution';

export type AgentStatus =
  | 'available'
  | 'not_installed'
  | 'auth_missing'
  | 'auth_failed'
  | 'quota_limited'
  | 'unavailable';

export interface AgentCapabilities {
  codeGeneration: boolean;
  fileEditing: boolean;
  commandExecution: boolean;
  webResearch: boolean;
  longContext: boolean;
  local: boolean;
  cloud: boolean;
  multimodal: boolean;
}

export interface RegisteredAgent {
  id: string;
  name: string;
  kind: AgentKind;
  provider: string;
  status: AgentStatus;
  version?: string;
  capabilities: AgentCapabilities;
  supportedModes: AgentMode[];
  priority: number;
  error?: string;
}

export type AgentErrorType =
  | 'not_installed'
  | 'auth_missing'
  | 'auth_failed'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'token_limit'
  | 'timeout'
  | 'invalid_output'
  | 'permission_denied'
  | 'crash'
  | 'unknown';

export interface AgentRequest {
  id: string;
  sessionId: string;
  prompt: string;
  systemPrompt: string;
  mode: AgentMode;
  workingDir: string;
  timeoutMs: number;
  context?: Record<string, unknown>;
  onOutput?: (chunk: string) => void;
}

export interface ProposedFileChange {
  path: string;
  action: 'create' | 'modify' | 'delete';
  content?: string;
  diff?: string;
  sourceAgentId: string;
}

export interface AgentResponse {
  agentId: string;
  success: boolean;
  content: string;
  fileChanges: ProposedFileChange[];
  rawOutput?: string;
  error?: string;
  errorType?: AgentErrorType;
  tokensUsed?: number;
  costUsd?: number;
  durationMs: number;
}

export interface EamilOSAgent {
  id: string;
  name: string;
  kind: AgentKind;
  capabilities: AgentCapabilities;

  checkStatus(): Promise<RegisteredAgent>;
  run(request: AgentRequest): Promise<AgentResponse>;
  stop?(): Promise<void>;
}

export type ExecutionStrategy = 'single' | 'single-fallback' | 'fallback' | 'swarm' | 'manual';

import type { ExecutionPolicy } from '../policy/ExecutionPolicy.js';

export interface SessionConfig {
  goal: string;
  projectId: string;
  strategy: ExecutionStrategy;
  mode: AgentMode;
  policy?: ExecutionPolicy;
  workingDir: string;
  outputDir?: string;
  preferredAgent?: string;
  preferredProvider?: string;
  preferredModel?: string;
  maxRetries?: number;
  timeoutMs?: number;
}

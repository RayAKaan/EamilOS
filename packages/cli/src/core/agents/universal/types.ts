export type UniversalAgentKind = 'cli' | 'binary' | 'python' | 'node' | 'container' | 'harness' | 'api' | 'remote';
export type AgentProtocol = 'pty' | 'stdio' | 'json-rpc' | 'http' | 'websocket' | 'acp' | 'mcp' | 'a2a';
export type InstallStrategy = 'existing' | 'npm' | 'pip' | 'uv' | 'brew' | 'binary' | 'github-release' | 'script' | 'provider' | 'manual';
export type IntegrationStatus = 'experimental' | 'supported' | 'verified' | 'production';

export interface UniversalCapabilities {
  codeGeneration: boolean; fileEditing: boolean; commandExecution: boolean; webResearch: boolean;
  browser: boolean; longContext: boolean; multimodal: boolean; planning: boolean; testing: boolean;
  debugging: boolean; refactoring: boolean; git: boolean; mcp: boolean; acp: boolean; a2a: boolean;
  subagents: boolean; interactive: boolean; nativeTui: boolean; headless: boolean; local: boolean;
  cloud: boolean; persistentSessions: boolean; resumeSessions: boolean; streaming: boolean;
  structuredOutput: boolean; sandboxing: boolean; remoteExecution: boolean;
}

export interface InstallationDefinition {
  strategy: InstallStrategy; package?: string; executable?: string; command?: string; args?: string[];
  platform?: Partial<Record<NodeJS.Platform, string>>; requires?: string[]; notes?: string;
}

export interface AuthenticationDefinition {
  methods: Array<'oauth' | 'api-key' | 'environment' | 'browser' | 'device-code' | 'config-file' | 'local-model' | 'none'>;
  environmentVariables?: string[]; notes?: string;
}

export interface UniversalAgentDefinition {
  id: string; name: string; provider: string; kind: UniversalAgentKind;
  integrationStatus: IntegrationStatus; protocols: AgentProtocol[]; platforms: NodeJS.Platform[];
  capabilities: UniversalCapabilities; installation: InstallationDefinition;
  authentication: AuthenticationDefinition; executableCandidates: string[];
  versionArgs: string[]; runArgs?: (prompt: string) => string[]; promptDelivery?: 'interactive-stdin' | 'argv' | 'env' | 'none'; promptEnv?: string;
  notes?: string; upstreamUrl?: string;
}

export interface AgentDetectionResult {
  id: string; installed: boolean; executable?: string; version?: string; error?: string;
}

export interface AgentHealthResult extends AgentDetectionResult {
  authenticated: boolean | 'unknown'; ready: boolean;
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
}

export interface AgentInstallationResult {
  id: string; success: boolean; changed: boolean; message: string; command?: string;
  skipped?: boolean; reason?: string;
}

export interface AgentDoctorOptions { deep?: boolean; timeoutMs?: number; }

export interface AgentInstallOptions { dryRun?: boolean; force?: boolean; timeoutMs?: number; }

export interface AgentRemovalResult { id: string; success: boolean; changed: boolean; message: string; command?: string; }

export interface UniversalAgentSession {
  id: string; agentId: string; terminalId: string; startedAt: number;
  status: 'starting' | 'running' | 'completed' | 'failed' | 'stopped';
}

export type NodeRole = 'controller' | 'worker';

export type ExecutionMode = 'local' | 'distributed' | 'hybrid';

export type RetryTier = 'same-node' | 'different-node' | 'local-fallback' | 'fail';

export interface NodeIdentity {
  id: string;
  name: string;
  role: NodeRole;
  version: string;
  startedAt: number;
}

export interface NodeCapabilities {
  cpuCores: number;
  totalRAMBytes: number;
  availableRAMBytes: number;
  gpus: GPUInfo[];
  providers: ProviderSummary[];
  models: ModelCapability[];
  maxConcurrentTasks: number;
  currentLoad: number;
  estimatedLatencyMs?: number;
  platform: string;
  arch: string;
}

export interface GPUInfo {
  name: string;
  vendor: string;
  memoryBytes: number;
  available: boolean;
  cudaVersion?: string;
}

export interface ProviderSummary {
  id: string;
  type: string;
  engine: string;
  available: boolean;
}

export interface ModelCapability {
  modelId: string;
  provider: string;
  loaded: boolean;
  estimatedTokensPerSecond?: number;
  maxContextLength?: number;
  tags?: string[];
  minRAMGB?: number;
  requiresGPU?: boolean;
}

export interface NodeStatus {
  identity: NodeIdentity;
  capabilities: NodeCapabilities;
  connectionState: ConnectionState;
  lastHeartbeat: number;
  activeTasks: ActiveTaskInfo[];
  score: number;
  metrics?: NodeMetrics;
  degraded?: boolean;
}

export type ConnectionState =
  | 'connecting'
  | 'authenticated'
  | 'ready'
  | 'busy'
  | 'draining'
  | 'disconnected'
  | 'rejected';

export interface ActiveTaskInfo {
  taskId: string;
  agentId: string;
  model: string;
  startedAt: number;
  estimatedCompletionMs?: number;
}

export interface NetworkConfig {
  worker?: {
    port: number;
    host: string;
    maxConcurrentTasks?: number;
    advertiseAddress?: string;
  };
  security: {
    sharedKey: string;
    sessionTimeoutMs: number;
    requireSignedMessages: boolean;
    allowedNodeIds?: string[];
    maxConnectionAttempts: number;
    banDurationMs: number;
    requireTLS?: boolean;
    tlsCertPath?: string;
    tlsKeyPath?: string;
    trustedFingerprints?: string[];
  };
  heartbeat: {
    intervalMs: number;
    timeoutMs: number;
    missedBeforeDisconnect: number;
    adaptive?: boolean;
    minTimeoutMs?: number;
    maxTimeoutMs?: number;
  };
  execution: {
    taskTimeoutMs: number;
    retryOnNodeFailure: boolean;
    maxTaskRetries: number;
    preferLocalExecution: boolean;
    mode: ExecutionMode;
    retryTiers?: RetryTier[];
  };
  connections?: {
    nodes: RemoteNodeConfig[];
  };
  compression?: {
    enabled: boolean;
    thresholdBytes?: number;
  };
}

export interface RemoteNodeConfig {
  address: string;
  name?: string;
  autoConnect: boolean;
}

export type NetworkMessageType =
  | 'auth:challenge'
  | 'auth:response'
  | 'auth:result'
  | 'capabilities:report'
  | 'capabilities:ack'
  | 'heartbeat:ping'
  | 'heartbeat:pong'
  | 'task:assign'
  | 'task:accepted'
  | 'task:rejected'
  | 'task:progress'
  | 'task:stream'
  | 'task:pause'
  | 'task:resume'
  | 'task:result'
  | 'task:error'
  | 'comms:sync'
  | 'comms:publish'
  | 'comms:artifact'
  | 'memory:snapshot'
  | 'memory:write'
  | 'control:drain'
  | 'control:shutdown'
  | 'control:disconnect';

export interface NetworkMessage {
  protocolVersion: number;
  messageId: string;
  timestamp: number;
  type: NetworkMessageType;
  from: string;
  to: string;
  payload: unknown;
  signature?: string;
}

export interface AuthChallengePayload {
  challenge: string;
  controllerNodeId: string;
  protocolVersion: number;
}

export interface AuthResponsePayload {
  response: string;
  workerNodeId: string;
  workerName: string;
  protocolVersion: number;
}

export interface AuthResultPayload {
  accepted: boolean;
  reason?: string;
  sessionId?: string;
  sessionExpiresAt?: number;
}

export interface RemoteTaskPayload {
  taskId: string;
  agent: SerializedAgentConfig;
  task: SerializedTaskConfig;
  contextMessages: Array<{ role: string; content: string }>;
  executionConfig: {
    timeout: number;
    temperature?: number;
    maxTokens?: number;
  };
  priority?: TaskPriority;
}

export type TaskPriority = 'low' | 'normal' | 'high';

export interface TaskStreamPayload {
  taskId: string;
  token: string;
  timestamp: number;
  isComplete?: boolean;
}

export interface TaskRejectedPayload {
  taskId: string;
  reason: 'capacity_full' | 'model_unavailable' | 'resource_constraint' | 'auth_failed';
  details?: string;
}

export interface SerializedAgentConfig {
  id: string;
  type: string;
  role: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

export interface SerializedTaskConfig {
  id: string;
  description: string;
  input: unknown;
  priority?: TaskPriority;
  partialOutput?: string;
  resumeFromToken?: number;
}

export interface RemoteTaskResult {
  success: boolean;
  taskId: string;
  nodeId: string;
  output?: string;
  error?: string;
  durationMs?: number;
  tokensUsed?: number;
  model?: string;
  fallbackToLocal?: boolean;
  commsMessages?: AgentMessage[];
  memoryWrites?: MemoryWrite[];
  artifacts?: Artifact[];
}

export interface AgentMessage {
  id: string;
  sender: string;
  recipient?: string;
  role: string;
  content: string;
  timestamp: number;
  type: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryWrite {
  key: string;
  value: unknown;
  type: string;
}

export interface Artifact {
  path: string;
  type: string;
  content: string;
  producedBy: string;
}

export interface WorkerConnection {
  socket: unknown;
  nodeId: string;
  sessionId: string;
  address: string;
  status: NodeStatus;
  connectedAt: number;
}

export interface NetworkCapacity {
  connectedNodes: number;
  readyNodes: number;
  totalModels: string[];
  totalGPUs: number;
  totalRAMBytes: number;
  totalTaskSlots: number;
  usedTaskSlots: number;
  availableTaskSlots: number;
}

export interface NodeSelection {
  nodeId: string | null;
  name?: string;
  score?: number;
  isLocal?: boolean;
  capabilities?: NodeCapabilities;
  reason?: string;
  availableModels?: string[];
  error?: Error;
}

export interface DistributionStats {
  totalDispatched: number;
  completed: number;
  failed: number;
  rerouted: number;
  pending: number;
  byNode: Record<string, number>;
}

export interface NetworkValidationResult {
  valid: boolean;
  issues: string[];
}

export interface PersistedTask {
  taskId: string;
  agentId: string;
  model: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  assignedNode: string;
  priority?: TaskPriority;
  timestamp: number;
  attempts: number;
  result?: RemoteTaskResult;
}

export interface TaskStoreConfig {
  persistPath?: string;
  autoSaveIntervalMs?: number;
}

export interface NodeMetrics {
  nodeId: string;
  successCount: number;
  failureCount: number;
  totalLatencyMs: number;
  lastLatencyMs: number;
  successRate: number;
  errorRate: number;
  avgLatencyMs: number;
  rollingLatencies: number[];
  lastUpdated: number;
}

export interface PartialResult {
  taskId: string;
  partialOutput: string;
  lastTokenIndex: number;
  timestamp: number;
  nodeId: string;
}

export interface TaskPausePayload {
  taskId: string;
  reason?: string;
}

export interface TaskResumePayload {
  taskId: string;
}

export type FabricNodeState =
  | 'joining' | 'online' | 'degraded' | 'draining' | 'offline' | 'rejected';

export interface FabricNodeIdentity {
  nodeId: string;
  name: string;
  publicKey: string;
  version: string;
  createdAt: number;
}

export interface FabricNodeCapabilities {
  platform: string;
  arch: string;
  cpuCores: number;
  totalRAMBytes: number;
  availableRAMBytes: number;
  gpus: Array<{ name: string; vendor: string; memoryBytes: number; available: boolean }>;
  harnesses: string[];
  models: string[];
  providers: string[];
  tools: string[];
  maxConcurrentTasks: number;
}

export interface FabricNodeRecord {
  identity: FabricNodeIdentity;
  capabilities: FabricNodeCapabilities;
  state: FabricNodeState;
  lastSeenAt: number;
  address?: string;
  activeTasks: number;
}

export interface FabricClusterState {
  clusterId: string;
  version: number;
  updatedAt: number;
  nodes: FabricNodeRecord[];
}

export type FabricMessageType =
  | 'cluster:hello' | 'cluster:welcome' | 'cluster:heartbeat'
  | 'cluster:capabilities' | 'cluster:leave' | 'cluster:state'
  | 'task:offer' | 'task:assignment' | 'task:progress'
  | 'task:result' | 'checkpoint:available';

export interface FabricMessage<T = unknown> {
  protocolVersion: 1;
  messageId: string;
  timestamp: number;
  type: FabricMessageType;
  from: string;
  to?: string;
  payload: T;
  signature: string;
}

export interface FabricHeartbeatPayload {
  state: FabricNodeState;
  capabilities: FabricNodeCapabilities;
  activeTasks: number;
}

export interface FabricClusterConfig {
  rootDir: string;
  clusterId: string;
  nodeName: string;
  eamilosVersion: string;
  heartbeatIntervalMs?: number;
  nodeTimeoutMs?: number;
  trustedPeers?: Array<{ nodeId: string; publicKey: string }>;
}

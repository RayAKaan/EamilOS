export type AgentStatus = 'ready' | 'busy' | 'offline';
export type ExecutionStrategy = 'opencode-first' | 'gemini-first' | 'parallel' | 'swarm';
export type MessageType = 'user' | 'opencode' | 'gemini' | 'system' | 'error' | 'graph-stats';
export type ToolStatus = 'pending' | 'running' | 'done' | 'failed';

export interface ToolCall {
  id: string;
  name: string;
  args: string;
  status: ToolStatus;
  result?: string;
  lines?: number;
}

export interface Message {
  id: string;
  type: MessageType;
  content: string;
  timestamp: number;
  tools?: ToolCall[];
  agent?: 'opencode' | 'gemini';
  isStreaming?: boolean;
}

export interface GraphStats {
  nodes: number;
  edges: number;
  strategy: ExecutionStrategy;
  duration?: number;
  toolsUsed?: number;
  validated?: boolean;
}

export interface AgentInfo {
  status: AgentStatus;
  version?: string;
  model?: string;
}

export interface AppState {
  messages: Message[];
  isRunning: boolean;
  currentStrategy: ExecutionStrategy;
  graphStats: GraphStats;
  agentStatus: {
    opencode: AgentInfo;
    gemini: AgentInfo;
  };
  lastPrompt: string;
  showGraphPanel: boolean;
  executionStart?: number;
  terminalWidth: number;
  terminalHeight: number;
}

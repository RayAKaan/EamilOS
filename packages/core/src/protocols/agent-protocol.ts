import type { Task } from '../schemas/task.js';

export type AgentCapability =
  | 'code-generation'
  | 'analysis'
  | 'reasoning'
  | 'writing'
  | 'terminal';

export interface AgentIdentity {
  id: string;
  name: string;
  type: 'ollama' | 'openai' | 'cli' | 'custom';
  capabilities: AgentCapability[];
  health: {
    status: 'healthy' | 'degraded' | 'unavailable';
    score: number;
    lastCheck: number;
  };
  metadata: Record<string, unknown>;
}

export interface AgentMessage {
  from: string;
  to?: string;
  sessionId?: string;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export type ExecutionResult = {
  success: boolean;
  output?: string;
  artifacts?: string[];
  error?: string;
  metadata?: Record<string, unknown>;
};

export type Context = Record<string, unknown>;

export interface IAgentProtocol {
  getIdentity(): AgentIdentity;
  execute(task: Task, context: Context): Promise<ExecutionResult>;
  communicate(message: AgentMessage): Promise<void>;
  getCapabilities(): AgentCapability[];
}

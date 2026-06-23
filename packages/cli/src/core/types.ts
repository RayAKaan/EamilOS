export * from './schemas/project.js';
export * from './schemas/task.js';
export * from './schemas/artifact.js';
export * from './schemas/agent.js';
export * from './schemas/event.js';
export * from './schemas/config.js';

export interface BudgetStatus {
  exceeded: boolean;
  warning: boolean;
  totalSpent: number;
  budgetLimit: number;
  percentageUsed: number;
  taskSpent: number;
  taskLimit: number;
}

export interface ProjectStatusInfo {
  total: number;
  completed: number;
  failed: number;
  inProgress: number;
  pending: number;
  allCompleted: boolean;
  hasFailures: boolean;
  hasInProgress: boolean;
}

export interface ContextSection {
  priority: number;
  label: string;
  content: string;
  required: boolean;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface ChatRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

export interface ChatResponse {
  content: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  usage: TokenUsage;
  latencyMs: number;
  model: string;
  finishReason: string;
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  artifacts: string[];
  output: string;
  startedAt: Date;
  completedAt: Date;
  modelCalls: number;
  costUsd: number;
  error?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
}

export type GraphNodeStatus = 'pending' | 'running' | 'done' | 'failed' | 'blocked';

export interface ExecutionNode {
  id: string;
  label: string;
  status: GraphNodeStatus;
  children: ExecutionNode[];
  reason?: string;
  metadata?: {
    attempt?: number;
    model?: string;
    cost?: number;
    duration?: number;
  };
  question?: AgentQuestion;
  blocked?: boolean;
  timestamp: number;
  updatedAt?: number;
}

export type SessionStatus = 'active' | 'completed' | 'failed' | 'abandoned';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  metadata?: Record<string, unknown>;
}

export interface Session {
  id: string;
  goal: string;
  status: SessionStatus;
  createdAt: number;
  lastUpdated: number;
  
  state: {
    executionTree: ExecutionNode;
    logs: LogEntry[];
    attempt: number;
    budgetUsed: number;
    constraints?: string[];
  };
  
  metadata: {
    modelPreference?: string;
    autoRetry?: boolean;
    maxAttempts?: number;
  };
}

export type QuestionType = 'choice' | 'text' | 'confirm';

export interface AgentQuestion {
  id: string;
  type: QuestionType;
  question: string;
  options?: string[];
  default?: string;
  required: boolean;
  timeout?: number;
  context?: string;
  nodeId?: string;
}

export interface AgentAnswer {
  questionId: string;
  answer: string;
  timestamp: number;
}

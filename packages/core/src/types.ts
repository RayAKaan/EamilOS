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
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
}

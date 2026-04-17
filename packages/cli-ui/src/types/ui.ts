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

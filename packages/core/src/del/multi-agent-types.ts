import { ClassifiedError } from './stateful-types.js';

export type AgentRole = 'architect' | 'builder' | 'validator' | 'documenter' | 'tester' | 'reviewer';

export interface AgentDefinition {
  role: AgentRole;
  preferredProvider: string;
  fallbackProvider?: string;
  capabilities: string[];
  phase5ProfileId?: string;
}

export type TaskStatus = 'pending' | 'blocked' | 'running' | 'done' | 'failed' | 'cancelled';

export interface AgentTask {
  id: string;
  role: AgentRole;
  goal: string;
  dependsOn: string[];
  status: TaskStatus;
  assignedProvider?: string;
  outputContextKey?: string;
  error?: ClassifiedError;
  result?: unknown;
  startedAt?: number;
  completedAt?: number;
}

export interface TaskDAG {
  id: string;
  sessionId: string;
  rootGoal: string;
  tasks: Record<string, AgentTask>;
  status: 'decomposing' | 'ready' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  completedAt?: number;
}

export interface ContextSnapshot {
  version: number;
  dagId: string;
  state: Record<string, unknown>;
  contributors: Record<string, string[]>;
  timestamp: number;
}

export type OrchestrationEvent =
  | { type: 'DAG_CREATED'; dag: TaskDAG }
  | { type: 'TASK_STARTED'; taskId: string; provider: string }
  | { type: 'TASK_COMPLETED'; taskId: string; contextVersion: number }
  | { type: 'TASK_FAILED'; taskId: string; error: ClassifiedError; recoverable: boolean }
  | { type: 'TASK_CANCELLED'; taskId: string; reason: string }
  | { type: 'DAG_COMPLETED'; dagId: string; finalContextVersion: number }
  | { type: 'DAG_FAILED'; dagId: string; reason: string }
  | { type: 'CONTEXT_MERGED'; version: number; contributors: string[] }
  | { type: 'CONTEXT_CONFLICT'; keys: string[]; requiringResolution: boolean };

export interface DAGExecutionResult {
  dagId: string;
  status: 'completed' | 'failed' | 'cancelled';
  finalContext: ContextSnapshot;
  completedTasks: string[];
  failedTasks: string[];
  cancelledTasks: string[];
  totalDurationMs: number;
}

export interface MultiAgentConfig {
  maxParallelAgents: number;
  taskTimeoutMs: number;
  enableCycleDetection: boolean;
  enableContextVersioning: boolean;
  abortOnCriticalFailure: boolean;
  agentDefinitions: AgentDefinition[];
}

export const DEFAULT_MULTI_AGENT_CONFIG: MultiAgentConfig = {
  maxParallelAgents: 4,
  taskTimeoutMs: 120000,
  enableCycleDetection: true,
  enableContextVersioning: true,
  abortOnCriticalFailure: true,
  agentDefinitions: [
    { role: 'architect', preferredProvider: 'claude', capabilities: ['system_design', 'architecture'] },
    { role: 'builder', preferredProvider: 'claude', fallbackProvider: 'openai', capabilities: ['code_generation'] },
    { role: 'validator', preferredProvider: 'claude', capabilities: ['code_review', 'validation'] },
    { role: 'documenter', preferredProvider: 'claude', capabilities: ['documentation'] },
    { role: 'tester', preferredProvider: 'claude', capabilities: ['test_generation'] },
    { role: 'reviewer', preferredProvider: 'claude', capabilities: ['code_review'] },
  ],
};

export const CRITICAL_ROLES: AgentRole[] = ['architect'];

export function isCriticalRole(role: AgentRole): boolean {
  return CRITICAL_ROLES.includes(role);
}

export function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function generateDAGId(): string {
  return `dag_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function roleToContextKey(role: AgentRole): string {
  const mapping: Record<AgentRole, string> = {
    architect: 'architecture',
    builder: 'source_code',
    validator: 'validation_results',
    documenter: 'documentation',
    tester: 'test_code',
    reviewer: 'review_notes',
  };
  return mapping[role];
}

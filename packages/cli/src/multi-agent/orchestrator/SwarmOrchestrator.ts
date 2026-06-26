import { EventEmitter } from 'events';
import { SwarmCoordinator } from './SwarmCoordinator.js';
import { TaskPlanner, type TaskPlan } from './TaskPlanner.js';
import type { AgentMode } from '../../core/agents/types.js';

export type ExecutionStrategy = 'single' | 'single-fallback' | 'fallback' | 'swarm' | 'manual';

export interface OrchestratorConfig {
  goal: string;
  projectId: string;
  strategy: ExecutionStrategy;
  mode: AgentMode;
  workingDir: string;
  maxRetries?: number;
  timeoutMs?: number;
  preferredAgent?: string;
  preferredProvider?: string;
  preferredModel?: string;
}

export interface ExecutionResult {
  success: boolean;
  goal: string;
  strategy: ExecutionStrategy;
  mode: AgentMode;
  agentUsed?: string;
  primaryResult?: string;
  fileChanges: any[];
  errors: string[];
  duration: number;
}

export class SwarmOrchestrator extends EventEmitter {
  private coordinator: SwarmCoordinator;
  private planner: TaskPlanner;
  private config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    super();
    this.config = config;
    this.planner = new TaskPlanner();
    this.coordinator = new SwarmCoordinator({
      ...config,
      goal: config.goal,
      projectId: config.projectId,
      strategy: config.strategy,
      mode: config.mode,
      workingDir: config.workingDir || process.cwd(),
      maxRetries: config.maxRetries ?? 3,
      timeoutMs: config.timeoutMs ?? 240000,
      preferredAgent: config.preferredAgent,
      preferredProvider: config.preferredProvider,
      preferredModel: config.preferredModel,
    });
  }

  async analyzeTask(task: string): Promise<TaskPlan> {
    return this.planner.analyze(task);
  }

  async execute(task: string, _forceStrategy?: ExecutionStrategy): Promise<ExecutionResult> {
    const result = await this.coordinator.orchestrate();
    return {
      success: result.success,
      goal: result.goal,
      strategy: this.config.strategy,
      mode: this.config.mode,
      agentUsed: result.agentUsed,
      primaryResult: result.primaryResult,
      fileChanges: result.fileChanges,
      errors: result.errors,
      duration: result.duration,
    };
  }

  /** Alias for execute(), used by the TUI */
  run = this.execute.bind(this);

  async terminate(): Promise<void> {
    this.removeAllListeners();
  }

  async stop(): Promise<void> {
    await this.terminate();
  }
}

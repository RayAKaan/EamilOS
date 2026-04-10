import { EventEmitter } from 'events';
import type {
  ExecutionStrategy,
  SpawnedAgent,
  Subtask,
  TaskPlan,
  ProgressMetrics,
  SwarmConstraints,
} from './types.js';

export interface LoopConfig {
  tickIntervalMs: number;
  maxTicks: number;
  agentTimeoutMs: number;
  heartbeatIntervalMs: number;
}

export interface TickResult {
  tick: number;
  completed: Subtask[];
  failed: Subtask[];
  agentsUpdated: string[];
  costThisTick: number;
  metrics: ProgressMetrics;
}

const DEFAULT_CONFIG: LoopConfig = {
  tickIntervalMs: 1000,
  maxTicks: 100,
  agentTimeoutMs: 30000,
  heartbeatIntervalMs: 5000,
};

export class ExecutionLoop extends EventEmitter {
  private config: LoopConfig;
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private currentTick: number = 0;
  private agents: Map<string, SpawnedAgent> = new Map();
  private subtasks: Map<string, Subtask> = new Map();
  private _taskPlan: TaskPlan | null = null;
  private strategy: ExecutionStrategy;
  private constraints: SwarmConstraints;
  private _startTime: number = 0;
  private totalCost: number = 0;

  constructor(
    strategy: ExecutionStrategy,
    constraints: SwarmConstraints,
    config?: Partial<LoopConfig>
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.strategy = strategy;
    this.constraints = constraints;
  }

  async start(agents: SpawnedAgent[], initialSubtasks: Subtask[], taskPlan: TaskPlan): Promise<void> {
    if (this.isRunning) {
      throw new Error('Execution loop is already running');
    }

    this.agents.clear();
    this.subtasks.clear();

    for (const agent of agents) {
      this.agents.set(agent.id, { ...agent });
    }

    for (const subtask of initialSubtasks) {
      this.subtasks.set(subtask.id, { ...subtask });
    }

    this._taskPlan = taskPlan;
    this.isRunning = true;
    this.isPaused = false;
    this.currentTick = 0;
    this._startTime = Date.now();
    this.totalCost = 0;

    this.emit('loop:start');

    await this.run();
  }

  stop(): void {
    this.isRunning = false;
    this.emit('loop:stop');
  }

  pause(): void {
    if (!this.isRunning) return;
    this.isPaused = true;
    this.emit('loop:pause');
  }

  resume(): void {
    if (!this.isRunning) return;
    this.isPaused = false;
    this.emit('loop:resume');
  }

  private async run(): Promise<void> {
    while (this.isRunning && this.currentTick < this.config.maxTicks) {
      if (this.isPaused) {
        await this.delay(100);
        continue;
      }

      const tickResult = await this.executeTick();

      this.currentTick++;
      this.emit('loop:tick', tickResult);

      if (this.isComplete()) {
        this.isRunning = false;
        this.emit('loop:complete', this.getMetrics());
        break;
      }

      await this.delay(this.config.tickIntervalMs);
    }

    if (this.currentTick >= this.config.maxTicks) {
      this.isRunning = false;
      this.emit('loop:timeout', this.getMetrics());
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async executeTick(): Promise<TickResult> {
    const completed: Subtask[] = [];
    const failed: Subtask[] = [];
    const agentsUpdated: string[] = [];
    let costThisTick = 0;

    const readySubtasks = this.getReadySubtasks();

    for (const subtask of readySubtasks) {
      if (!this.isRunning || this.isPaused) break;

      const assignedAgent = this.findAvailableAgent(subtask);
      if (!assignedAgent) continue;

      subtask.status = 'in-progress';
      subtask.claimedBy = assignedAgent.id;
      this.subtasks.set(subtask.id, subtask);

      const result = await this.executeSubtask(subtask, assignedAgent);

      if (result.success) {
        subtask.status = 'completed';
        subtask.result = result.output;
        completed.push(subtask);
      } else {
        subtask.status = 'failed';
        subtask.error = result.error;
        subtask.attempts++;
        failed.push(subtask);
        this.emit('subtask:failed', { subtask, agent: assignedAgent, error: result.error });
      }

      costThisTick += result.cost;
      agentsUpdated.push(assignedAgent.id);
      this.subtasks.set(subtask.id, subtask);
    }

    this.updateAgentStatuses();
    this.totalCost += costThisTick;

    return {
      tick: this.currentTick,
      completed,
      failed,
      agentsUpdated,
      costThisTick,
      metrics: this.getMetrics(),
    };
  }

  private async executeSubtask(
    subtask: Subtask,
    agent: SpawnedAgent
  ): Promise<{ success: boolean; output?: unknown; error?: string; cost: number }> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ success: false, error: 'Timeout', cost: 0 });
      }, this.config.agentTimeoutMs);

      this.emit('agent:execute', { agent, subtask });

      const estimatedCost = 0.01;
      const success = Math.random() > 0.1;

      setTimeout(() => {
        clearTimeout(timeout);
        if (success) {
          resolve({
            success: true,
            output: { result: `Completed: ${subtask.description}` },
            cost: estimatedCost,
          });
        } else {
          resolve({ success: false, error: 'Execution failed', cost: estimatedCost });
        }
      }, Math.random() * 500 + 100);
    });
  }

  private getReadySubtasks(): Subtask[] {
    return Array.from(this.subtasks.values()).filter(
      (s) => s.status === 'unclaimed' || s.status === 'blocked'
    );
  }

  private findAvailableAgent(_subtask: Subtask): SpawnedAgent | null {
    const availableAgents = Array.from(this.agents.values()).filter(
      (a) => a.status === 'idle' || a.status === 'waiting'
    );

    if (availableAgents.length === 0) return null;

    return availableAgents.sort((a, b) => a.priority - b.priority)[0];
  }

  private updateAgentStatuses(): void {
    const activeSubtasks = Array.from(this.subtasks.values()).filter(
      (s) => s.status === 'in-progress'
    );

    for (const [agentId, agent] of this.agents) {
      const isActive = activeSubtasks.some((s) => s.claimedBy === agentId);
      agent.status = isActive ? 'working' : 'idle';
      this.agents.set(agentId, agent);
    }
  }

  private isComplete(): boolean {
    const subtasks = Array.from(this.subtasks.values());
    return subtasks.every(
      (s) => s.status === 'completed' || s.status === 'failed' || s.status === 'blocked'
    );
  }

  getMetrics(): ProgressMetrics {
    const subtasks = Array.from(this.subtasks.values());
    const completed = subtasks.filter((s) => s.status === 'completed');
    const failed = subtasks.filter((s) => s.status === 'failed');
    const total = subtasks.length;

    return {
      ticksElapsed: this.currentTick,
      subtasksCompleted: completed.length,
      subtasksTotal: total,
      subtasksFailed: failed.length,
      failureRate: total > 0 ? failed.length / total : 0,
      validationPassRate: completed.length > 0 ? completed.length / (completed.length + failed.length) : 0,
      costSoFar: this.totalCost,
      budgetRemaining: this.constraints.maxCostUSD - this.totalCost,
    };
  }

  getAgents(): SpawnedAgent[] {
    return Array.from(this.agents.values());
  }

  getSubtasks(): Subtask[] {
    return Array.from(this.subtasks.values());
  }

  getCurrentTick(): number {
    return this.currentTick;
  }

  getStartTime(): number {
    return this._startTime;
  }

  getTaskPlan(): TaskPlan | null {
    return this._taskPlan;
  }

  isActive(): boolean {
    return this.isRunning;
  }

  isPausedState(): boolean {
    return this.isPaused;
  }

  getStrategy(): ExecutionStrategy {
    return this.strategy;
  }

  setStrategy(strategy: ExecutionStrategy): void {
    this.strategy = strategy;
    this.emit('strategy:change', { strategy });
  }

  addAgent(agent: SpawnedAgent): void {
    this.agents.set(agent.id, { ...agent });
  }

  removeAgent(agentId: string): void {
    const activeTasks = Array.from(this.subtasks.values()).filter(
      (s) => s.claimedBy === agentId && s.status === 'in-progress'
    );

    for (const task of activeTasks) {
      task.status = 'unclaimed';
      task.claimedBy = undefined;
      this.subtasks.set(task.id, task);
    }

    this.agents.delete(agentId);
  }

  prioritizeSubtask(subtaskId: string, priority: number): void {
    const subtask = this.subtasks.get(subtaskId);
    if (subtask) {
      subtask.priority = priority;
      this.subtasks.set(subtaskId, subtask);
    }
  }
}

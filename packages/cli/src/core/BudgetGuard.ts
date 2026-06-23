import { BudgetStatus, TaskResult } from './types.js';

export interface BudgetConfig {
  projectBudget?: number;
  taskBudget?: number;
  warningThreshold?: number;
}

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  status: BudgetStatus;
}

export class BudgetGuard {
  private projectBudget: number;
  private taskBudget: number;
  private warningThreshold: number;
  private totalSpent: number = 0;
  private taskCosts: Map<string, number> = new Map();

  constructor(config: BudgetConfig = {}) {
    this.projectBudget = config.projectBudget ?? 5.0;
    this.taskBudget = config.taskBudget ?? 0.5;
    this.warningThreshold = config.warningThreshold ?? 0.8;
  }

  checkTaskBudget(taskId: string, estimatedCost: number): BudgetCheckResult {
    const taskSpent = this.taskCosts.get(taskId) ?? 0;
    const projectedTotal = this.totalSpent + taskSpent + estimatedCost;

    const status = this.getStatus();

    if (projectedTotal > this.projectBudget) {
      return {
        allowed: false,
        reason: 'PROJECT_BUDGET_EXCEEDED',
        status,
      };
    }

    if (taskSpent + estimatedCost > this.taskBudget) {
      return {
        allowed: false,
        reason: 'TASK_BUDGET_EXCEEDED',
        status,
      };
    }

    return { allowed: true, status };
  }

  recordTaskResult(result: TaskResult): void {
    this.totalSpent += result.costUsd;
    const currentTaskSpent = this.taskCosts.get(result.taskId) ?? 0;
    this.taskCosts.set(result.taskId, currentTaskSpent + result.costUsd);
  }

  canStartTask(taskId: string, estimatedCost: number = 0.1): BudgetCheckResult {
    const projectedSpent = this.totalSpent + estimatedCost;
    const percentageUsed = this.projectBudget > 0 
      ? projectedSpent / this.projectBudget 
      : 0;

    if (percentageUsed >= 1.0) {
      return {
        allowed: false,
        reason: 'PROJECT_BUDGET_EXCEEDED',
        status: this.getStatus(),
      };
    }

    if (percentageUsed >= this.warningThreshold) {
      return {
        allowed: true,
        status: { ...this.getStatus(), warning: true },
      };
    }

    const taskSpent = this.taskCosts.get(taskId) ?? 0;
    if (taskSpent >= this.taskBudget) {
      return {
        allowed: false,
        reason: 'TASK_BUDGET_EXCEEDED',
        status: this.getStatus(),
      };
    }

    return { allowed: true, status: this.getStatus() };
  }

  getStatus(): BudgetStatus {
    const percentageUsed = this.projectBudget > 0 
      ? this.totalSpent / this.projectBudget 
      : 0;

    return {
      exceeded: this.totalSpent > this.projectBudget,
      warning: percentageUsed >= this.warningThreshold && percentageUsed < 1.0,
      totalSpent: this.totalSpent,
      budgetLimit: this.projectBudget,
      percentageUsed,
      taskSpent: 0,
      taskLimit: this.taskBudget,
    };
  }

  getProjectSpent(): number {
    return this.totalSpent;
  }

  getTaskSpent(taskId: string): number {
    return this.taskCosts.get(taskId) ?? 0;
  }

  isProjectBudgetExceeded(): boolean {
    return this.totalSpent > this.projectBudget;
  }

  isTaskBudgetExceeded(taskId: string): boolean {
    return (this.taskCosts.get(taskId) ?? 0) > this.taskBudget;
  }

  setProjectBudget(budget: number): void {
    this.projectBudget = budget;
  }

  setTaskBudget(budget: number): void {
    this.taskBudget = budget;
  }

  reset(): void {
    this.totalSpent = 0;
    this.taskCosts.clear();
  }

  resetTask(taskId: string): void {
    const taskSpent = this.taskCosts.get(taskId) ?? 0;
    this.totalSpent -= taskSpent;
    this.taskCosts.delete(taskId);
  }
}

let globalBudgetGuard: BudgetGuard | null = null;

export function initBudgetGuard(config?: BudgetConfig): BudgetGuard {
  globalBudgetGuard = new BudgetGuard(config);
  return globalBudgetGuard;
}

export function getBudgetGuard(): BudgetGuard {
  if (!globalBudgetGuard) {
    return initBudgetGuard();
  }
  return globalBudgetGuard;
}

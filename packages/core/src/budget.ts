// PHASE 2: Full implementation - cost tracking and enforcement
import { getConfig } from './config.js';
import { getDatabase } from './db.js';
import { getLogger } from './logger.js';
import { BudgetExceededError } from './errors.js';

export interface BudgetStatus {
  exceeded: boolean;
  warning: boolean;
  totalSpent: number;
  budgetLimit: number;
  percentageUsed: number;
  taskSpent: number;
  taskLimit: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export class BudgetTracker {
  private projectLimits: Map<string, number> = new Map();
  private taskLimits: Map<string, number> = new Map();
  private projectSpent: Map<string, number> = new Map();
  private taskSpent: Map<string, number> = new Map();

  constructor() {
    const config = getConfig();
    const defaultLimit = config.budget.max_cost_per_project_usd * 100;
    this.projectLimits.set('default', defaultLimit);
    this.taskLimits.set('default', defaultLimit / 10);
  }

  setProjectLimit(projectId: string, limitUsd: number): void {
    this.projectLimits.set(projectId, limitUsd * 100);
  }

  setTaskLimit(projectId: string, taskId: string, limitUsd: number): void {
    const key = `${projectId}:${taskId}`;
    this.taskLimits.set(key, limitUsd * 100);
  }

  recordUsage(projectId: string, taskId: string, usage: TokenUsage): void {
    const logger = getLogger();
    const costCents = Math.round(usage.costUsd * 100);

    const currentProject = this.projectSpent.get(projectId) ?? 0;
    this.projectSpent.set(projectId, currentProject + costCents);

    const currentTask = this.taskSpent.get(`${projectId}:${taskId}`) ?? 0;
    this.taskSpent.set(`${projectId}:${taskId}`, currentTask + costCents);

    const db = getDatabase();
    if (db) {
      try {
        db.updateProjectBudget?.(projectId, costCents);
      } catch {
        logger.debug('Budget update not persisted to database');
      }
    }

    logger.debug(`Budget recorded: project=${projectId}, task=${taskId}, cost=${costCents}c`);
  }

  check(projectId: string, taskId?: string): BudgetStatus {
    const config = getConfig();
    const projectLimit = this.projectLimits.get(projectId) ?? this.projectLimits.get('default') ?? 0;
    const projectSpent = this.projectSpent.get(projectId) ?? 0;

    let taskLimit = this.taskLimits.get(`${projectId}:${taskId}`) ?? this.taskLimits.get('default') ?? 0;
    let taskSpent = taskId ? (this.taskSpent.get(`${projectId}:${taskId}`) ?? 0) : 0;

    const percentageUsed = projectLimit > 0 ? (projectSpent / projectLimit) * 100 : 0;
    const warningThreshold = config.budget.warn_at_percentage;

    return {
      exceeded: projectSpent > projectLimit,
      warning: percentageUsed >= warningThreshold,
      totalSpent: projectSpent / 100,
      budgetLimit: projectLimit / 100,
      percentageUsed,
      taskSpent: taskSpent / 100,
      taskLimit: taskLimit / 100,
    };
  }

  enforce(projectId: string, taskId?: string): void {
    const status = this.check(projectId, taskId);
    if (status.exceeded) {
      throw new BudgetExceededError(projectId, status.totalSpent, status.budgetLimit);
    }
  }

  getProjectSpent(projectId: string): number {
    return (this.projectSpent.get(projectId) ?? 0) / 100;
  }

  getTaskSpent(projectId: string, taskId: string): number {
    return (this.taskSpent.get(`${projectId}:${taskId}`) ?? 0) / 100;
  }

  reset(): void {
    this.projectSpent.clear();
    this.taskSpent.clear();
  }
}

let globalBudgetTracker: BudgetTracker | null = null;

export function initBudgetTracker(): BudgetTracker {
  globalBudgetTracker = new BudgetTracker();
  return globalBudgetTracker;
}

export function getBudgetTracker(): BudgetTracker {
  if (!globalBudgetTracker) {
    return initBudgetTracker();
  }
  return globalBudgetTracker;
}

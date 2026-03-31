import { describe, it, expect, beforeEach } from 'vitest';
import { BudgetGuard } from '../../src/BudgetGuard.js';
import { TaskResult } from '../../src/types.js';

describe('PHASE - Stabilization: BudgetGuard Tests (B-1 through B-10)', () => {
  let budgetGuard: BudgetGuard;

  describe('B-1: BudgetGuard initialization', () => {
    it('should initialize with default values', () => {
      const guard = new BudgetGuard();
      const status = guard.getStatus();
      
      expect(status.totalSpent).toBe(0);
      expect(status.budgetLimit).toBe(5.0);
      expect(status.taskLimit).toBe(0.5);
      expect(status.exceeded).toBe(false);
      expect(status.warning).toBe(false);
    });

    it('should initialize with custom config', () => {
      const guard = new BudgetGuard({
        projectBudget: 10.0,
        taskBudget: 1.0,
        warningThreshold: 0.9,
      });
      const status = guard.getStatus();
      
      expect(status.budgetLimit).toBe(10.0);
      expect(status.taskLimit).toBe(1.0);
    });
  });

  describe('B-2: Task budget checking', () => {
    beforeEach(() => {
      budgetGuard = new BudgetGuard({
        projectBudget: 5.0,
        taskBudget: 1.0,
      });
    });

    it('should allow task when under budget', () => {
      const result = budgetGuard.canStartTask('task-1', 0.1);
      expect(result.allowed).toBe(true);
      expect(result.status.exceeded).toBe(false);
    });

    it('should reject when project budget exceeded', () => {
      budgetGuard = new BudgetGuard({
        projectBudget: 0.5,
        taskBudget: 1.0,
      });
      
      const result = budgetGuard.canStartTask('task-1', 0.6);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('PROJECT_BUDGET_EXCEEDED');
    });

    it('should warn when approaching project budget', () => {
      budgetGuard = new BudgetGuard({
        projectBudget: 1.0,
        taskBudget: 1.0,
        warningThreshold: 0.5,
      });
      
      budgetGuard.recordTaskResult({
        taskId: 'task-1',
        success: true,
        artifacts: [],
        output: '',
        startedAt: new Date(),
        completedAt: new Date(),
        modelCalls: 1,
        costUsd: 0.55,
      });
      
      const status = budgetGuard.getStatus();
      expect(status.warning).toBe(true);
    });
  });

  describe('B-3: Task cost recording', () => {
    beforeEach(() => {
      budgetGuard = new BudgetGuard({
        projectBudget: 5.0,
        taskBudget: 1.0,
      });
    });

    it('should record task result costs', () => {
      const result: TaskResult = {
        taskId: 'task-1',
        success: true,
        artifacts: ['file1.ts', 'file2.ts'],
        output: 'Created 2 files',
        startedAt: new Date(),
        completedAt: new Date(),
        modelCalls: 1,
        costUsd: 0.25,
      };

      budgetGuard.recordTaskResult(result);
      
      expect(budgetGuard.getProjectSpent()).toBe(0.25);
      expect(budgetGuard.getTaskSpent('task-1')).toBe(0.25);
    });

    it('should accumulate costs for same task', () => {
      const result1: TaskResult = {
        taskId: 'task-1',
        success: true,
        artifacts: ['file1.ts'],
        output: 'Created 1 file',
        startedAt: new Date(),
        completedAt: new Date(),
        modelCalls: 1,
        costUsd: 0.1,
      };

      const result2: TaskResult = {
        taskId: 'task-1',
        success: false,
        artifacts: [],
        output: 'Failed',
        startedAt: new Date(),
        completedAt: new Date(),
        modelCalls: 1,
        costUsd: 0.15,
      };

      budgetGuard.recordTaskResult(result1);
      budgetGuard.recordTaskResult(result2);
      
      expect(budgetGuard.getTaskSpent('task-1')).toBe(0.25);
      expect(budgetGuard.getProjectSpent()).toBe(0.25);
    });
  });

  describe('B-4: Budget status tracking', () => {
    beforeEach(() => {
      budgetGuard = new BudgetGuard({
        projectBudget: 5.0,
        taskBudget: 1.0,
      });
    });

    it('should track percentage used', () => {
      const result: TaskResult = {
        taskId: 'task-1',
        success: true,
        artifacts: ['file1.ts'],
        output: 'Done',
        startedAt: new Date(),
        completedAt: new Date(),
        modelCalls: 1,
        costUsd: 1.0,
      };

      budgetGuard.recordTaskResult(result);
      
      const status = budgetGuard.getStatus();
      expect(status.percentageUsed).toBe(0.2);
      expect(status.totalSpent).toBe(1.0);
    });

    it('should report exceeded when over budget', () => {
      const result: TaskResult = {
        taskId: 'task-1',
        success: true,
        artifacts: ['file1.ts'],
        output: 'Done',
        startedAt: new Date(),
        completedAt: new Date(),
        modelCalls: 1,
        costUsd: 6.0,
      };

      budgetGuard.recordTaskResult(result);
      
      const status = budgetGuard.getStatus();
      expect(status.exceeded).toBe(true);
    });
  });

  describe('B-5: Multiple task tracking', () => {
    beforeEach(() => {
      budgetGuard = new BudgetGuard({
        projectBudget: 5.0,
        taskBudget: 1.0,
      });
    });

    it('should track multiple tasks independently', () => {
      budgetGuard.recordTaskResult({
        taskId: 'task-1',
        success: true,
        artifacts: [],
        output: '',
        startedAt: new Date(),
        completedAt: new Date(),
        modelCalls: 1,
        costUsd: 1.0,
      });

      budgetGuard.recordTaskResult({
        taskId: 'task-2',
        success: true,
        artifacts: [],
        output: '',
        startedAt: new Date(),
        completedAt: new Date(),
        modelCalls: 1,
        costUsd: 1.5,
      });

      budgetGuard.recordTaskResult({
        taskId: 'task-3',
        success: true,
        artifacts: [],
        output: '',
        startedAt: new Date(),
        completedAt: new Date(),
        modelCalls: 1,
        costUsd: 0.5,
      });

      expect(budgetGuard.getProjectSpent()).toBe(3.0);
      expect(budgetGuard.getTaskSpent('task-1')).toBe(1.0);
      expect(budgetGuard.getTaskSpent('task-2')).toBe(1.5);
      expect(budgetGuard.getTaskSpent('task-3')).toBe(0.5);
    });
  });

  describe('B-6: Budget reset', () => {
    it('should reset all costs', () => {
      budgetGuard = new BudgetGuard();
      
      budgetGuard.recordTaskResult({
        taskId: 'task-1',
        success: true,
        artifacts: [],
        output: '',
        startedAt: new Date(),
        completedAt: new Date(),
        modelCalls: 1,
        costUsd: 2.0,
      });

      budgetGuard.reset();
      
      expect(budgetGuard.getProjectSpent()).toBe(0);
      expect(budgetGuard.getStatus().exceeded).toBe(false);
    });

    it('should reset individual task', () => {
      budgetGuard = new BudgetGuard();
      
      budgetGuard.recordTaskResult({
        taskId: 'task-1',
        success: true,
        artifacts: [],
        output: '',
        startedAt: new Date(),
        completedAt: new Date(),
        modelCalls: 1,
        costUsd: 2.0,
      });

      budgetGuard.recordTaskResult({
        taskId: 'task-2',
        success: true,
        artifacts: [],
        output: '',
        startedAt: new Date(),
        completedAt: new Date(),
        modelCalls: 1,
        costUsd: 1.0,
      });

      budgetGuard.resetTask('task-1');
      
      expect(budgetGuard.getProjectSpent()).toBe(1.0);
      expect(budgetGuard.getTaskSpent('task-1')).toBe(0);
      expect(budgetGuard.getTaskSpent('task-2')).toBe(1.0);
    });
  });

  describe('B-7: Task budget enforcement', () => {
    it('should reject when individual task budget exceeded', () => {
      budgetGuard = new BudgetGuard({
        projectBudget: 10.0,
        taskBudget: 0.5,
      });

      budgetGuard.recordTaskResult({
        taskId: 'task-1',
        success: true,
        artifacts: [],
        output: '',
        startedAt: new Date(),
        completedAt: new Date(),
        modelCalls: 1,
        costUsd: 0.6,
      });

      const result = budgetGuard.canStartTask('task-1', 0.1);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('TASK_BUDGET_EXCEEDED');
    });
  });

  describe('B-8: Check before task start', () => {
    it('should check projected budget before starting', () => {
      budgetGuard = new BudgetGuard({
        projectBudget: 1.0,
        taskBudget: 1.0,
      });

      const result = budgetGuard.checkTaskBudget('task-new', 0.5);
      expect(result.allowed).toBe(true);
    });

    it('should block when projected would exceed budget', () => {
      budgetGuard = new BudgetGuard({
        projectBudget: 1.0,
        taskBudget: 1.0,
      });

      budgetGuard.recordTaskResult({
        taskId: 'task-1',
        success: true,
        artifacts: [],
        output: '',
        startedAt: new Date(),
        completedAt: new Date(),
        modelCalls: 1,
        costUsd: 0.6,
      });

      const result = budgetGuard.checkTaskBudget('task-new', 0.5);
      expect(result.allowed).toBe(false);
    });
  });

  describe('B-9: Budget limits configuration', () => {
    it('should update project budget', () => {
      budgetGuard = new BudgetGuard();
      budgetGuard.setProjectBudget(20.0);
      
      const status = budgetGuard.getStatus();
      expect(status.budgetLimit).toBe(20.0);
    });

    it('should update task budget', () => {
      budgetGuard = new BudgetGuard();
      budgetGuard.setTaskBudget(2.0);
      
      const status = budgetGuard.getStatus();
      expect(status.taskLimit).toBe(2.0);
    });
  });

  describe('B-10: Helper methods', () => {
    it('should report budget exceeded correctly', () => {
      budgetGuard = new BudgetGuard({ projectBudget: 1.0 });
      expect(budgetGuard.isProjectBudgetExceeded()).toBe(false);
      
      budgetGuard.recordTaskResult({
        taskId: 'task-1',
        success: true,
        artifacts: [],
        output: '',
        startedAt: new Date(),
        completedAt: new Date(),
        modelCalls: 1,
        costUsd: 1.5,
      });
      
      expect(budgetGuard.isProjectBudgetExceeded()).toBe(true);
    });

    it('should report task budget exceeded correctly', () => {
      budgetGuard = new BudgetGuard({ taskBudget: 0.5 });
      expect(budgetGuard.isTaskBudgetExceeded('task-1')).toBe(false);
      
      budgetGuard.recordTaskResult({
        taskId: 'task-1',
        success: true,
        artifacts: [],
        output: '',
        startedAt: new Date(),
        completedAt: new Date(),
        modelCalls: 1,
        costUsd: 0.6,
      });
      
      expect(budgetGuard.isTaskBudgetExceeded('task-1')).toBe(true);
    });
  });
});

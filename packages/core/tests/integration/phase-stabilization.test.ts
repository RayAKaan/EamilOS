import { describe, it, expect, beforeEach } from 'vitest';
import { Orchestrator } from '../../src/orchestrator.js';
import { BudgetGuard } from '../../src/BudgetGuard.js';
import { parseResponse } from '../../src/parsers/ResponseParser.js';
import { Project, Task } from '../../src/types.js';

function createMockProject(): Project {
  return {
    id: 'integration-project-1',
    name: 'Integration Test Project',
    rootDir: '/tmp/integration-test',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `integration-task-${Math.random().toString(36).substr(2, 9)}`,
    projectId: 'integration-project-1',
    title: 'Integration Test Task',
    description: 'Test task description',
    type: 'implementation',
    status: 'pending',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('PHASE - Stabilization: Integration Tests (L-1 through L-5)', () => {
  let budgetGuard: BudgetGuard;

  beforeEach(() => {
    budgetGuard = new BudgetGuard({
      projectBudget: 5.0,
      taskBudget: 1.0,
    });
  });

  describe('L-1: Parser + Orchestrator integration', () => {
    it('should validate model response through orchestrator', () => {
      const orchestrator = new Orchestrator();
      
      const modelResponse = JSON.stringify({
        files: [
          { path: 'index.ts', content: 'export const x = 1;' },
          { path: 'utils/helper.ts', content: 'export function help() { return true; }' }
        ],
        summary: 'Created 2 TypeScript files'
      });

      const result = orchestrator.validateResponse(modelResponse);
      expect(result.valid).toBe(true);
    });

    it('should reject invalid model response', () => {
      const orchestrator = new Orchestrator();
      
      const invalidResponse = 'Here is the code you requested';
      const result = orchestrator.validateResponse(invalidResponse);
      expect(result.valid).toBe(false);
    });
  });

  describe('L-2: BudgetGuard + Orchestrator integration', () => {
    it('should track orchestrator costs in budget', () => {
      const orchestrator = new Orchestrator();
      const project = createMockProject();
      const task = createMockTask({ title: 'Cost Tracking Test' });

      const budgetCheck = budgetGuard.canStartTask(task.id);
      expect(budgetCheck.allowed).toBe(true);
    });

    it('should block execution when budget exceeded', () => {
      budgetGuard = new BudgetGuard({
        projectBudget: 0.1,
        taskBudget: 1.0,
      });

      const task = createMockTask();
      const budgetCheck = budgetGuard.canStartTask(task.id);
      expect(budgetCheck.allowed).toBe(false);
      expect(budgetCheck.reason).toBe('PROJECT_BUDGET_EXCEEDED');
    });
  });

  describe('L-3: Parser + BudgetGuard integration', () => {
    it('should validate response and check budget', () => {
      const validResponse = JSON.stringify({
        files: [
          { path: 'app.ts', content: 'console.log("app");' }
        ]
      });

      const parseResult = parseResponse(validResponse);
      expect(parseResult.success).toBe(true);
      expect(parseResult.files.length).toBe(1);

      if (parseResult.success && parseResult.files.length > 0) {
        const budgetCheck = budgetGuard.canStartTask('task-1');
        expect(budgetCheck.allowed).toBe(true);
      }
    });

    it('should handle invalid response gracefully', () => {
      const invalidResponse = 'Invalid response';
      const parseResult = parseResponse(invalidResponse);
      expect(parseResult.success).toBe(false);
    });
  });

  describe('L-4: Full pipeline integration', () => {
    it('should handle complete task lifecycle with budget', () => {
      const orchestrator = new Orchestrator();
      const project = createMockProject();
      const task = createMockTask({ title: 'Full Pipeline Test' });

      const budgetBefore = budgetGuard.canStartTask(task.id);
      expect(budgetBefore.allowed).toBe(true);

      const validResponse = JSON.stringify({
        files: [
          { path: 'main.ts', content: 'export default {};' }
        ]
      });

      const validationResult = orchestrator.validateResponse(validResponse);
      expect(validationResult.valid).toBe(true);
    });

    it('should reject task when budget would be exceeded', () => {
      budgetGuard = new BudgetGuard({
        projectBudget: 0.1,
        taskBudget: 0.5,
      });

      const orchestrator = new Orchestrator();
      const task = createMockTask();

      const budgetCheck = budgetGuard.canStartTask(task.id, 0.2);
      expect(budgetCheck.allowed).toBe(false);
    });
  });

  describe('L-5: Multi-task orchestration with budget', () => {
    it('should track multiple tasks with budget', () => {
      const tasks = [
        createMockTask({ title: 'Task 1' }),
        createMockTask({ title: 'Task 2' }),
        createMockTask({ title: 'Task 3' }),
      ];

      tasks.forEach(task => {
        const budgetCheck = budgetGuard.canStartTask(task.id);
        expect(budgetCheck.allowed).toBe(true);
      });

      expect(budgetGuard.getProjectSpent()).toBe(0);
    });

    it('should accumulate costs from multiple tasks', () => {
      const tasks = [
        createMockTask({ title: 'Task 1' }),
        createMockTask({ title: 'Task 2' }),
      ];

      budgetGuard.recordTaskResult({
        taskId: tasks[0].id,
        success: true,
        artifacts: ['file1.ts'],
        output: '',
        startedAt: new Date(),
        completedAt: new Date(),
        modelCalls: 1,
        costUsd: 0.5,
      });

      budgetGuard.recordTaskResult({
        taskId: tasks[1].id,
        success: true,
        artifacts: ['file2.ts'],
        output: '',
        startedAt: new Date(),
        completedAt: new Date(),
        modelCalls: 1,
        costUsd: 0.75,
      });

      expect(budgetGuard.getProjectSpent()).toBe(1.25);
      expect(budgetGuard.getStatus().percentageUsed).toBe(0.25);
    });

    it('should block new tasks when project budget exceeded', () => {
      budgetGuard = new BudgetGuard({
        projectBudget: 1.0,
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
        costUsd: 1.5,
      });

      expect(budgetGuard.isProjectBudgetExceeded()).toBe(true);

      const newTask = createMockTask();
      const budgetCheck = budgetGuard.canStartTask(newTask.id);
      expect(budgetCheck.allowed).toBe(false);
    });
  });
});

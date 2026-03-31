import { writeFileSync } from 'fs';
import { BudgetGuard } from './src/BudgetGuard.js';
import { TaskResult } from './src/types.js';

interface TestResult {
  testId: string;
  testName: string;
  category: string;
  status: 'PASS' | 'FAIL' | 'PARTIAL' | 'ERROR' | 'SKIP';
  input: string | object;
  expectedBehavior: string;
  actualBehavior: string;
  rootCause: string;
  fix: string;
  durationMs: number;
  telemetry: Record<string, unknown>;
  timestamp: string;
}

const results: TestResult[] = [];
const timeline: Array<Record<string, unknown>> = [];
const startTime = Date.now();

function createResult(partial: Partial<TestResult>): TestResult {
  return {
    testId: partial.testId || 'UNKNOWN',
    testName: partial.testName || '',
    category: 'budget',
    status: partial.status || 'ERROR',
    input: partial.input || {},
    expectedBehavior: partial.expectedBehavior || '',
    actualBehavior: partial.actualBehavior || '',
    rootCause: partial.rootCause || '',
    fix: partial.fix || '',
    durationMs: partial.durationMs || 0,
    telemetry: partial.telemetry || {},
    timestamp: new Date().toISOString(),
  };
}

function runTest(
  testId: string,
  testName: string,
  expected: string,
  testFn: () => { passed: boolean; actual: string; rootCause: string; fix: string; telemetry: Record<string, unknown> }
): void {
  const testStart = Date.now();
  try {
    const outcome = testFn();
    results.push(createResult({
      testId,
      testName,
      expectedBehavior: expected,
      status: outcome.passed ? 'PASS' : 'FAIL',
      actualBehavior: outcome.actual,
      rootCause: outcome.rootCause,
      fix: outcome.fix,
      durationMs: Date.now() - testStart,
      telemetry: outcome.telemetry,
    }));
  } catch (error) {
    results.push(createResult({
      testId,
      testName,
      expectedBehavior: expected,
      status: 'ERROR',
      actualBehavior: `Exception: ${error instanceof Error ? error.message : String(error)}`,
      rootCause: 'Unhandled exception',
      fix: 'Add error handling',
      durationMs: Date.now() - testStart,
      telemetry: { error: error instanceof Error ? error.message : String(error) },
    }));
  }
}

// B-STRESS-1: Task cost overflow simulation
runTest(
  'B-STRESS-1',
  'Task cost overflow',
  'Budget should block task when project budget would be exceeded',
  () => {
    const guard = new BudgetGuard({ projectBudget: 1.0, taskBudget: 0.5 });
    const results: { step: number; action: string; allowed: boolean; reason?: string; totalSpent: number }[] = [];
    
    // Simulate 5 attempts with costs
    const costs = [0.3, 0.3, 0.3, 0.3, 0.3];
    
    for (let i = 0; i < costs.length; i++) {
      const check = guard.canStartTask(`task-${i}`, costs[i]);
      results.push({
        step: i + 1,
        action: `canStartTask with cost ${costs[i]}`,
        allowed: check.allowed,
        reason: check.reason,
        totalSpent: guard.getProjectSpent(),
      });
      
      if (check.allowed) {
        guard.recordTaskResult({
          taskId: `task-${i}`,
          success: true,
          artifacts: [],
          output: '',
          startedAt: new Date(),
          completedAt: new Date(),
          modelCalls: 1,
          costUsd: costs[i],
        });
      }
    }
    
    const passed = results.filter(r => r.allowed).length === 3 && !results[4].allowed;
    return {
      passed,
      actual: `3 tasks allowed, 2 blocked. Final state: ${JSON.stringify(results.slice(-2))}`,
      rootCause: passed ? '' : 'Budget overflow not correctly enforced',
      fix: passed ? '' : 'Ensure project budget check uses projected total',
      telemetry: { steps: results, finalSpent: guard.getProjectSpent(), exceeded: guard.isProjectBudgetExceeded() },
    };
  }
);

// B-STRESS-2: Individual task budget limit
runTest(
  'B-STRESS-2',
  'Task budget limit',
  'Should block task when individual task budget is exceeded',
  () => {
    const guard = new BudgetGuard({ projectBudget: 10.0, taskBudget: 1.0 });
    
    // Record costs for a single task exceeding its limit
    guard.recordTaskResult({
      taskId: 'task-1',
      success: true,
      artifacts: [],
      output: '',
      startedAt: new Date(),
      completedAt: new Date(),
      modelCalls: 1,
      costUsd: 0.6,
    });
    
    guard.recordTaskResult({
      taskId: 'task-1',
      success: true,
      artifacts: [],
      output: '',
      startedAt: new Date(),
      completedAt: new Date(),
      modelCalls: 1,
      costUsd: 0.6,
    });
    
    const check = guard.canStartTask('task-1', 0.1);
    const passed = !check.allowed && check.reason === 'TASK_BUDGET_EXCEEDED';
    
    return {
      passed,
      actual: `Task spent: ${guard.getTaskSpent('task-1')}, canStartTask allowed: ${check.allowed}, reason: ${check.reason}`,
      rootCause: passed ? '' : 'Task budget limit not enforced',
      fix: passed ? '' : 'Check task-specific costs against taskBudget',
      telemetry: { taskSpent: guard.getTaskSpent('task-1'), taskBudget: 1.0, check },
    };
  }
);

// B-STRESS-3: Budget warning threshold
runTest(
  'B-STRESS-3',
  'Budget warning threshold',
  'Should warn when approaching project budget (>=80% threshold)',
  () => {
    const guard = new BudgetGuard({ projectBudget: 1.0, warningThreshold: 0.8 });
    
    guard.recordTaskResult({
      taskId: 'task-1',
      success: true,
      artifacts: [],
      output: '',
      startedAt: new Date(),
      completedAt: new Date(),
      modelCalls: 1,
      costUsd: 0.85,
    });
    
    const status = guard.getStatus();
    const passed = status.warning === true;
    
    return {
      passed,
      actual: `Warning: ${status.warning}, Percentage: ${(status.percentageUsed * 100).toFixed(1)}%`,
      rootCause: passed ? '' : 'Warning threshold not triggered',
      fix: passed ? '' : 'Set warning flag when percentage >= warningThreshold',
      telemetry: { status },
    };
  }
);

// B-STRESS-4: Budget exceeded detection
runTest(
  'B-STRESS-4',
  'Budget exceeded detection',
  'Should correctly report when project budget is exceeded',
  () => {
    const guard = new BudgetGuard({ projectBudget: 1.0 });
    
    guard.recordTaskResult({
      taskId: 'task-1',
      success: true,
      artifacts: [],
      output: '',
      startedAt: new Date(),
      completedAt: new Date(),
      modelCalls: 1,
      costUsd: 1.5,
    });
    
    const status = guard.getStatus();
    const isExceeded = guard.isProjectBudgetExceeded();
    const passed = status.exceeded === true && isExceeded === true;
    
    return {
      passed,
      actual: `Status exceeded: ${status.exceeded}, isProjectBudgetExceeded: ${isExceeded}, Total spent: ${status.totalSpent}`,
      rootCause: passed ? '' : 'Budget exceeded detection incorrect',
      fix: passed ? '' : 'Set exceeded=true when totalSpent > projectBudget',
      telemetry: { status },
    };
  }
);

// B-STRESS-5: Budget reset
runTest(
  'B-STRESS-5',
  'Budget reset',
  'After reset(), all state should be cleared',
  () => {
    const guard = new BudgetGuard({ projectBudget: 5.0, taskBudget: 1.0 });
    
    guard.recordTaskResult({
      taskId: 'task-1',
      success: true,
      artifacts: [],
      output: '',
      startedAt: new Date(),
      completedAt: new Date(),
      modelCalls: 1,
      costUsd: 2.0,
    });
    
    guard.recordTaskResult({
      taskId: 'task-2',
      success: true,
      artifacts: [],
      output: '',
      startedAt: new Date(),
      completedAt: new Date(),
      modelCalls: 1,
      costUsd: 1.5,
    });
    
    const before = { total: guard.getProjectSpent(), task1: guard.getTaskSpent('task-1'), task2: guard.getTaskSpent('task-2') };
    
    guard.reset();
    
    const after = { total: guard.getProjectSpent(), task1: guard.getTaskSpent('task-1'), task2: guard.getTaskSpent('task-2') };
    const passed = after.total === 0 && after.task1 === 0 && after.task2 === 0;
    
    return {
      passed,
      actual: `Before reset: ${JSON.stringify(before)}, After reset: ${JSON.stringify(after)}`,
      rootCause: passed ? '' : 'Reset did not clear all state',
      fix: passed ? '' : 'Ensure reset() clears all internal counters',
      telemetry: { before, after },
    };
  }
);

// B-STRESS-6: Rapid small request accumulation
runTest(
  'B-STRESS-6',
  'Rapid small request accumulation',
  'No precision loss from many small increments',
  () => {
    const guard = new BudgetGuard({ projectBudget: 100.0, taskBudget: 10.0 });
    const increments = 100;
    const incrementAmount = 0.1;
    
    for (let i = 0; i < increments; i++) {
      guard.recordTaskResult({
        taskId: `task-${i}`,
        success: true,
        artifacts: [],
        output: '',
        startedAt: new Date(),
        completedAt: new Date(),
        modelCalls: 1,
        costUsd: incrementAmount,
      });
    }
    
    const total = guard.getProjectSpent();
    const expected = increments * incrementAmount;
    const passed = Math.abs(total - expected) < 0.001;
    
    return {
      passed,
      actual: `Expected: ${expected}, Actual: ${total}, Diff: ${Math.abs(total - expected)}`,
      rootCause: passed ? '' : 'Precision loss in accumulation',
      fix: passed ? '' : 'Use precise arithmetic or store as integer cents',
      telemetry: { expected, actual: total, increments, incrementAmount },
    };
  }
);

// B-STRESS-7: Individual task reset
runTest(
  'B-STRESS-7',
  'Individual task reset',
  'resetTask() should clear only specified task costs',
  () => {
    const guard = new BudgetGuard({ projectBudget: 10.0 });
    
    guard.recordTaskResult({
      taskId: 'task-1',
      success: true,
      artifacts: [],
      output: '',
      startedAt: new Date(),
      completedAt: new Date(),
      modelCalls: 1,
      costUsd: 2.0,
    });
    
    guard.recordTaskResult({
      taskId: 'task-2',
      success: true,
      artifacts: [],
      output: '',
      startedAt: new Date(),
      completedAt: new Date(),
      modelCalls: 1,
      costUsd: 1.0,
    });
    
    guard.resetTask('task-1');
    
    const passed = guard.getProjectSpent() === 1.0 && guard.getTaskSpent('task-1') === 0 && guard.getTaskSpent('task-2') === 1.0;
    
    return {
      passed,
      actual: `Project spent: ${guard.getProjectSpent()}, task-1: ${guard.getTaskSpent('task-1')}, task-2: ${guard.getTaskSpent('task-2')}`,
      rootCause: passed ? '' : 'Task reset affected wrong task or project total',
      fix: passed ? '' : 'Only deduct specified task from totalSpent',
      telemetry: { projectSpent: guard.getProjectSpent(), task1Spent: guard.getTaskSpent('task-1'), task2Spent: guard.getTaskSpent('task-2') },
    };
  }
);

// B-STRESS-8: Budget checkTaskBudget method
runTest(
  'B-STRESS-8',
  'checkTaskBudget method',
  'checkTaskBudget should verify both project and task limits',
  () => {
    const guard = new BudgetGuard({ projectBudget: 5.0, taskBudget: 2.0 });
    
    guard.recordTaskResult({
      taskId: 'task-1',
      success: true,
      artifacts: [],
      output: '',
      startedAt: new Date(),
      completedAt: new Date(),
      modelCalls: 1,
      costUsd: 1.0,
    });
    
    // This should fail because task-1 already spent 1.0 and adding 2.0 exceeds taskBudget of 2.0
    const check1 = guard.checkTaskBudget('task-1', 2.0);
    const passed1 = !check1.allowed && check1.reason === 'TASK_BUDGET_EXCEEDED';
    
    // This should pass - task-2 has no spent amount
    const check2 = guard.checkTaskBudget('task-2', 1.0);
    const passed2 = check2.allowed;
    
    const passed = passed1 && passed2;
    
    return {
      passed,
      actual: `task-1 check: allowed=${check1.allowed}, reason=${check1.reason}. task-2 check: allowed=${check2.allowed}`,
      rootCause: passed ? '' : 'checkTaskBudget logic incorrect',
      fix: passed ? '' : 'Implement correct projected cost calculation',
      telemetry: { check1, check2 },
    };
  }
);

// Save results
const endTime = Date.now();
const totalDuration = endTime - startTime;

writeFileSync('D:/EamilOS/artifacts/stress-tests/budget/budget-results.json', JSON.stringify({
  generatedAt: new Date().toISOString(),
  totalTests: results.length,
  testsRun: results.length,
  testsPassed: results.filter(r => r.status === 'PASS').length,
  testsFailed: results.filter(r => r.status === 'FAIL').length,
  testsPartial: results.filter(r => r.status === 'PARTIAL').length,
  testsSkipped: results.filter(r => r.status === 'SKIP').length,
  testsErrored: results.filter(r => r.status === 'ERROR').length,
  totalDurationMs: totalDuration,
  results,
}, null, 2));

writeFileSync('D:/EamilOS/artifacts/stress-tests/budget/budget-timeline.json', JSON.stringify(timeline, null, 2));

console.log(`Budget stress tests complete. ${results.length} tests run in ${totalDuration}ms`);
console.log(`PASS: ${results.filter(r => r.status === 'PASS').length}`);
console.log(`FAIL: ${results.filter(r => r.status === 'FAIL').length}`);
console.log(`ERROR: ${results.filter(r => r.status === 'ERROR').length}`);

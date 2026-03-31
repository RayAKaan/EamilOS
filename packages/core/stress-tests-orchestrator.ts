import { writeFileSync } from 'fs';
import { Orchestrator } from './src/orchestrator.js';
import { Project, Task } from './src/types.js';

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
const retryTraces: Array<Record<string, unknown>> = [];
const startTime = Date.now();

function createResult(partial: Partial<TestResult>): TestResult {
  return {
    testId: partial.testId || 'UNKNOWN',
    testName: partial.testName || '',
    category: 'orchestrator',
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

function createMockProject(): Project {
  return {
    id: 'stress-test-project',
    name: 'Stress Test Project',
    rootDir: '/tmp/stress-test',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createMockTask(title: string): Task {
  return {
    id: `stress-task-${Math.random().toString(36).substr(2, 9)}`,
    projectId: 'stress-test-project',
    title,
    description: `Test task: ${title}`,
    type: 'implementation',
    status: 'pending',
    createdAt: new Date(),
  };
}

function runTest(
  testId: string,
  testName: string,
  input: object,
  expected: string,
  testFn: () => { passed: boolean; actual: string; rootCause: string; fix: string; telemetry: Record<string, unknown> }
): void {
  const testStart = Date.now();
  try {
    const outcome = testFn();
    results.push(createResult({
      testId,
      testName,
      input,
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
      input,
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

// O-STRESS-1: Orchestrator initialization
runTest(
  'O-STRESS-1',
  'Orchestrator initialization',
  { maxParallel: 5, maxRetries: 3 },
  'Orchestrator should initialize with custom options',
  () => {
    const orchestrator = new Orchestrator({ maxParallel: 5, maxRetries: 3 });
    const passed = orchestrator !== null && !orchestrator.isRunning();
    return {
      passed,
      actual: `Orchestrator created. Running: ${orchestrator.isRunning()}`,
      rootCause: passed ? '' : 'Orchestrator initialization failed',
      fix: passed ? '' : 'Check Orchestrator constructor',
      telemetry: { isRunning: orchestrator.isRunning() },
    };
  }
);

// O-STRESS-2: Response validation - valid JSON
runTest(
  'O-STRESS-2',
  'Response validation - valid JSON',
  { validJson: '{"files":[{"path":"test.py","content":"print(1)"}]}' },
  'Should validate valid JSON response',
  () => {
    const orchestrator = new Orchestrator();
    const result = orchestrator.validateResponse('{"files":[{"path":"test.py","content":"print(1)"}]}');
    const passed = result.valid === true;
    return {
      passed,
      actual: `Valid: ${result.valid}`,
      rootCause: passed ? '' : 'Valid JSON rejected',
      fix: passed ? '' : 'Check validateResponse implementation',
      telemetry: { result },
    };
  }
);

// O-STRESS-3: Response validation - invalid JSON
runTest(
  'O-STRESS-3',
  'Response validation - invalid JSON',
  { invalidJson: 'Not valid JSON at all' },
  'Should reject invalid JSON response',
  () => {
    const orchestrator = new Orchestrator();
    const result = orchestrator.validateResponse('Not valid JSON at all');
    const passed = result.valid === false;
    return {
      passed,
      actual: `Valid: ${result.valid}, Reason: ${result.reason}`,
      rootCause: passed ? '' : 'Invalid JSON not detected',
      fix: passed ? '' : 'Ensure parser detects non-JSON input',
      telemetry: { result },
    };
  }
);

// O-STRESS-4: Response validation - empty files
runTest(
  'O-STRESS-4',
  'Response validation - empty files',
  { emptyFiles: '{"files":[]}' },
  'Should reject response with empty files array',
  () => {
    const orchestrator = new Orchestrator();
    const result = orchestrator.validateResponse('{"files":[]}');
    const passed = result.valid === false && result.reason === 'NO_VALID_FILES';
    return {
      passed,
      actual: `Valid: ${result.valid}, Reason: ${result.reason}`,
      rootCause: passed ? '' : 'Empty files array not rejected',
      fix: passed ? '' : 'Check for empty files array',
      telemetry: { result },
    };
  }
);

// O-STRESS-5: Response validation - blocked filename
runTest(
  'O-STRESS-5',
  'Response validation - blocked filename',
  { blockedFile: '{"files":[{"path":"data.json","content":"{}"}]}' },
  'Should filter blocked filenames',
  () => {
    const orchestrator = new Orchestrator();
    const result = orchestrator.validateResponse('{"files":[{"path":"data.json","content":"{}"}]}');
    // data.json is blocked, so this should fail with NO_VALID_FILES
    const passed = result.valid === false;
    return {
      passed,
      actual: `Valid: ${result.valid}, Reason: ${result.reason}`,
      rootCause: passed ? '' : 'Blocked filename not filtered',
      fix: passed ? '' : 'Ensure blocked filename list is applied',
      telemetry: { result },
    };
  }
);

// O-STRESS-6: Stop orchestrator
runTest(
  'O-STRESS-6',
  'Stop orchestrator',
  {},
  'Should stop orchestrator cleanly',
  () => {
    const orchestrator = new Orchestrator({ maxParallel: 1 });
    orchestrator.stop();
    const passed = !orchestrator.isRunning();
    return {
      passed,
      actual: `Running: ${orchestrator.isRunning()}`,
      rootCause: passed ? '' : 'Orchestrator did not stop',
      fix: passed ? '' : 'Check stop() method',
      telemetry: { isRunning: orchestrator.isRunning() },
    };
  }
);

// O-STRESS-7: Attempt counting
runTest(
  'O-STRESS-7',
  'Attempt counting',
  {},
  'Should return 0 for non-existent task attempts',
  () => {
    const orchestrator = new Orchestrator();
    const count = orchestrator.getAttemptCount('nonexistent-task');
    const passed = count === 0;
    return {
      passed,
      actual: `Attempt count: ${count}`,
      rootCause: passed ? '' : 'Incorrect default attempt count',
      fix: passed ? '' : 'Return 0 for unknown tasks',
      telemetry: { attemptCount: count },
    };
  }
);

// O-STRESS-8: Execution context retrieval
runTest(
  'O-STRESS-8',
  'Execution context retrieval',
  {},
  'Should return undefined for non-existent execution context',
  () => {
    const orchestrator = new Orchestrator();
    const context = orchestrator.getExecutionContext('nonexistent-task');
    const passed = context === undefined;
    return {
      passed,
      actual: `Context: ${context}`,
      rootCause: passed ? '' : 'Should return undefined for unknown task',
      fix: passed ? '' : 'Return undefined when task not found',
      telemetry: { context },
    };
  }
);

// O-STRESS-9: Response validation - multiple files
runTest(
  'O-STRESS-9',
  'Response validation - multiple valid files',
  { multiFile: '{"files":[{"path":"a.py","content":"x=1"},{"path":"b.py","content":"y=2"},{"path":"c.ts","content":"z=3"}]}' },
  'Should accept multiple valid files',
  () => {
    const orchestrator = new Orchestrator();
    const result = orchestrator.validateResponse('{"files":[{"path":"a.py","content":"x=1"},{"path":"b.py","content":"y=2"},{"path":"c.ts","content":"z=3"}]}');
    const passed = result.valid === true;
    return {
      passed,
      actual: `Valid: ${result.valid}`,
      rootCause: passed ? '' : 'Multiple valid files not accepted',
      fix: passed ? '' : 'Ensure multiple files are validated correctly',
      telemetry: { result },
    };
  }
);

// O-STRESS-10: Response validation - description content
runTest(
  'O-STRESS-10',
  'Response validation - description content',
  { descContent: '{"files":[{"path":"desc.py","content":"This file implements a calculator"}]}' },
  'Should reject file with description content instead of code',
  () => {
    const orchestrator = new Orchestrator();
    const result = orchestrator.validateResponse('{"files":[{"path":"desc.py","content":"This file implements a calculator"}]}');
    // This looks like a description, should be rejected
    const passed = result.valid === false;
    return {
      passed,
      actual: `Valid: ${result.valid}, Reason: ${result.reason}`,
      rootCause: passed ? '' : 'Description content not detected',
      fix: passed ? '' : 'Improve description pattern detection',
      telemetry: { result },
    };
  }
);

// Save results
const endTime = Date.now();
const totalDuration = endTime - startTime;

writeFileSync('D:/EamilOS/artifacts/stress-tests/orchestrator/orchestrator-results.json', JSON.stringify({
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

writeFileSync('D:/EamilOS/artifacts/stress-tests/orchestrator/retry-traces.json', JSON.stringify(retryTraces, null, 2));

console.log(`Orchestrator stress tests complete. ${results.length} tests run in ${totalDuration}ms`);
console.log(`PASS: ${results.filter(r => r.status === 'PASS').length}`);
console.log(`FAIL: ${results.filter(r => r.status === 'FAIL').length}`);
console.log(`ERROR: ${results.filter(r => r.status === 'ERROR').length}`);

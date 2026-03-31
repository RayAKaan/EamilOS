import { nanoid } from 'nanoid';
import { getSecureLogger, SecureLogger } from '../security/SecureLogger.js';
import { StrictOrchestrator } from '../orchestrator/StrictOrchestrator.js';
import { MetricsStore } from './MetricsStore.js';
import { TaskCategory } from './TaskClassifier.js';

export interface BenchmarkTask {
  id: string;
  name: string;
  category: TaskCategory;
  instruction: string;
  expectedFileExtension: string;
  expectedContentPatterns: RegExp[];
  maxAcceptableLatencyMs: number;
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface BenchmarkTaskResult {
  taskId: string;
  taskName: string;
  category: TaskCategory;
  success: boolean;
  latencyMs: number;
  tokensUsed: number;
  retriesUsed: number;
  parseSucceeded: boolean;
  validationSucceeded: boolean;
  contentMatchRate: number;
  fileExtensionCorrect: boolean;
  failureReason?: string;
}

export interface BenchmarkSuiteResult {
  modelId: string;
  provider: string;
  runAt: string;
  totalTasks: number;
  passedTasks: number;
  failedTasks: number;
  overallSuccessRate: number;
  averageLatencyMs: number;
  averageRetries: number;
  jsonComplianceRate: number;
  taskResults: BenchmarkTaskResult[];
  summary: string;
}

export class BenchmarkRunner {

  private metricsStore: MetricsStore;
  private logger: SecureLogger;

  private static readonly BENCHMARK_TASKS: BenchmarkTask[] = [
    {
      id: 'bench-easy-01',
      name: 'Simple Python Function',
      category: 'code',
      instruction: 'Create a Python function called "add" that takes two numbers a and b and returns their sum.',
      expectedFileExtension: '.py',
      expectedContentPatterns: [/def\s+add\s*\(/, /return/],
      maxAcceptableLatencyMs: 10000,
      difficulty: 'easy'
    },
    {
      id: 'bench-easy-02',
      name: 'Hello World Script',
      category: 'simple',
      instruction: 'Create a Python script that prints "Hello, World!"',
      expectedFileExtension: '.py',
      expectedContentPatterns: [/print\s*\(/, /[Hh]ello/],
      maxAcceptableLatencyMs: 8000,
      difficulty: 'easy'
    },
    {
      id: 'bench-easy-03',
      name: 'JavaScript Constant',
      category: 'simple',
      instruction: 'Create a JavaScript file that exports a constant called PI with value 3.14159',
      expectedFileExtension: '.js',
      expectedContentPatterns: [/PI/, /3\.14159/],
      maxAcceptableLatencyMs: 8000,
      difficulty: 'easy'
    },
    {
      id: 'bench-med-01',
      name: 'Python Calculator',
      category: 'code',
      instruction: 'Create a Python file with four functions: add(a,b), subtract(a,b), multiply(a,b), divide(a,b). Each should return the result. Divide should handle division by zero.',
      expectedFileExtension: '.py',
      expectedContentPatterns: [
        /def\s+add/, /def\s+subtract/, /def\s+multiply/, /def\s+divide/
      ],
      maxAcceptableLatencyMs: 15000,
      difficulty: 'medium'
    },
    {
      id: 'bench-med-02',
      name: 'JSON Config Generation',
      category: 'json',
      instruction: 'Create a JSON configuration file called config.json with sections for: database (host, port, name), server (port, host, debug), and logging (level, file).',
      expectedFileExtension: '.json',
      expectedContentPatterns: [
        /database/i, /server/i, /logging/i, /host/i, /port/i
      ],
      maxAcceptableLatencyMs: 10000,
      difficulty: 'medium'
    },
    {
      id: 'bench-med-03',
      name: 'HTML Page',
      category: 'code',
      instruction: 'Create an HTML page with a heading that says "Welcome", a paragraph of text, and a button that says "Click Me".',
      expectedFileExtension: '.html',
      expectedContentPatterns: [
        /<html/i, /[Ww]elcome/, /<button/i, /[Cc]lick\s*[Mm]e/
      ],
      maxAcceptableLatencyMs: 12000,
      difficulty: 'medium'
    },
    {
      id: 'bench-hard-01',
      name: 'Class with Methods',
      category: 'code',
      instruction: 'Create a Python class called "BankAccount" with: __init__(self, owner, balance=0), deposit(amount), withdraw(amount) with insufficient funds check, and get_balance() method. Include a __str__ method.',
      expectedFileExtension: '.py',
      expectedContentPatterns: [
        /class\s+BankAccount/, /def\s+__init__/, /def\s+deposit/,
        /def\s+withdraw/, /def\s+get_balance/
      ],
      maxAcceptableLatencyMs: 20000,
      difficulty: 'hard'
    },
    {
      id: 'bench-hard-02',
      name: 'Multi-File Web Project',
      category: 'multi_file',
      instruction: 'Create a simple web page with three files: index.html with a heading and a div with id "app", style.css with a blue background and centered text, and app.js with code that sets the innerHTML of the "app" div to "Hello from JavaScript".',
      expectedFileExtension: '.html',
      expectedContentPatterns: [
        /<html/i, /background/i, /getElementById|querySelector/i
      ],
      maxAcceptableLatencyMs: 25000,
      difficulty: 'hard'
    },
    {
      id: 'bench-hard-03',
      name: 'Error Handling Pattern',
      category: 'code',
      instruction: 'Create a TypeScript function called "safeDivide" that takes two numbers, returns a Result type (either { success: true, value: number } or { success: false, error: string }), handles division by zero, NaN inputs, and Infinity results.',
      expectedFileExtension: '.ts',
      expectedContentPatterns: [
        /safeDivide/, /success/, /error/, /NaN|isNaN/i
      ],
      maxAcceptableLatencyMs: 15000,
      difficulty: 'hard'
    },
    {
      id: 'bench-edge-01',
      name: 'Ambiguous Instruction',
      category: 'simple',
      instruction: 'Make something cool',
      expectedFileExtension: '.py',
      expectedContentPatterns: [],
      maxAcceptableLatencyMs: 15000,
      difficulty: 'medium'
    }
  ];

  constructor(metricsStore: MetricsStore, logger?: SecureLogger) {
    this.metricsStore = metricsStore;
    this.logger = logger || getSecureLogger();
  }

  getBenchmarkTasks(): BenchmarkTask[] {
    return [...BenchmarkRunner.BENCHMARK_TASKS];
  }

  async runSuite(
    modelId: string,
    provider: string,
    orchestrator: StrictOrchestrator,
    projectId: string,
    options: {
      tasksToRun?: string[];
      timeoutPerTaskMs?: number;
      verbose?: boolean;
    } = {}
  ): Promise<BenchmarkSuiteResult> {
    const tasks = options.tasksToRun
      ? BenchmarkRunner.BENCHMARK_TASKS.filter(t => options.tasksToRun!.includes(t.id))
      : BenchmarkRunner.BENCHMARK_TASKS;

    const timeout = options.timeoutPerTaskMs || 30000;
    const taskResults: BenchmarkTaskResult[] = [];

    this.logger.info(`Starting benchmark suite for ${modelId}`, {
      totalTasks: tasks.length
    });

    for (const task of tasks) {
      if (options.verbose) {
        console.log(`  Running: ${task.name} (${task.difficulty})...`);
      }

      const result = await this.runSingleTask(
        modelId, provider, orchestrator, projectId, task, timeout
      );
      taskResults.push(result);

      this.metricsStore.recordExecution({
        id: nanoid(),
        modelId,
        provider,
        taskCategory: task.category,
        instruction: task.instruction,
        success: result.success,
        retriesUsed: result.retriesUsed,
        latencyMs: result.latencyMs,
        tokensUsed: result.tokensUsed,
        costUsd: 0,
        parseSucceeded: result.parseSucceeded,
        validationSucceeded: result.validationSucceeded,
        failureReason: result.failureReason,
        timestamp: new Date().toISOString()
      });

      if (options.verbose) {
        const status = result.success ? '✅' : '❌';
        console.log(`  ${status} ${task.name}: ${result.latencyMs}ms`);
        if (!result.success) {
          console.log(`     Reason: ${result.failureReason}`);
        }
      }
    }

    const passed = taskResults.filter(r => r.success);
    const avgLatency = taskResults.length > 0
      ? taskResults.reduce((sum, r) => sum + r.latencyMs, 0) / taskResults.length
      : 0;
    const avgRetries = taskResults.length > 0
      ? taskResults.reduce((sum, r) => sum + r.retriesUsed, 0) / taskResults.length
      : 0;
    const jsonCompliance = taskResults.length > 0
      ? taskResults.filter(r => r.parseSucceeded).length / taskResults.length
      : 0;

    const suiteResult: BenchmarkSuiteResult = {
      modelId,
      provider,
      runAt: new Date().toISOString(),
      totalTasks: taskResults.length,
      passedTasks: passed.length,
      failedTasks: taskResults.length - passed.length,
      overallSuccessRate: taskResults.length > 0 ? passed.length / taskResults.length : 0,
      averageLatencyMs: avgLatency,
      averageRetries: avgRetries,
      jsonComplianceRate: jsonCompliance,
      taskResults,
      summary: this.generateSummary(modelId, taskResults)
    };

    this.metricsStore.storeBenchmarkResults(
      modelId,
      provider,
      'standard-v1',
      suiteResult as unknown as Record<string, unknown>
    );

    return suiteResult;
  }

  private async runSingleTask(
    _modelId: string,
    _provider: string,
    orchestrator: StrictOrchestrator,
    projectId: string,
    task: BenchmarkTask,
    timeoutMs: number
  ): Promise<BenchmarkTaskResult> {
    const startTime = Date.now();

    try {
      const executionPromise = orchestrator.execute(task.instruction, projectId);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('BENCHMARK_TIMEOUT')), timeoutMs)
      );

      const result = await Promise.race([executionPromise, timeoutPromise]);
      const latencyMs = Date.now() - startTime;

      if (!result.success || result.files?.length === 0) {
        return {
          taskId: task.id,
          taskName: task.name,
          category: task.category,
          success: false,
          latencyMs,
          tokensUsed: 0,
          retriesUsed: result.attempts - 1,
          parseSucceeded: false,
          validationSucceeded: false,
          contentMatchRate: 0,
          fileExtensionCorrect: false,
          failureReason: result.failureReasons[result.failureReasons.length - 1] || 'NO_OUTPUT'
        };
      }

      if (!result.files || result.files.length === 0) {
        return {
          taskId: task.id,
          taskName: task.name,
          category: task.category,
          success: false,
          latencyMs,
          tokensUsed: 0,
          retriesUsed: result.attempts - 1,
          parseSucceeded: true,
          validationSucceeded: true,
          contentMatchRate: 0,
          fileExtensionCorrect: false,
          failureReason: 'NO_FILES_GENERATED'
        };
      }

      const primaryFile = result.files[0];
      const fileExtensionCorrect = primaryFile.path.endsWith(task.expectedFileExtension);

      const allContent = result.files.map(f => f.content).join('\n');
      const matchedPatterns = task.expectedContentPatterns.filter(p => p.test(allContent));
      const contentMatchRate = task.expectedContentPatterns.length > 0
        ? matchedPatterns.length / task.expectedContentPatterns.length
        : 1;

      const success = contentMatchRate >= 0.5;

      return {
        taskId: task.id,
        taskName: task.name,
        category: task.category,
        success,
        latencyMs,
        tokensUsed: 0,
        retriesUsed: result.attempts - 1,
        parseSucceeded: true,
        validationSucceeded: true,
        contentMatchRate,
        fileExtensionCorrect,
        failureReason: success ? undefined :
          `Content match ${(contentMatchRate * 100).toFixed(0)}% (need 50%).`
      };

    } catch (error) {
      return {
        taskId: task.id,
        taskName: task.name,
        category: task.category,
        success: false,
        latencyMs: Date.now() - startTime,
        tokensUsed: 0,
        retriesUsed: 0,
        parseSucceeded: false,
        validationSucceeded: false,
        contentMatchRate: 0,
        fileExtensionCorrect: false,
        failureReason: error instanceof Error ? error.message : 'UNKNOWN_ERROR'
      };
    }
  }

  private generateSummary(modelId: string, results: BenchmarkTaskResult[]): string {
    const passed = results.filter(r => r.success).length;
    const total = results.length;
    const rate = total > 0 ? ((passed / total) * 100).toFixed(0) : '0';

    const byDifficulty = {
      easy: results.filter(r =>
        BenchmarkRunner.BENCHMARK_TASKS.find(t => t.id === r.taskId)?.difficulty === 'easy'
      ),
      medium: results.filter(r =>
        BenchmarkRunner.BENCHMARK_TASKS.find(t => t.id === r.taskId)?.difficulty === 'medium'
      ),
      hard: results.filter(r =>
        BenchmarkRunner.BENCHMARK_TASKS.find(t => t.id === r.taskId)?.difficulty === 'hard'
      )
    };

    const lines = [
      `Benchmark Results for ${modelId}:`,
      `Overall: ${passed}/${total} (${rate}%)`,
      `Easy: ${byDifficulty.easy.filter(r => r.success).length}/${byDifficulty.easy.length}`,
      `Medium: ${byDifficulty.medium.filter(r => r.success).length}/${byDifficulty.medium.length}`,
      `Hard: ${byDifficulty.hard.filter(r => r.success).length}/${byDifficulty.hard.length}`,
    ];

    return lines.join('\n');
  }

  async runAllModels(
    models: Array<{ modelId: string; provider: string }>,
    orchestrator: StrictOrchestrator,
    projectId: string,
    options: { verbose?: boolean } = {}
  ): Promise<BenchmarkSuiteResult[]> {
    const results: BenchmarkSuiteResult[] = [];

    for (const model of models) {
      if (options.verbose) {
        console.log(`\n Benchmarking: ${model.modelId} (${model.provider})`);
        console.log('─'.repeat(50));
      }

      const result = await this.runSuite(
        model.modelId, model.provider, orchestrator, projectId, options
      );
      results.push(result);
    }

    return results;
  }
}

let globalBenchmarkRunner: BenchmarkRunner | null = null;

export function initBenchmarkRunner(metricsStore?: MetricsStore, logger?: SecureLogger): BenchmarkRunner {
  globalBenchmarkRunner = new BenchmarkRunner(metricsStore || new MetricsStore(), logger);
  return globalBenchmarkRunner;
}

export function getBenchmarkRunner(): BenchmarkRunner {
  if (!globalBenchmarkRunner) {
    return initBenchmarkRunner();
  }
  return globalBenchmarkRunner;
}

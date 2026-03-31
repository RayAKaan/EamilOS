import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'fs';
import { MetricsStore } from '../../src/model-router/MetricsStore.js';
import { TaskClassifier } from '../../src/model-router/TaskClassifier.js';
import { RoutingStrategy } from '../../src/model-router/RoutingStrategy.js';
import { ModelRouter } from '../../src/model-router/AdvancedModelRouter.js';
import { BenchmarkRunner } from '../../src/model-router/BenchmarkRunner.js';

const TEST_DB_PATH = '.eamilos/test-metrics.db';

describe('Model Router Components', () => {
  let store: MetricsStore;

  beforeEach(() => {
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    store = new MetricsStore(TEST_DB_PATH);
  });

  afterEach(() => {
    store.close();
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  describe('MetricsStore', () => {
    it('should record and retrieve executions', () => {
      store.recordExecution({
        id: 'test-1',
        modelId: 'phi3:mini',
        provider: 'ollama',
        taskCategory: 'code',
        instruction: 'Test task',
        success: true,
        retriesUsed: 0,
        latencyMs: 1000,
        tokensUsed: 500,
        costUsd: 0,
        parseSucceeded: true,
        validationSucceeded: true,
        timestamp: new Date().toISOString()
      });

      const metrics = store.getMetrics('phi3:mini');
      expect(metrics).not.toBeNull();
      expect(metrics!.totalTasks).toBe(1);
      expect(metrics!.overallSuccessRate).toBe(1);
      expect(metrics!.provider).toBe('ollama');
    });

    it('should compute correct success rates', () => {
      for (let i = 0; i < 10; i++) {
        store.recordExecution({
          id: `test-${i}`,
          modelId: 'gpt-4o',
          provider: 'openai',
          taskCategory: 'code',
          instruction: 'Test ' + i,
          success: i < 7,
          retriesUsed: i < 7 ? 0 : 2,
          latencyMs: 2000,
          tokensUsed: 500,
          costUsd: 0.02,
          parseSucceeded: i < 8,
          validationSucceeded: i < 7,
          timestamp: new Date().toISOString()
        });
      }

      const metrics = store.getMetrics('gpt-4o');
      expect(metrics!.totalTasks).toBe(10);
      expect(metrics!.overallSuccessRate).toBeCloseTo(0.7, 1);
      expect(metrics!.averageLatencyMs).toBeGreaterThan(0);
    });

    it('should return null for unknown model', () => {
      const metrics = store.getMetrics('nonexistent-model');
      expect(metrics).toBeNull();
    });

    it('should track category-specific metrics', () => {
      store.recordExecution({
        id: 'code-1',
        modelId: 'test-model',
        provider: 'test',
        taskCategory: 'code',
        instruction: 'Code task',
        success: true,
        retriesUsed: 0,
        latencyMs: 1000,
        tokensUsed: 100,
        costUsd: 0,
        parseSucceeded: true,
        validationSucceeded: true,
        timestamp: new Date().toISOString()
      });

      store.recordExecution({
        id: 'json-1',
        modelId: 'test-model',
        provider: 'test',
        taskCategory: 'json',
        instruction: 'JSON task',
        success: true,
        retriesUsed: 0,
        latencyMs: 500,
        tokensUsed: 50,
        costUsd: 0,
        parseSucceeded: true,
        validationSucceeded: true,
        timestamp: new Date().toISOString()
      });

      const metrics = store.getMetrics('test-model');
      expect(metrics!.categoryMetrics['code']).toBeDefined();
      expect(metrics!.categoryMetrics['json']).toBeDefined();
      expect(metrics!.categoryMetrics['code']!.totalTasks).toBe(1);
    });
  });

  describe('TaskClassifier', () => {
    const classifier = new TaskClassifier();

    it('should classify simple tasks', () => {
      const result = classifier.classify('Create a hello world Python script');
      expect(['code', 'simple']).toContain(result.primaryCategory);
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should detect multi-file tasks', () => {
      const result = classifier.classify('Create a web app with index.html, style.css, and app.js');
      expect(result.primaryCategory).toBe('multi_file');
      expect(result.estimatedFiles).toBeGreaterThanOrEqual(3);
    });

    it('should detect JSON tasks', () => {
      const result = classifier.classify('Generate a JSON configuration file for database settings');
      expect(result.primaryCategory).toBe('json');
    });

    it('should detect reasoning tasks', () => {
      const result = classifier.classify('Explain how Python list comprehensions work');
      expect(result.primaryCategory).toBe('reasoning');
    });

    it('should detect debug tasks', () => {
      const result = classifier.classify('Fix the bug in this function');
      expect(result.primaryCategory).toBe('debug');
    });

    it('should detect test tasks', () => {
      const result = classifier.classify('Write unit tests using pytest');
      expect(result.primaryCategory).toBe('test');
    });

    it('should detect refactor tasks', () => {
      const result = classifier.classify('Refactor this module to use async/await');
      expect(result.primaryCategory).toBe('refactor');
    });

    it('should include signals in classification', () => {
      const result = classifier.classify('Create a Python function');
      expect(result.signals.length).toBeGreaterThan(0);
    });
  });

  describe('RoutingStrategy', () => {
    const strategy = new RoutingStrategy();

    const strongModel = {
      modelId: 'gpt-4o',
      provider: 'openai',
      overallSuccessRate: 0.95,
      codeSuccessRate: 0.93,
      jsonComplianceRate: 0.98,
      multiFileSuccessRate: 0.90,
      reasoningSuccessRate: 0.97,
      firstAttemptSuccessRate: 0.85,
      averageRetriesNeeded: 0.3,
      failureRate: 0.05,
      timeoutRate: 0.01,
      parseFailureRate: 0.02,
      validationFailureRate: 0.03,
      averageLatencyMs: 3000,
      p50LatencyMs: 2500,
      p95LatencyMs: 8000,
      averageTokensPerResponse: 800,
      averageCostPerTask: 0.05,
      totalCostUsd: 25.0,
      totalTasks: 500,
      totalSuccesses: 475,
      totalFailures: 25,
      firstSeen: '2024-01-01T00:00:00Z',
      lastUsed: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      categoryMetrics: {
        code: { successRate: 0.93, avgLatencyMs: 3200, avgRetries: 0.4, totalTasks: 200 }
      }
    };

    const weakModel = {
      modelId: 'phi3:mini',
      provider: 'ollama',
      overallSuccessRate: 0.55,
      codeSuccessRate: 0.50,
      jsonComplianceRate: 0.40,
      multiFileSuccessRate: 0.20,
      reasoningSuccessRate: 0.60,
      firstAttemptSuccessRate: 0.30,
      averageRetriesNeeded: 2.5,
      failureRate: 0.45,
      timeoutRate: 0.05,
      parseFailureRate: 0.40,
      validationFailureRate: 0.30,
      averageLatencyMs: 1500,
      p50LatencyMs: 1200,
      p95LatencyMs: 4000,
      averageTokensPerResponse: 400,
      averageCostPerTask: 0,
      totalCostUsd: 0,
      totalTasks: 100,
      totalSuccesses: 55,
      totalFailures: 45,
      firstSeen: '2024-01-01T00:00:00Z',
      lastUsed: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      categoryMetrics: {
        code: { successRate: 0.50, avgLatencyMs: 1600, avgRetries: 2.8, totalTasks: 40 }
      }
    };

    it('should score strong model higher for code tasks', () => {
      const allMetrics = [strongModel, weakModel];
      const strongScore = strategy.scoreModel(strongModel, 'code', allMetrics);
      const weakScore = strategy.scoreModel(weakModel, 'code', allMetrics);
      expect(strongScore.totalScore).toBeGreaterThan(weakScore.totalScore);
    });

    it('should return scores in 0-1 range', () => {
      const allMetrics = [strongModel, weakModel];
      const score = strategy.scoreModel(strongModel, 'code', allMetrics);
      expect(score.totalScore).toBeGreaterThanOrEqual(0);
      expect(score.totalScore).toBeLessThanOrEqual(1);
    });

    it('should include breakdown scores', () => {
      const allMetrics = [strongModel, weakModel];
      const score = strategy.scoreModel(strongModel, 'code', allMetrics);
      expect(score.breakdown).toBeDefined();
      expect(score.breakdown.accuracy).toBeDefined();
      expect(score.breakdown.reliability).toBeDefined();
      expect(score.breakdown.speed).toBeDefined();
      expect(score.breakdown.cost).toBeDefined();
      expect(score.breakdown.categoryFit).toBeDefined();
    });

    it('should generate reasoning', () => {
      const allMetrics = [strongModel, weakModel];
      const score = strategy.scoreModel(strongModel, 'code', allMetrics);
      expect(score.reasoning.length).toBeGreaterThan(0);
    });

    it('should compute confidence based on data volume', () => {
      const allMetrics = [strongModel, weakModel];
      const strongScore = strategy.scoreModel(strongModel, 'code', allMetrics);
      const weakScore = strategy.scoreModel(weakModel, 'code', allMetrics);
      expect(strongScore.confidence).toBeGreaterThan(weakScore.confidence);
    });
  });

  describe('ModelRouter', () => {
    it('should select default model with no data', () => {
      const router = new ModelRouter(store, {
        defaultModel: 'phi3:mini',
        defaultProvider: 'ollama',
        explorationRate: 0
      });

      const availableModels = [
        { modelId: 'phi3:mini', provider: 'ollama' },
        { modelId: 'gpt-4o', provider: 'openai' }
      ];

      const selection = router.selectModel('Create a calculator', availableModels);
      expect(selection.selectionMethod).toBe('default');
      expect(selection.modelId).toBe('phi3:mini');
    });

    it('should select best model with sufficient data', () => {
      for (let i = 0; i < 20; i++) {
        store.recordExecution({
          id: `gpt-${i}`,
          modelId: 'gpt-4o',
          provider: 'openai',
          taskCategory: 'code',
          instruction: 'Code ' + i,
          success: true,
          retriesUsed: 0,
          latencyMs: 2000,
          tokensUsed: 500,
          costUsd: 0.02,
          parseSucceeded: true,
          validationSucceeded: true,
          timestamp: new Date().toISOString()
        });
      }

      for (let i = 0; i < 20; i++) {
        store.recordExecution({
          id: `phi-${i}`,
          modelId: 'phi3:mini',
          provider: 'ollama',
          taskCategory: 'code',
          instruction: 'Code ' + i,
          success: i < 10,
          retriesUsed: i < 10 ? 1 : 3,
          latencyMs: 1000,
          tokensUsed: 300,
          costUsd: 0,
          parseSucceeded: i < 12,
          validationSucceeded: i < 10,
          timestamp: new Date().toISOString()
        });
      }

      const router = new ModelRouter(store, { explorationRate: 0 });
      const availableModels = [
        { modelId: 'phi3:mini', provider: 'ollama' },
        { modelId: 'gpt-4o', provider: 'openai' }
      ];

      const selection = router.selectModel('Create a Python calculator', availableModels);
      expect(selection.selectionMethod).toBe('scored');
      expect(selection.modelId).toBe('gpt-4o');
    });

    it('should respect user overrides', () => {
      const router = new ModelRouter(store, {
        overrides: { code: 'phi3:mini' },
        explorationRate: 0
      });

      const availableModels = [
        { modelId: 'phi3:mini', provider: 'ollama' },
        { modelId: 'gpt-4o', provider: 'openai' }
      ];

      const selection = router.selectModel('Create Python code', availableModels);
      expect(selection.selectionMethod).toBe('override');
      expect(selection.modelId).toBe('phi3:mini');
    });

    it('should provide fallback options', () => {
      for (let i = 0; i < 20; i++) {
        store.recordExecution({
          id: `gpt-${i}`,
          modelId: 'gpt-4o',
          provider: 'openai',
          taskCategory: 'code',
          instruction: 'Code ' + i,
          success: true,
          retriesUsed: 0,
          latencyMs: 2000,
          tokensUsed: 500,
          costUsd: 0.02,
          parseSucceeded: true,
          validationSucceeded: true,
          timestamp: new Date().toISOString()
        });
      }

      const router = new ModelRouter(store, { explorationRate: 0 });
      const availableModels = [
        { modelId: 'phi3:mini', provider: 'ollama' },
        { modelId: 'gpt-4o', provider: 'openai' }
      ];

      const selection = router.selectModel('Create Python code', availableModels);
      const fallback = router.selectFallback('gpt-4o', selection);

      expect(fallback).not.toBeNull();
      expect(fallback!.modelId).toBe('phi3:mini');
      expect(fallback!.selectionMethod).toBe('fallback');
    });

    it('should record execution results', () => {
      const router = new ModelRouter(store);
      const initialMetrics = store.getMetrics('test-model');

      router.recordResult('test-model', 'test', 'Test instruction', {
        success: true,
        retriesUsed: 0,
        latencyMs: 1000,
        tokensUsed: 500,
        costUsd: 0,
        parseSucceeded: true,
        validationSucceeded: true
      });

      const updatedMetrics = store.getMetrics('test-model');
      expect(updatedMetrics!.totalTasks).toBeGreaterThan(initialMetrics?.totalTasks || 0);
    });

    it('should report router status', () => {
      store.recordExecution({
        id: 'test-1',
        modelId: 'test-model',
        provider: 'test',
        taskCategory: 'code',
        instruction: 'Test',
        success: true,
        retriesUsed: 0,
        latencyMs: 1000,
        tokensUsed: 100,
        costUsd: 0,
        parseSucceeded: true,
        validationSucceeded: true,
        timestamp: new Date().toISOString()
      });

      const router = new ModelRouter(store);
      const status = router.getRouterStatus();

      expect(status.totalModelsTracked).toBe(1);
      expect(status.totalExecutionsRecorded).toBe(1);
    });
  });

  describe('BenchmarkRunner', () => {
    it('should have 10 benchmark tasks', () => {
      const runner = new BenchmarkRunner(store);
      const tasks = runner.getBenchmarkTasks();
      expect(tasks.length).toBe(10);
    });

    it('should have all required task fields', () => {
      const runner = new BenchmarkRunner(store);
      const tasks = runner.getBenchmarkTasks();

      for (const task of tasks) {
        expect(task.id).toBeDefined();
        expect(task.name).toBeDefined();
        expect(task.instruction.length).toBeGreaterThan(10);
        expect(task.expectedFileExtension.startsWith('.')).toBe(true);
        expect(['easy', 'medium', 'hard']).toContain(task.difficulty);
      }
    });

    it('should include diverse task difficulties', () => {
      const runner = new BenchmarkRunner(store);
      const tasks = runner.getBenchmarkTasks();

      const difficulties = new Set(tasks.map(t => t.difficulty));
      expect(difficulties.has('easy')).toBe(true);
      expect(difficulties.has('medium')).toBe(true);
      expect(difficulties.has('hard')).toBe(true);
    });
  });
});

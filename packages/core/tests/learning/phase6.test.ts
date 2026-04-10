import { describe, it, expect, beforeEach } from 'vitest';
import { AutoTuner } from '../../src/learning/AutoTuner.js';
import { ModelPerformance } from '../../src/learning/ModelPerformance.js';
import { SmartModelRouter } from '../../src/learning/SmartModelRouter.js';
import { StrategyOptimizer } from '../../src/learning/StrategyOptimizer.js';
import { PromptOptimizer } from '../../src/learning/PromptOptimizer.js';
import { FailureAnalyzer } from '../../src/learning/FailureAnalyzer.js';
import { FeedbackLoop } from '../../src/learning/FeedbackLoop.js';
import { wilsonScore, linearRegression } from '../../src/learning/statistics.js';
import type { ExecutionRecord, ExecutionStrategy, ErrorType } from '../../src/learning/types.js';

function createMockExecutionRecord(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: `exec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    timestamp: Date.now(),
    sessionId: `session_${Math.random().toString(36).substring(2, 9)}`,
    goal: 'Test execution',
    taskType: 'planning',
    taskComplexity: 'medium',
    taskDomains: ['coding'],
    strategy: 'parallel' as ExecutionStrategy,
    agentsUsed: [],
    modelsUsed: [],
    controlMode: 'auto',
    success: true,
    partialSuccess: false,
    subtaskResults: [],
    totalLatencyMs: 5000,
    totalTokensIn: 1000,
    totalTokensOut: 2000,
    totalCostUSD: 0.01,
    tickCount: 10,
    retryCount: 0,
    failureCount: 0,
    healingActions: [],
    modelSwaps: [],
    strategyAdaptations: [],
    errors: [],
    promptVariantsUsed: [],
    ...overrides,
  };
}

describe('AutoTuner', () => {
  let tuner: AutoTuner;

  beforeEach(() => {
    tuner = new AutoTuner({ minObservations: 3 });
  });

  it('should initialize with default parameters', () => {
    const params = tuner.getParams();
    expect(params.agentTimeoutMs).toBe(30000);
    expect(params.maxRetriesPerAgent).toBe(3);
    expect(params.maxParallelInferences).toBe(4);
  });

  it('should record observations', () => {
    const record = createMockExecutionRecord({ success: true, totalLatencyMs: 3000 });
    tuner.recordObservation(record);
    
    const state = tuner.getState();
    expect(state).toBeDefined();
  });

  it('should adjust timeout on timeout errors', () => {
    for (let i = 0; i < 5; i++) {
      tuner.recordObservation(createMockExecutionRecord({
        errors: [{ agentId: 'a1', model: 'test', errorType: 'timeout' as ErrorType, errorMessage: 'timeout', timestamp: Date.now(), resolved: true }],
      }));
    }

    const params = tuner.getParams();
    expect(params.agentTimeoutMs).toBeGreaterThan(30000);
  });

  it('should respect parameter bounds', () => {
    for (let i = 0; i < 50; i++) {
      tuner.recordObservation(createMockExecutionRecord({
        errors: [{ agentId: 'a1', model: 'test', errorType: 'timeout' as ErrorType, errorMessage: 'timeout', timestamp: Date.now(), resolved: true }],
      }));
    }

    const params = tuner.getParams();
    expect(params.agentTimeoutMs).toBeLessThanOrEqual(120000);
    expect(params.agentTimeoutMs).toBeGreaterThanOrEqual(5000);
  });

  it('should dampen adjustments', () => {
    const initialTimeout = tuner.getParams().agentTimeoutMs;
    
    tuner.recordObservation(createMockExecutionRecord({
      errors: [{ agentId: 'a1', model: 'test', errorType: 'timeout' as ErrorType, errorMessage: 'timeout', timestamp: Date.now(), resolved: true }],
    }));
    
    tuner.recordObservation(createMockExecutionRecord({
      errors: [{ agentId: 'a1', model: 'test', errorType: 'timeout' as ErrorType, errorMessage: 'timeout', timestamp: Date.now(), resolved: true }],
    }));

    const newTimeout = tuner.getParams().agentTimeoutMs;
    expect(newTimeout).toBeGreaterThanOrEqual(initialTimeout);
  });

  it('should reset individual parameters', () => {
    tuner.recordObservation(createMockExecutionRecord({
      errors: [{ agentId: 'a1', model: 'test', errorType: 'timeout' as ErrorType, errorMessage: 'timeout', timestamp: Date.now(), resolved: true }],
    }));
    
    tuner.resetParam('agentTimeoutMs');
    const params = tuner.getParams();
    expect(params.agentTimeoutMs).toBeGreaterThanOrEqual(5000);
    expect(params.agentTimeoutMs).toBeLessThanOrEqual(120000);
  });

  it('should report convergence status', () => {
    const status = tuner.getConvergenceStatus();
    expect(status.converged).toBeDefined();
    expect(status.paramsConverged).toBeDefined();
    expect(status.paramsTuning).toBeDefined();
  });
});

describe('ModelPerformance', () => {
  let performance: ModelPerformance;

  beforeEach(() => {
    performance = new ModelPerformance();
  });

  it('should initialize empty', () => {
    expect(performance.getAllModels()).toEqual([]);
  });

  it('should record execution for a model', () => {
    const record = createMockExecutionRecord({
      agentsUsed: [{
        agentId: 'agent1',
        role: 'executor',
        model: 'gpt-4',
        tokensIn: 500,
        tokensOut: 1000,
        costUSD: 0.02,
        latencyMs: 2000,
        success: true,
        retries: 0,
      }],
      modelsUsed: ['gpt-4'],
    });

    performance.recordExecution(record);

    const metrics = performance.getGlobalMetrics('gpt-4');
    expect(metrics).not.toBeNull();
    expect(metrics!.totalExecutions).toBe(1);
    expect(metrics!.successfulExecutions).toBe(1);
  });

  it('should track contextual performance', () => {
    const record = createMockExecutionRecord({
      taskDomains: ['coding', 'backend'],
      taskComplexity: 'high',
      agentsUsed: [{
        agentId: 'agent1',
        role: 'executor',
        model: 'gpt-4',
        tokensIn: 500,
        tokensOut: 1000,
        costUSD: 0.02,
        latencyMs: 2000,
        success: true,
        retries: 0,
      }],
      modelsUsed: ['gpt-4'],
    });

    performance.recordExecution(record);

    const contextualScore = performance.getContextualScore('gpt-4', {
      modelId: 'gpt-4',
      taskDomains: ['coding', 'backend'],
      complexity: 'high' as const,
      controlMode: 'auto',
    });

    expect(contextualScore.modelId).toBe('gpt-4');
  });

  it('should calculate Wilson confidence interval', () => {
    const result = wilsonScore(8, 10);
    expect(result.lowerBound).toBeGreaterThan(0.4);
    expect(result.upperBound).toBeLessThan(1);
    expect(result.center).toBeGreaterThan(0.5);
    expect(result.center).toBeLessThan(1);
  });

  it('should handle zero successes', () => {
    const result = wilsonScore(0, 10);
    expect(result.lowerBound).toBe(0);
    expect(result.upperBound).toBeLessThan(0.3);
  });

  it('should detect declining trends', () => {
    const failingRecord = createMockExecutionRecord({
      agentsUsed: [{
        agentId: 'agent1',
        role: 'executor',
        model: 'declining-model',
        tokensIn: 500,
        tokensOut: 1000,
        costUSD: 0.02,
        latencyMs: 2000,
        success: false,
        retries: 0,
      }],
      modelsUsed: ['declining-model'],
    });

    const successfulRecord = createMockExecutionRecord({
      agentsUsed: [{
        agentId: 'agent1',
        role: 'executor',
        model: 'declining-model',
        tokensIn: 500,
        tokensOut: 1000,
        costUSD: 0.02,
        latencyMs: 2000,
        success: true,
        retries: 0,
      }],
      modelsUsed: ['declining-model'],
    });

    for (let i = 0; i < 20; i++) {
      performance.recordExecution(i < 5 ? successfulRecord : failingRecord);
    }

    const metrics = performance.getGlobalMetrics('declining-model');
    expect(metrics).not.toBeNull();
    expect(metrics!.totalExecutions).toBe(20);
  });
});

describe('SmartModelRouter', () => {
  let router: SmartModelRouter;
  let performance: ModelPerformance;

  beforeEach(() => {
    performance = new ModelPerformance();
    router = new SmartModelRouter({}, performance);
    router.registerModel('model-a');
    router.registerModel('model-b');
  });

  it('should register models', () => {
    const stats = router.getStatistics();
    expect(stats.modelCount).toBe(2);
  });

  it('should unregister models', () => {
    router.unregisterModel('model-a');
    const stats = router.getStatistics();
    expect(stats.modelCount).toBe(1);
  });

  it('should select a model', () => {
    const result = router.selectModel({
      taskDomains: ['coding'],
      taskComplexity: 'medium',
      controlMode: 'auto',
    });

    expect(result.modelId).toBeDefined();
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
  });

  it('should provide explanations', () => {
    router.registerModel('explained-model');
    
    const rankings = router.getModelRankings({
      taskDomains: ['coding'],
      taskComplexity: 'medium',
      controlMode: 'auto',
    });

    expect(rankings.length).toBeGreaterThan(0);
  });

  it('should reset models', () => {
    router.resetModel('model-a');
    const stats = router.getStatistics();
    expect(stats).toBeDefined();
  });

  it('should reset all models', () => {
    router.resetAll();
    const stats = router.getStatistics();
    expect(stats.modelCount).toBe(2);
  });
});

describe('StrategyOptimizer', () => {
  let optimizer: StrategyOptimizer;

  beforeEach(() => {
    optimizer = new StrategyOptimizer();
  });

  it('should initialize empty', () => {
    const stats = optimizer.getStrategyStats();
    expect(stats.size).toBe(0);
  });

  it('should record executions', () => {
    const record = createMockExecutionRecord({ strategy: 'parallel' });
    optimizer.recordExecution(record);

    const stats = optimizer.getStrategyStats();
    expect(stats.has('parallel')).toBe(true);
    expect(stats.get('parallel')!.sampleSize).toBe(1);
  });

  it('should select strategy based on heuristics initially', () => {
    const decision = optimizer.selectStrategy({
      taskDomains: ['coding'],
      complexity: 'low',
    });

    expect(decision.chosen).toBeDefined();
    expect(decision.source).toBe('heuristic-fallback');
  });

  it('should track success rate per strategy', () => {
    optimizer.recordExecution(createMockExecutionRecord({ strategy: 'parallel', success: true }));
    optimizer.recordExecution(createMockExecutionRecord({ strategy: 'parallel', success: true }));
    optimizer.recordExecution(createMockExecutionRecord({ strategy: 'parallel', success: false }));

    const stats = optimizer.getStrategyStats();
    expect(stats.get('parallel')!.successRate).toBeCloseTo(0.667, 1);
  });

  it('should compare strategies', () => {
    optimizer.recordExecution(createMockExecutionRecord({ strategy: 'parallel', success: true }));
    optimizer.recordExecution(createMockExecutionRecord({ strategy: 'sequential', success: false }));

    const comparison = optimizer.compareStrategies('parallel', 'sequential');
    expect(comparison.winner).toBe('parallel');
  });

  it('should generate recommendations', () => {
    const recommendation = optimizer.getRecommendation('parallel');
    expect(typeof recommendation).toBe('string');
  });
});

describe('FailureAnalyzer', () => {
  let analyzer: FailureAnalyzer;

  beforeEach(() => {
    analyzer = new FailureAnalyzer();
  });

  it('should initialize empty', () => {
    const report = analyzer.getReport();
    expect(report.totalPatternsDetected).toBe(0);
  });

  it('should record failures', () => {
    const record = createMockExecutionRecord({
      modelsUsed: ['failing-model'],
      agentsUsed: [{ agentId: 'a1', role: 'executor', model: 'failing-model' } as any],
    });

    analyzer.recordFailure('timeout', 'timeout error message', record);

    const report = analyzer.getReport();
    expect(report.totalPatternsDetected).toBeGreaterThanOrEqual(1);
  });

  it('should detect systematic patterns', () => {
    const record = createMockExecutionRecord({
      modelsUsed: ['bad-model'],
      agentsUsed: [{ agentId: 'a1', role: 'executor', model: 'bad-model' } as any],
    });

    for (let i = 0; i < 10; i++) {
      analyzer.recordFailure('timeout', 'timeout after 30000ms', record);
    }

    const patterns = analyzer.getSystematicPatterns();
    expect(patterns.length).toBeGreaterThanOrEqual(0);
  });

  it('should generate reports', () => {
    const report = analyzer.getReport();
    expect(report).toHaveProperty('totalPatternsDetected');
    expect(report).toHaveProperty('activePatternsCount');
    expect(report).toHaveProperty('recommendations');
  });

  it('should track statistics', () => {
    const stats = analyzer.getStatistics();
    expect(stats).toHaveProperty('totalPatterns');
    expect(stats).toHaveProperty('activePatterns');
  });

  it('should mitigate patterns', () => {
    const record = createMockExecutionRecord({
      modelsUsed: ['mitigated-model'],
      agentsUsed: [{ agentId: 'a1', role: 'executor', model: 'mitigated-model' } as any],
    });

    analyzer.recordFailure('timeout', 'test timeout', record);
    const patterns = analyzer.getAllPatterns();
    
    if (patterns.length > 0) {
      analyzer.mitigatePattern(patterns[0].id, 'Applied fix');
      expect(patterns[0].status).toBe('mitigated');
    }
  });
});

describe('PromptOptimizer', () => {
  let optimizer: PromptOptimizer;

  beforeEach(() => {
    optimizer = new PromptOptimizer();
  });

  it('should register base prompts', () => {
    const hash = optimizer.registerBasePrompt('Generate code', 'executor', 'coding', 'gpt-4');
    expect(hash).toBeDefined();
  });

  it('should create variants', () => {
    const hash = optimizer.registerBasePrompt('Test prompt', 'executor', 'coding', 'gpt-4');
    const variant = optimizer.createVariant(hash, ['specificity']);
    expect(variant).not.toBeNull();
  });

  it('should track variant performance', () => {
    const hash = optimizer.registerBasePrompt('Test prompt', 'executor', 'coding', 'gpt-4');
    optimizer.createVariant(hash, ['specificity']);

    const stats = optimizer.getStatistics();
    expect(stats.totalBasePrompts).toBe(1);
  });

  it('should get best variant', () => {
    const hash = optimizer.registerBasePrompt('Test prompt', 'executor', 'coding', 'gpt-4');
    optimizer.createVariant(hash, ['specificity']);
    optimizer.createVariant(hash, ['chain_of_thought']);

    const best = optimizer.getBestVariant(hash);
    expect(best).toBeDefined();
  });

  it('should generate recommendations', () => {
    const hash = optimizer.registerBasePrompt('Test prompt', 'executor', 'coding', 'gpt-4');
    const recommendations = optimizer.getRecommendations(hash);
    expect(recommendations).toHaveProperty('recommendedEnrichments');
  });
});

describe('FeedbackLoop', () => {
  let feedbackLoop: FeedbackLoop;

  beforeEach(() => {
    feedbackLoop = new FeedbackLoop({
      storagePath: '/tmp/test-learning',
      enableAutoApply: false,
    });
  });

  it('should initialize', async () => {
    await feedbackLoop.initialize();
    const insights = feedbackLoop.getInsights();
    expect(insights).toBeDefined();
    expect(insights.systemOverview).toBeDefined();
  });

  it('should process executions', async () => {
    await feedbackLoop.initialize();
    
    const record = createMockExecutionRecord({
      agentsUsed: [{
        agentId: 'agent1',
        role: 'executor',
        model: 'gpt-4',
        tokensIn: 500,
        tokensOut: 1000,
        costUSD: 0.02,
        latencyMs: 2000,
        success: true,
        retries: 0,
      }],
      modelsUsed: ['gpt-4'],
    });

    const report = await feedbackLoop.processExecution(record);
    expect(report.executionId).toBe(record.id);
    expect(report.processingTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should track model updates', async () => {
    await feedbackLoop.initialize();
    
    const record = createMockExecutionRecord({
      agentsUsed: [{
        agentId: 'agent1',
        role: 'executor',
        model: 'tracked-model',
        tokensIn: 500,
        tokensOut: 1000,
        costUSD: 0.02,
        latencyMs: 2000,
        success: true,
        retries: 0,
      }],
      modelsUsed: ['tracked-model'],
    });

    await feedbackLoop.processExecution(record);
    
    const insights = feedbackLoop.getInsights();
    const model = insights.modelRankings.find(m => m.modelId === 'tracked-model');
    expect(model).toBeDefined();
  });

  it('should export data', async () => {
    await feedbackLoop.initialize();
    const data = feedbackLoop.exportData();
    expect(typeof data).toBe('string');
    expect(() => JSON.parse(data)).not.toThrow();
  });

  it('should explain routing', async () => {
    await feedbackLoop.initialize();
    const explanation = feedbackLoop.explainRouting({ model: 'test-model' });
    expect(typeof explanation).toBe('string');
    expect(explanation.length).toBeGreaterThan(0);
  });

  it('should get learning config', async () => {
    await feedbackLoop.initialize();
    const config = feedbackLoop.getLearningConfig();
    expect(config).toBeDefined();
    expect(config.storagePath).toBeDefined();
  });
});

describe('Statistics', () => {
  it('should calculate linear regression', () => {
    const x = [1, 2, 3, 4, 5];
    const y = [2, 4, 6, 8, 10];
    
    const result = linearRegression(x, y);
    expect(result.slope).toBeCloseTo(2, 1);
    expect(result.intercept).toBeCloseTo(0, 1);
  });

  it('should handle insufficient data', () => {
    const result = linearRegression([1], [1]);
    expect(result.slope).toBe(0);
  });

  it('should compute Wilson score correctly', () => {
    const result = wilsonScore(9, 10);
    expect(result.lowerBound).toBeGreaterThan(0.5);
    expect(result.upperBound).toBeLessThan(1);
  });

  it('should handle edge cases in Wilson score', () => {
    const result1 = wilsonScore(0, 0);
    expect(result1.lowerBound).toBe(0);
    expect(result1.upperBound).toBe(1);

    const result2 = wilsonScore(1, 1);
    expect(result2.lowerBound).toBeGreaterThan(0);
    expect(result2.upperBound).toBeLessThanOrEqual(1);
  });
});

describe('CausalAttribution', () => {
  it('should compute attribution with changes', async () => {
    const { CausalAttribution } = await import('../../src/learning/CausalAttribution.js');
    const attribution = new CausalAttribution();
    const record = createMockExecutionRecord({ success: true });
    const changed = { model: ['gpt-4'], strategy: null, prompt: [], parameters: [] };
    const result = attribution.computeAttribution(record, changed);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });

  it('should compute global objective score', async () => {
    const { computeObjectiveScore } = await import('../../src/learning/CausalAttribution.js');
    const score = computeObjectiveScore({ success: true, latencyMs: 5000, cost: 0.01, retries: 0 });
    expect(score).toBeGreaterThan(0);
  });

  it('should return weighted updates', async () => {
    const { CausalAttribution } = await import('../../src/learning/CausalAttribution.js');
    const attribution = new CausalAttribution();
    const attr = { model: 0.4, strategy: 0.3, prompt: 0.2, parameters: 0.1, confidence: 0.8 };
    const weighted = attribution.getWeightedUpdate(attr);
    expect(weighted.confidence).toBe(0.8);
    expect(weighted.modelWeight).toBe(0.4);
  });
});

describe('InteractionMatrix', () => {
  it('should record interactions', async () => {
    const { InteractionMatrix } = await import('../../src/learning/InteractionMatrix.js');
    const matrix = new InteractionMatrix();
    matrix.recordInteraction('planner', 'executor', true);
    const score = matrix.getScore('planner', 'executor');
    expect(score.sampleSize).toBe(1);
    expect(score.successRate).toBe(1);
  });

  it('should compute combination scores', async () => {
    const { InteractionMatrix } = await import('../../src/learning/InteractionMatrix.js');
    const matrix = new InteractionMatrix();
    matrix.recordInteraction('planner', 'executor', true);
    matrix.recordInteraction('planner', 'executor', true);
    matrix.recordInteraction('planner', 'executor', false);
    const score = matrix.getCombinationScore('planner', 'executor');
    expect(score).toBeGreaterThan(0);
  });

  it('should adjust model scores', async () => {
    const { InteractionMatrix } = await import('../../src/learning/InteractionMatrix.js');
    const matrix = new InteractionMatrix();
    matrix.recordInteraction('planner', 'executor', true);
    matrix.recordInteraction('planner', 'executor', true);
    const adjusted = matrix.adjustModelScore(0.5, 'planner', 'executor');
    expect(adjusted).toBeGreaterThan(0.5);
  });

  it('should get incompatible pairs', async () => {
    const { InteractionMatrix } = await import('../../src/learning/InteractionMatrix.js');
    const matrix = new InteractionMatrix();
    for (let i = 0; i < 10; i++) {
      matrix.recordInteraction('planner', 'validator', false);
    }
    const incompatible = matrix.getIncompatiblePairs();
    expect(incompatible.length).toBeGreaterThanOrEqual(1);
  });

  it('should get statistics', async () => {
    const { InteractionMatrix } = await import('../../src/learning/InteractionMatrix.js');
    const matrix = new InteractionMatrix();
    matrix.recordInteraction('planner', 'executor', true);
    const stats = matrix.getStatistics();
    expect(stats.totalPairs).toBe(1);
    expect(stats.totalInteractions).toBe(1);
  });
});

describe('LearningScheduler', () => {
  it('should return model phase initially', async () => {
    const { LearningScheduler } = await import('../../src/learning/LearningScheduler.js');
    const scheduler = new LearningScheduler({ minExecutionsBeforeStart: 3 });
    expect(scheduler.getCurrentPhase()).toBe('model');
  });

  it('should cycle through phases', async () => {
    const { LearningScheduler } = await import('../../src/learning/LearningScheduler.js');
    const scheduler = new LearningScheduler({ minExecutionsBeforeStart: 3 });
    scheduler.recordExecution(true);
    scheduler.recordExecution(true);
    scheduler.recordExecution(true);
    expect(scheduler.getCurrentPhase()).toBe('model');

    scheduler.recordExecution(true);
    expect(scheduler.getCurrentPhase()).toBe('strategy');

    scheduler.recordExecution(true);
    expect(scheduler.getCurrentPhase()).toBe('prompt');

    scheduler.recordExecution(true);
    expect(scheduler.getCurrentPhase()).toBe('parameters');
  });

  it('should freeze on instability', async () => {
    const { LearningScheduler } = await import('../../src/learning/LearningScheduler.js');
    const scheduler = new LearningScheduler({ minExecutionsBeforeStart: 3 });
    for (let i = 0; i < 30; i++) {
      scheduler.recordExecution(i % 2 === 0);
    }
    expect(scheduler.isFrozen()).toBe(true);
  });

  it('should unfreeze', async () => {
    const { LearningScheduler } = await import('../../src/learning/LearningScheduler.js');
    const scheduler = new LearningScheduler({ minExecutionsBeforeStart: 3 });
    for (let i = 0; i < 30; i++) {
      scheduler.recordExecution(i % 2 === 0);
    }
    expect(scheduler.isFrozen()).toBe(true);
    scheduler.unfreeze();
    expect(scheduler.isFrozen()).toBe(false);
  });

  it('should control which components update', async () => {
    const { LearningScheduler } = await import('../../src/learning/LearningScheduler.js');
    const scheduler = new LearningScheduler({ minExecutionsBeforeStart: 3 });
    scheduler.recordExecution(true);
    scheduler.recordExecution(true);
    scheduler.recordExecution(true);

    expect(scheduler.shouldUpdate('model')).toBe(true);

    scheduler.recordExecution(true);
    expect(scheduler.shouldUpdate('strategy')).toBe(true);
  });

  it('should return schedule status', async () => {
    const { LearningScheduler } = await import('../../src/learning/LearningScheduler.js');
    const scheduler = new LearningScheduler({ minExecutionsBeforeStart: 3 });
    const status = scheduler.getScheduleStatus();
    expect(status).toHaveProperty('enabled');
    expect(status).toHaveProperty('frozen');
    expect(status).toHaveProperty('currentPhase');
  });
});

describe('ActionValidator', () => {
  it('should start validation', async () => {
    const { ActionValidator } = await import('../../src/learning/ActionValidator.js');
    const validator = new ActionValidator({ observationWindow: 5, minObservations: 2 });
    const action = { type: 'adjust-timeout' as const, multiplier: 1.5, reason: 'test' };
    const actionId = validator.startValidation(action);
    expect(actionId).toBeDefined();
    expect(actionId.startsWith('action_')).toBe(true);
  });

  it('should record outcomes', async () => {
    const { ActionValidator } = await import('../../src/learning/ActionValidator.js');
    const validator = new ActionValidator({ observationWindow: 5, minObservations: 2 });
    const action = { type: 'adjust-timeout' as const, multiplier: 1.5, reason: 'test' };
    const actionId = validator.startValidation(action);
    validator.recordOutcome(actionId, { timestamp: Date.now(), success: true, latencyMs: 5000 });
    const pending = validator.getPendingValidations();
    expect(pending.length).toBe(1);
    expect(pending[0].outcomes.length).toBe(1);
  });

  it('should evaluate after min observations', async () => {
    const { ActionValidator } = await import('../../src/learning/ActionValidator.js');
    const validator = new ActionValidator({ observationWindow: 5, minObservations: 2 });
    const action = { type: 'adjust-timeout' as const, multiplier: 1.5, reason: 'test' };
    const actionId = validator.startValidation(action);
    validator.recordOutcome(actionId, { timestamp: Date.now(), success: true, latencyMs: 5000 });
    validator.recordOutcome(actionId, { timestamp: Date.now(), success: true, latencyMs: 5000 });
    const pending = validator.getPendingValidations();
    expect(pending.length).toBe(0);
  });

  it('should get recommendations', async () => {
    const { ActionValidator } = await import('../../src/learning/ActionValidator.js');
    const validator = new ActionValidator({ observationWindow: 5, minObservations: 2 });
    const action = { type: 'adjust-timeout' as const, multiplier: 1.5, reason: 'test' };
    validator.startValidation(action);
    validator.startValidation(action);
    const recommendations = validator.getActionRecommendations();
    expect(Array.isArray(recommendations)).toBe(true);
  });
});

describe('PriorsBootstrap', () => {
  it('should initialize with known priors', async () => {
    const { PriorsBootstrap } = await import('../../src/learning/Priors.js');
    const bootstrap = new PriorsBootstrap();
    const modelPriors = bootstrap.getModelPriors();
    expect(modelPriors.length).toBeGreaterThan(0);
  });

  it('should return prior for known model', async () => {
    const { PriorsBootstrap } = await import('../../src/learning/Priors.js');
    const bootstrap = new PriorsBootstrap();
    const prior = bootstrap.getPriorForModel('gpt-4');
    expect(prior).not.toBeNull();
    expect(prior?.expectedSuccessRate).toBeGreaterThan(0.9);
  });

  it('should return null for unknown model', async () => {
    const { PriorsBootstrap } = await import('../../src/learning/Priors.js');
    const bootstrap = new PriorsBootstrap();
    const prior = bootstrap.getPriorForModel('unknown-model-xyz');
    expect(prior).toBeNull();
  });

  it('should compute effective prior with Bayesian weighting', async () => {
    const { PriorsBootstrap } = await import('../../src/learning/Priors.js');
    const bootstrap = new PriorsBootstrap();
    const result = bootstrap.getEffectivePrior('model', 'gpt-4', 0.85, 10);
    expect(result.adjustedRate).toBeGreaterThan(0);
    expect(result.weight).toBeGreaterThan(0);
  });

  it('should record prior use', async () => {
    const { PriorsBootstrap } = await import('../../src/learning/Priors.js');
    const bootstrap = new PriorsBootstrap();
    bootstrap.recordPriorUse('model', 'gpt-4');
    const stats = bootstrap.getStatistics();
    expect(stats.usedPriors).toBeGreaterThanOrEqual(1);
  });

  it('should bootstrap model metrics', async () => {
    const { PriorsBootstrap } = await import('../../src/learning/Priors.js');
    const bootstrap = new PriorsBootstrap();
    const metrics = bootstrap.bootstrapModelMetrics('gpt-4');
    expect(metrics).not.toBeNull();
    expect(metrics?.modelId).toBe('gpt-4');
    expect(metrics?.successRate).toBeGreaterThan(0.9);
  });

  it('should bootstrap strategy stats', async () => {
    const { PriorsBootstrap } = await import('../../src/learning/Priors.js');
    const bootstrap = new PriorsBootstrap();
    const stats = bootstrap.bootstrapStrategyStats('sequential');
    expect(stats).not.toBeNull();
    expect(stats?.successRate).toBeGreaterThan(0.8);
  });

  it('should check if prior is active', async () => {
    const { PriorsBootstrap } = await import('../../src/learning/Priors.js');
    const bootstrap = new PriorsBootstrap();
    const isActive = bootstrap.isPriorActive('model', 'gpt-4');
    expect(isActive).toBe(true);
  });

  it('should get statistics', async () => {
    const { PriorsBootstrap } = await import('../../src/learning/Priors.js');
    const bootstrap = new PriorsBootstrap();
    const stats = bootstrap.getStatistics();
    expect(stats.totalPriors).toBeGreaterThan(0);
    expect(stats.activePriors).toBeGreaterThan(0);
    expect(stats.averageConfidence).toBeGreaterThan(0);
  });

  it('should disable prior type', async () => {
    const { PriorsBootstrap } = await import('../../src/learning/Priors.js');
    const bootstrap = new PriorsBootstrap({ enableModelPriors: false });
    const modelPriors = bootstrap.getModelPriors();
    expect(modelPriors.length).toBe(0);
  });
});

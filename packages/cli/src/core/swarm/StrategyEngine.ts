import type {
  ExecutionStrategy,
  StrategyDecision,
  TaskAnalysis,
  SwarmConstraints,
} from './types.js';

export interface StrategyConfig {
  sequential: { maxDepth: number };
  pipeline: { stages: number };
  parallel: { maxConcurrency: number };
  competitive: { competitors: number; rounds: number };
  iterative: { maxIterations: number; convergenceThreshold: number };
  hierarchical: { levels: number };
  adaptive: { evaluationInterval: number };
}

export class StrategyEngine {
  private currentStrategy: ExecutionStrategy;
  private config: StrategyConfig;
  private strategyHistory: StrategyDecision[] = [];

  constructor(defaultStrategy: ExecutionStrategy = 'adaptive') {
    this.currentStrategy = defaultStrategy;
    this.config = {
      sequential: { maxDepth: 10 },
      pipeline: { stages: 4 },
      parallel: { maxConcurrency: 5 },
      competitive: { competitors: 3, rounds: 2 },
      iterative: { maxIterations: 5, convergenceThreshold: 0.05 },
      hierarchical: { levels: 3 },
      adaptive: { evaluationInterval: 2 },
    };
  }

  selectStrategy(taskAnalysis: TaskAnalysis, constraints: SwarmConstraints): StrategyDecision {
    const candidates = this.evaluateStrategies(taskAnalysis, constraints);
    const selected = candidates[0];

    const decision: StrategyDecision = {
      chosen: selected.strategy,
      reasoning: selected.reasoning,
      fallbackStrategy: candidates[1]?.strategy || 'sequential',
      maxIterations: selected.config?.maxIterations,
      competitorCount: selected.config?.competitorCount,
    };

    this.currentStrategy = selected.strategy;
    this.strategyHistory.push(decision);

    return decision;
  }

  private evaluateStrategies(
    taskAnalysis: TaskAnalysis,
    constraints: SwarmConstraints
  ): Array<{ strategy: ExecutionStrategy; score: number; reasoning: string; config?: Record<string, number> }> {
    const strategies: Array<{
      strategy: ExecutionStrategy;
      evaluator: () => { score: number; reasoning: string; config?: Record<string, number> };
    }> = [
      {
        strategy: 'sequential',
        evaluator: () => this.evaluateSequential(taskAnalysis, constraints),
      },
      {
        strategy: 'pipeline',
        evaluator: () => this.evaluatePipeline(taskAnalysis, constraints),
      },
      {
        strategy: 'parallel',
        evaluator: () => this.evaluateParallel(taskAnalysis, constraints),
      },
      {
        strategy: 'competitive',
        evaluator: () => this.evaluateCompetitive(taskAnalysis, constraints),
      },
      {
        strategy: 'iterative',
        evaluator: () => this.evaluateIterative(taskAnalysis, constraints),
      },
      {
        strategy: 'hierarchical',
        evaluator: () => this.evaluateHierarchical(taskAnalysis, constraints),
      },
      {
        strategy: 'adaptive',
        evaluator: () => this.evaluateAdaptive(taskAnalysis, constraints),
      },
    ];

    return strategies
      .map(({ strategy, evaluator }) => ({ strategy, ...evaluator() }))
      .sort((a, b) => b.score - a.score);
  }

  private evaluateSequential(
    taskAnalysis: TaskAnalysis,
    _constraints: SwarmConstraints
  ): { score: number; reasoning: string } {
    let score = 0.5;

    if (!taskAnalysis.decomposable) {
      score += 0.3;
    }

    if (taskAnalysis.complexity === 'low' || taskAnalysis.complexity === 'medium') {
      score += 0.2;
    }

    if (taskAnalysis.ambiguityLevel === 'clear') {
      score += 0.1;
    }

    return {
      score: Math.min(1, score),
      reasoning: score > 0.7
        ? 'Best for simple, non-decomposable tasks'
        : 'Acceptable for straightforward sequential execution',
    };
  }

  private evaluatePipeline(
    taskAnalysis: TaskAnalysis,
    _constraints: SwarmConstraints
  ): { score: number; reasoning: string; config: Record<string, number> } {
    let score = 0.4;

    if (taskAnalysis.decomposable) {
      score += 0.35;
    }

    const stages = Math.min(taskAnalysis.domains.length + 1, this.config.pipeline.stages);
    score += stages * 0.05;

    return {
      score: Math.min(1, score),
      reasoning: `Optimal for multi-stage processing with ${stages} stages`,
      config: { stages },
    };
  }

  private evaluateParallel(
    taskAnalysis: TaskAnalysis,
    constraints: SwarmConstraints
  ): { score: number; reasoning: string; config: Record<string, number> } {
    let score = 0.3;

    if (taskAnalysis.decomposable) {
      score += 0.4;
    }

    if (constraints.maxParallelInferences > 1) {
      score += 0.2;
    }

    if (taskAnalysis.domains.length > 1) {
      score += 0.1;
    }

    const maxConcurrency = Math.min(constraints.maxAgents, constraints.maxParallelInferences);

    return {
      score: Math.min(1, score),
      reasoning: `Best for parallel execution across ${maxConcurrency} agents`,
      config: { maxConcurrency },
    };
  }

  private evaluateCompetitive(
    taskAnalysis: TaskAnalysis,
    constraints: SwarmConstraints
  ): { score: number; reasoning: string; config: Record<string, number> } {
    let score = 0.2;

    if (taskAnalysis.ambiguityLevel === 'high' || taskAnalysis.ambiguityLevel === 'moderate') {
      score += 0.4;
    }

    if (taskAnalysis.complexity === 'critical') {
      score += 0.2;
    }

    if (taskAnalysis.domains.includes('reasoning')) {
      score += 0.1;
    }

    const competitors = Math.min(
      this.config.competitive.competitors,
      Math.floor(constraints.maxAgents / 2)
    );

    return {
      score: Math.min(1, score),
      reasoning: `Effective for ambiguous tasks with ${competitors} competing approaches`,
      config: { competitors, rounds: this.config.competitive.rounds },
    };
  }

  private evaluateIterative(
    taskAnalysis: TaskAnalysis,
    constraints: SwarmConstraints
  ): { score: number; reasoning: string; config: Record<string, number> } {
    let score = 0.3;

    if (taskAnalysis.requiresIteration) {
      score += 0.4;
    }

    if (taskAnalysis.domains.includes('review') || taskAnalysis.domains.includes('coding')) {
      score += 0.2;
    }

    const maxIterations = Math.min(
      this.config.iterative.maxIterations,
      Math.floor(constraints.maxTicks / 10)
    );

    return {
      score: Math.min(1, score),
      reasoning: `Suitable for refinement tasks with up to ${maxIterations} iterations`,
      config: { maxIterations, convergenceThreshold: this.config.iterative.convergenceThreshold },
    };
  }

  private evaluateHierarchical(
    taskAnalysis: TaskAnalysis,
    _constraints: SwarmConstraints
  ): { score: number; reasoning: string; config: Record<string, number> } {
    let score = 0.25;

    if (taskAnalysis.domains.length > 2) {
      score += 0.35;
    }

    if (taskAnalysis.complexity === 'high' || taskAnalysis.complexity === 'critical') {
      score += 0.25;
    }

    if (taskAnalysis.decomposable) {
      score += 0.15;
    }

    const levels = Math.min(this.config.hierarchical.levels, Math.ceil(taskAnalysis.domains.length / 2));

    return {
      score: Math.min(1, score),
      reasoning: `Optimal for complex hierarchical tasks with ${levels} management levels`,
      config: { levels },
    };
  }

  private evaluateAdaptive(
    taskAnalysis: TaskAnalysis,
    constraints: SwarmConstraints
  ): { score: number; reasoning: string; config: Record<string, number> } {
    let score = 0.35;

    if (constraints.maxTicks > 50) {
      score += 0.3;
    }

    if (taskAnalysis.complexity === 'critical') {
      score += 0.2;
    }

    if (taskAnalysis.ambiguityLevel !== 'clear') {
      score += 0.15;
    }

    void taskAnalysis;

    return {
      score: Math.min(1, score),
      reasoning: 'Adaptive strategy for complex, evolving task requirements',
      config: { evaluationInterval: this.config.adaptive.evaluationInterval },
    };
  }

  getCurrentStrategy(): ExecutionStrategy {
    return this.currentStrategy;
  }

  setStrategy(strategy: ExecutionStrategy): void {
    this.currentStrategy = strategy;
  }

  getStrategyHistory(): StrategyDecision[] {
    return [...this.strategyHistory];
  }

  getStrategyConfig(strategy: ExecutionStrategy): Record<string, number> | undefined {
    const config = this.config[strategy];
    return config as Record<string, number> | undefined;
  }

  updateStrategyConfig(strategy: ExecutionStrategy, config: Record<string, number>): void {
    if (this.config[strategy]) {
      Object.assign(this.config[strategy], config);
    }
  }
}

let globalEngine: StrategyEngine | null = null;

export function initStrategyEngine(defaultStrategy?: ExecutionStrategy): StrategyEngine {
  globalEngine = new StrategyEngine(defaultStrategy);
  return globalEngine;
}

export function getStrategyEngine(): StrategyEngine | null {
  return globalEngine;
}

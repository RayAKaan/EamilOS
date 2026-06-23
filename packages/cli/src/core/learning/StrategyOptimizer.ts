import { wilsonScore, linearRegression } from './statistics.js';
import type { ExecutionRecord, StrategyDecision, AggregateStats, ConfidenceLevel, ExecutionStrategy } from './types.js';

export interface StrategyConfig {
  minSamplesForDecision: number;
  confidenceThreshold: number;
  explorationRate: number;
  performanceWeights: {
    success: number;
    latency: number;
    cost: number;
    reliability: number;
  };
  strategyMap: Map<string, string[]>;
  heuristicFallback: ExecutionStrategy;
}

export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  minSamplesForDecision: 5,
  confidenceThreshold: 0.7,
  explorationRate: 0.1,
  performanceWeights: {
    success: 0.5,
    latency: 0.2,
    cost: 0.15,
    reliability: 0.15,
  },
  strategyMap: new Map([
    ['sequential', ['Sequential', 'OneByOne', 'single']],
    ['parallel', ['Parallel', 'Concurrent', 'concurrent']],
    ['hierarchical', ['Hierarchical', 'Tree', 'tree']],
    ['adaptive', ['Adaptive', 'Dynamic', 'adaptive']],
    ['iterative', ['Iterative', 'Loop', 'iterative']],
    ['pipeline', ['Pipeline', 'Chain', 'pipe']],
    ['competitive', ['Competitive', 'Debate', 'competitive']],
  ]),
  heuristicFallback: 'sequential',
};

export class StrategyOptimizer {
  private config: StrategyConfig;
  private strategyHistory: Map<ExecutionStrategy, ExecutionRecord[]> = new Map();
  private strategyStats: Map<ExecutionStrategy, AggregateStats> = new Map();
  private recentDecisions: StrategyDecision[] = [];
  private executionCounter: number = 0;

  constructor(config: Partial<StrategyConfig> = {}) {
    this.config = { ...DEFAULT_STRATEGY_CONFIG, ...config };
  }

  recordExecution(record: ExecutionRecord): void {
    const strategy = record.strategy;
    
    if (!this.strategyHistory.has(strategy)) {
      this.strategyHistory.set(strategy, []);
    }
    
    const history = this.strategyHistory.get(strategy)!;
    history.push(record);
    
    if (history.length > 500) {
      history.shift();
    }
    
    this.updateStrategyStats(strategy);
    this.executionCounter++;
  }

  private updateStrategyStats(strategy: ExecutionStrategy): void {
    const records = this.strategyHistory.get(strategy) || [];
    
    if (records.length === 0) {
      this.strategyStats.delete(strategy);
      return;
    }
    
    const successes = records.filter(r => r.success).length;
    const latencies = records.map(r => r.totalLatencyMs);
    const costs = records.map(r => r.totalCostUSD);
    const retries = records.map(r => r.retryCount);
    
    const ci = wilsonScore(successes, records.length);
    
    let trend: 'improving' | 'stable' | 'degrading' = 'stable';
    
    if (records.length >= 20) {
      const recentSuccesses = records.slice(-20).map(r => r.success ? 1 : 0);
      const regression = linearRegression(
        recentSuccesses.map((_, i) => i),
        recentSuccesses
      );
      
      if (regression.slope > 0.02) {
        trend = 'improving';
      } else if (regression.slope < -0.02) {
        trend = 'degrading';
      }
    }
    
    const stats: AggregateStats = {
      sampleSize: records.length,
      confidence: this.calculateConfidence(records.length),
      successRate: successes / records.length,
      successRateRaw: successes / records.length,
      successRateCI: [ci.lowerBound, ci.upperBound],
      avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      medianLatencyMs: this.percentile(latencies, 50),
      p95LatencyMs: this.percentile(latencies, 95),
      avgRetries: retries.reduce((a, b) => a + b, 0) / retries.length,
      avgCostUSD: costs.reduce((a, b) => a + b, 0) / costs.length,
      avgTokens: records.reduce((a, r) => a + r.totalTokensIn, 0) / records.length,
      trend,
    };
    
    this.strategyStats.set(strategy, stats);
  }

  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    return sorted[lower] * (1 - (index - lower)) + sorted[upper] * (index - lower);
  }

  private calculateConfidence(sampleSize: number): ConfidenceLevel {
    if (sampleSize < 3) return 'none';
    if (sampleSize < 10) return 'low';
    if (sampleSize < 25) return 'medium';
    return 'high';
  }

  selectStrategy(context: {
    taskDomains: string[];
    complexity: 'low' | 'medium' | 'high' | 'critical';
    estimatedTokens?: number;
    requiresParallelism?: boolean;
    deadline?: number;
  }): StrategyDecision {
    const shouldExplore = Math.random() < this.config.explorationRate;
    
    const strategies = Array.from(this.strategyStats.keys());
    
    if (strategies.length === 0 || shouldExplore) {
      return this.heuristicSelection(context);
    }
    
    const hasEnoughData = strategies.every(
      s => (this.strategyStats.get(s)?.sampleSize || 0) >= this.config.minSamplesForDecision
    );
    
    if (!hasEnoughData) {
      return this.heuristicSelection(context);
    }
    
    const scoredStrategies = strategies.map(strategy => ({
      strategy,
      score: this.calculateStrategyScore(strategy, context),
      stats: this.strategyStats.get(strategy)!,
    }));
    
    scoredStrategies.sort((a, b) => b.score - a.score);
    
    const topStrategy = scoredStrategies[0];
    const secondStrategy = scoredStrategies[1];
    
    let chosen: ExecutionStrategy;
    let reasoning: string;
    let source: 'learned' | 'heuristic-fallback';
    
    if (topStrategy.stats.confidence === 'high' && topStrategy.stats.successRate > 0.7) {
      chosen = topStrategy.strategy;
      reasoning = this.generateReasoning(topStrategy, scoredStrategies);
      source = 'learned';
    } else if (topStrategy.stats.successRateCI[0] > (secondStrategy?.stats.successRateCI[1] || 0)) {
      chosen = topStrategy.strategy;
      reasoning = `Clear winner with ${(topStrategy.stats.successRate * 100).toFixed(1)}% success rate (CI: ${(topStrategy.stats.successRateCI[0] * 100).toFixed(1)}%-${(topStrategy.stats.successRateCI[1] * 100).toFixed(1)}%)`;
      source = 'learned';
    } else {
      const decision = this.heuristicSelection(context);
      chosen = decision.chosen;
      reasoning = decision.reasoning + ' (insufficient confidence for learned decision)';
      source = 'heuristic-fallback';
    }
    
    const decision: StrategyDecision = {
      chosen,
      reasoning,
      fallbackStrategy: this.config.heuristicFallback,
      source,
      confidence: topStrategy.stats.confidence,
    };
    
    this.recentDecisions.push(decision);
    if (this.recentDecisions.length > 100) {
      this.recentDecisions.shift();
    }
    
    return decision;
  }

  private calculateStrategyScore(
    strategy: ExecutionStrategy,
    context: { complexity: 'low' | 'medium' | 'high' | 'critical'; estimatedTokens?: number }
  ): number {
    const stats = this.strategyStats.get(strategy);
    if (!stats) return 0;
    
    const { success, latency, cost, reliability } = this.config.performanceWeights;
    
    const successScore = stats.successRate;
    const latencyScore = Math.max(0, 1 - (stats.avgLatencyMs / 120000));
    const costScore = Math.max(0, 1 - (stats.avgCostUSD / 1));
    const reliabilityScore = stats.successRateCI[0];
    
    let complexityBonus = 0;
    if (context.complexity === 'critical' && (strategy === 'parallel' || strategy === 'adaptive')) {
      complexityBonus = 0.1;
    } else if (context.complexity === 'low' && strategy === 'sequential') {
      complexityBonus = 0.05;
    }
    
    const baseScore = (
      successScore * success +
      latencyScore * latency +
      costScore * cost +
      reliabilityScore * reliability
    );
    
    const confidenceMultiplier = stats.confidence === 'high' ? 1.2 :
                                  stats.confidence === 'medium' ? 1.0 :
                                  stats.confidence === 'low' ? 0.8 : 0.5;
    
    return (baseScore + complexityBonus) * confidenceMultiplier;
  }

  private generateReasoning(
    topStrategy: { strategy: ExecutionStrategy; score: number; stats: AggregateStats },
    allStrategies: Array<{ strategy: ExecutionStrategy; score: number; stats: AggregateStats }>
  ): string {
    const parts: string[] = [];
    
    parts.push(`Selected ${topStrategy.strategy} with ${(topStrategy.stats.successRate * 100).toFixed(1)}% success rate`);
    
    if (topStrategy.stats.trend === 'improving') {
      parts.push('(improving trend)');
    } else if (topStrategy.stats.trend === 'degrading') {
      parts.push('(degrading trend - use with caution)');
    }
    
    const advantage = allStrategies.length > 1 
      ? topStrategy.score - (allStrategies[1]?.score || 0)
      : 0;
    
    if (advantage > 0.1) {
      parts.push(`+${(advantage * 100).toFixed(1)}% score advantage over alternatives`);
    }
    
    parts.push(`(${topStrategy.stats.sampleSize} samples, ${topStrategy.stats.confidence} confidence)`);
    
    return parts.join(' ');
  }

  private heuristicSelection(context: {
    taskDomains: string[];
    complexity: 'low' | 'medium' | 'high' | 'critical';
    requiresParallelism?: boolean;
    deadline?: number;
  }): StrategyDecision {
    let chosen: ExecutionStrategy;
    let reasoning: string;
    
    if (context.requiresParallelism || context.complexity === 'critical') {
      chosen = 'parallel';
      reasoning = 'Parallel selected: explicit parallelism required or critical complexity';
    } else if (context.complexity === 'low' && (!context.deadline || context.deadline > 60000)) {
      chosen = 'sequential';
      reasoning = 'Sequential selected: low complexity, no strict deadline';
    } else if (context.complexity === 'high') {
      chosen = 'adaptive';
      reasoning = 'Adaptive selected: high complexity benefits from adaptive approach';
    } else if (context.taskDomains.some(d => d.includes('code') || d.includes('debug'))) {
      chosen = 'hierarchical';
      reasoning = 'Hierarchical selected: code/debug tasks benefit from structured approach';
    } else {
      chosen = this.config.heuristicFallback;
      reasoning = `${this.config.heuristicFallback} selected as default heuristic`;
    }
    
    return {
      chosen,
      reasoning,
      fallbackStrategy: this.config.heuristicFallback,
      source: 'heuristic-fallback',
    };
  }

  getStrategyStats(): Map<ExecutionStrategy, AggregateStats> {
    return new Map(this.strategyStats);
  }

  getRecommendation(strategy: ExecutionStrategy): string {
    const stats = this.strategyStats.get(strategy);
    
    if (!stats) {
      return `No data for ${strategy}. Recommend trying with small task first.`;
    }
    
    const issues: string[] = [];
    
    if (stats.trend === 'degrading') {
      issues.push('Success rate trending down');
    }
    if (stats.avgLatencyMs > 60000) {
      issues.push('High average latency');
    }
    if (stats.successRate < 0.7) {
      issues.push('Low success rate');
    }
    
    if (issues.length === 0) {
      return `${strategy} performing well: ${(stats.successRate * 100).toFixed(1)}% success, ${stats.trend} trend`;
    }
    
    return `${strategy} concerns: ${issues.join(', ')}`;
  }

  compareStrategies(strategy1: ExecutionStrategy, strategy2: ExecutionStrategy): {
    winner: ExecutionStrategy | 'tie';
    details: {
      successRateDiff: number;
      latencyDiff: number;
      costDiff: number;
      recommendation: string;
    };
  } {
    const stats1 = this.strategyStats.get(strategy1);
    const stats2 = this.strategyStats.get(strategy2);
    
    if (!stats1 && !stats2) {
      return {
        winner: 'tie',
        details: {
          successRateDiff: 0,
          latencyDiff: 0,
          costDiff: 0,
          recommendation: 'No data for either strategy',
        },
      };
    }
    
    if (!stats1) return { winner: strategy2, details: { successRateDiff: 0, latencyDiff: 0, costDiff: 0, recommendation: `${strategy2} has data, ${strategy1} has none` } };
    if (!stats2) return { winner: strategy1, details: { successRateDiff: 0, latencyDiff: 0, costDiff: 0, recommendation: `${strategy1} has data, ${strategy2} has none` } };
    
    const successRateDiff = stats1.successRate - stats2.successRate;
    const latencyDiff = stats1.avgLatencyMs - stats2.avgLatencyMs;
    const costDiff = stats1.avgCostUSD - stats2.avgCostUSD;
    
    let winner: ExecutionStrategy | 'tie';
    let recommendation: string;
    
    if (Math.abs(successRateDiff) < 0.05) {
      winner = 'tie';
      recommendation = 'Similar success rates. Prefer ' + (latencyDiff < 0 ? strategy1 : strategy2) + ' for lower latency';
    } else if (successRateDiff > 0.1) {
      winner = strategy1;
      recommendation = `${strategy1} has significantly better success rate`;
    } else if (successRateDiff < -0.1) {
      winner = strategy2;
      recommendation = `${strategy2} has significantly better success rate`;
    } else {
      winner = successRateDiff > 0 ? strategy1 : strategy2;
      recommendation = `Marginal difference. Slight preference for ${winner}`;
    }
    
    return {
      winner,
      details: { successRateDiff, latencyDiff, costDiff, recommendation },
    };
  }

  getRecentDecisions(limit: number = 10): StrategyDecision[] {
    return this.recentDecisions.slice(-limit);
  }

  pruneOldData(maxAgeMs: number): void {
    const cutoff = Date.now() - maxAgeMs;
    
    for (const [strategy, records] of this.strategyHistory) {
      const filtered = records.filter(r => r.timestamp >= cutoff);
      this.strategyHistory.set(strategy, filtered);
      this.updateStrategyStats(strategy);
    }
  }
}

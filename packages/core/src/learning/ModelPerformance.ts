import { wilsonScore, linearRegression } from './statistics.js';
import type { ExecutionRecord, ModelPerformanceMetrics, ContextualScore, PerformanceSnapshot } from './types.js';

export interface ModelContext {
  modelId: string;
  taskDomains: string[];
  complexity: 'low' | 'medium' | 'high' | 'critical';
  controlMode: 'manual' | 'guided' | 'auto';
  sessionId?: string;
}

export interface ModelPerformanceConfig {
  minSamplesForConfidence: number;
  successEwmaAlpha: number;
  latencyEwmaAlpha: number;
  costEwmaAlpha: number;
  decayFactorPerDay: number;
  confidenceLevel: number;
}

export const DEFAULT_MODEL_PERF_CONFIG: ModelPerformanceConfig = {
  minSamplesForConfidence: 10,
  successEwmaAlpha: 0.1,
  latencyEwmaAlpha: 0.05,
  costEwmaAlpha: 0.05,
  decayFactorPerDay: 0.95,
  confidenceLevel: 1.645,
};

export class ModelPerformance {
  private config: ModelPerformanceConfig;
  private globalMetrics: Map<string, ModelPerformanceMetrics> = new Map();
  private contextualMetrics: Map<string, Map<string, ModelPerformanceMetrics>> = new Map();
  private contextKeys: Map<string, string> = new Map();

  constructor(config: Partial<ModelPerformanceConfig> = {}) {
    this.config = { ...DEFAULT_MODEL_PERF_CONFIG, ...config };
  }

  recordExecution(record: ExecutionRecord): void {
    for (const agentRecord of record.agentsUsed) {
      this.recordAgentPerformance(agentRecord.agentId, agentRecord.model, record, agentRecord);
    }
  }

  private recordAgentPerformance(
    agentId: string,
    modelId: string,
    record: ExecutionRecord,
    agentRecord: { latencyMs: number; tokensIn: number; tokensOut: number; costUSD: number; success: boolean }
  ): void {
    const contextKey = this.getContextKey(record);
    this.contextKeys.set(`${agentId}:${record.sessionId}`, contextKey);

    this.updateGlobalMetrics(modelId, record, agentRecord);
    this.updateContextualMetrics(modelId, contextKey, record, agentRecord);
  }

  private getContextKey(record: ExecutionRecord): string {
    const domains = record.taskDomains.slice(0, 3).sort().join('|');
    return `${domains}:${record.taskComplexity}:${record.controlMode}`;
  }

  private updateGlobalMetrics(
    modelId: string,
    _record: ExecutionRecord,
    agentRecord: { latencyMs: number; costUSD: number; success: boolean }
  ): void {
    let metrics = this.globalMetrics.get(modelId);
    
    if (!metrics) {
      metrics = {
        modelId,
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        avgLatencyMs: 0,
        avgCostUSD: 0,
        avgTokensIn: 0,
        avgTokensOut: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        successRate: 0,
        successRateCI: { lower: 0, upper: 1 },
        costPerSuccess: 0,
        throughput: 0,
        reliabilityScore: 0,
        qualityScore: 0,
        efficiencyScore: 0,
        overallScore: 0,
        lastUpdated: 0,
        sampleSize: 0,
        latencyTrend: { slope: 0, direction: 'stable' as const },
        successTrend: { slope: 0, direction: 'stable' as const },
      };
      this.globalMetrics.set(modelId, metrics);
    }

    metrics.totalExecutions++;
    if (agentRecord.success) {
      metrics.successfulExecutions++;
    } else {
      metrics.failedExecutions++;
    }

    const latencyHistory = this.getLatencyHistory(modelId, 'global');
    latencyHistory.push(agentRecord.latencyMs);

    const successHistory = this.getSuccessHistory(modelId, 'global');
    successHistory.push(agentRecord.success ? 1 : 0);

    metrics.avgLatencyMs = agentRecord.latencyMs;
    metrics.avgCostUSD = agentRecord.costUSD;
    metrics.sampleSize = metrics.totalExecutions;

    if (metrics.sampleSize >= this.config.minSamplesForConfidence) {
      metrics.p50LatencyMs = this.percentile(latencyHistory, 50);
      metrics.p95LatencyMs = this.percentile(latencyHistory, 95);
      metrics.p99LatencyMs = this.percentile(latencyHistory, 99);
    }

    metrics.successRate = metrics.successfulExecutions / metrics.totalExecutions;
    const ci = wilsonScore(
      metrics.successfulExecutions,
      metrics.totalExecutions,
      this.config.confidenceLevel
    );
    metrics.successRateCI = { lower: ci.lowerBound, upper: ci.upperBound };

    if (metrics.successfulExecutions > 0) {
      metrics.costPerSuccess = (metrics.avgCostUSD * metrics.totalExecutions) / metrics.successfulExecutions;
    }

    metrics.reliabilityScore = metrics.successRateCI.lower;
    metrics.efficiencyScore = this.calculateEfficiencyScore(metrics);
    metrics.overallScore = (metrics.reliabilityScore * 0.5 + metrics.efficiencyScore * 0.3 + metrics.qualityScore * 0.2);
    metrics.lastUpdated = Date.now();

    if (latencyHistory.length >= 10) {
      const trendData = linearRegression(
        latencyHistory.slice(-20).map((_, i) => i),
        latencyHistory.slice(-20)
      );
      metrics.latencyTrend = {
        slope: trendData.slope,
        direction: trendData.slope > 0.05 ? 'increasing' : trendData.slope < -0.05 ? 'decreasing' : 'stable',
      };
    }

    if (successHistory.length >= 10) {
      const trendData = linearRegression(
        successHistory.slice(-20).map((_, i) => i),
        successHistory.slice(-20)
      );
      metrics.successTrend = {
        slope: trendData.slope,
        direction: trendData.slope > 0.02 ? 'improving' : trendData.slope < -0.02 ? 'declining' : 'stable',
      };
    }
  }

  private updateContextualMetrics(
    modelId: string,
    contextKey: string,
    _record: ExecutionRecord,
    agentRecord: { latencyMs: number; costUSD: number; success: boolean }
  ): void {
    let contextMap = this.contextualMetrics.get(modelId);
    if (!contextMap) {
      contextMap = new Map();
      this.contextualMetrics.set(modelId, contextMap);
    }

    let metrics = contextMap.get(contextKey);
    if (!metrics) {
      metrics = {
        modelId,
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        avgLatencyMs: 0,
        avgCostUSD: 0,
        avgTokensIn: 0,
        avgTokensOut: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        successRate: 0,
        successRateCI: { lower: 0, upper: 1 },
        costPerSuccess: 0,
        throughput: 0,
        reliabilityScore: 0,
        qualityScore: 0,
        efficiencyScore: 0,
        overallScore: 0,
        lastUpdated: 0,
        sampleSize: 0,
        latencyTrend: { slope: 0, direction: 'stable' as const },
        successTrend: { slope: 0, direction: 'stable' as const },
      };
      contextMap.set(contextKey, metrics);
    }

    metrics.totalExecutions++;
    if (agentRecord.success) {
      metrics.successfulExecutions++;
    } else {
      metrics.failedExecutions++;
    }

    metrics.avgLatencyMs = agentRecord.latencyMs;
    metrics.avgCostUSD = agentRecord.costUSD;
    metrics.sampleSize = metrics.totalExecutions;
    metrics.successRate = metrics.successfulExecutions / metrics.totalExecutions;
    const ci2 = wilsonScore(
      metrics.successfulExecutions,
      metrics.totalExecutions,
      this.config.confidenceLevel
    );
    metrics.successRateCI = { lower: ci2.lowerBound, upper: ci2.upperBound };
    metrics.reliabilityScore = metrics.successRateCI.lower;
    metrics.lastUpdated = Date.now();
  }

  private latencyHistoryGlobal: Map<string, number[]> = new Map();
  private successHistoryGlobal: Map<string, number[]> = new Map();
  private latencyHistoryContext: Map<string, Map<string, number[]>> = new Map();
  private successHistoryContext: Map<string, Map<string, number[]>> = new Map();

  private getLatencyHistory(modelId: string, contextKey: string): number[] {
    if (contextKey === 'global') {
      if (!this.latencyHistoryGlobal.has(modelId)) {
        this.latencyHistoryGlobal.set(modelId, []);
      }
      return this.latencyHistoryGlobal.get(modelId)!;
    } else {
      if (!this.latencyHistoryContext.has(modelId)) {
        this.latencyHistoryContext.set(modelId, new Map());
      }
      const modelMap = this.latencyHistoryContext.get(modelId)!;
      if (!modelMap.has(contextKey)) {
        modelMap.set(contextKey, []);
      }
      return modelMap.get(contextKey)!;
    }
  }

  private getSuccessHistory(modelId: string, contextKey: string): number[] {
    if (contextKey === 'global') {
      if (!this.successHistoryGlobal.has(modelId)) {
        this.successHistoryGlobal.set(modelId, []);
      }
      return this.successHistoryGlobal.get(modelId)!;
    } else {
      if (!this.successHistoryContext.has(modelId)) {
        this.successHistoryContext.set(modelId, new Map());
      }
      const modelMap = this.successHistoryContext.get(modelId)!;
      if (!modelMap.has(contextKey)) {
        modelMap.set(contextKey, []);
      }
      return modelMap.get(contextKey)!;
    }
  }

  private calculateEfficiencyScore(metrics: ModelPerformanceMetrics): number {
    const latencyScore = metrics.avgLatencyMs > 0 
      ? Math.max(0, 1 - (metrics.avgLatencyMs / 120000))
      : 0.5;
    const costScore = metrics.avgCostUSD > 0
      ? Math.max(0, 1 - (metrics.avgCostUSD / 1))
      : 0.5;
    const throughputScore = metrics.throughput > 0
      ? Math.min(1, metrics.throughput / 10)
      : 0.5;
    
    return (latencyScore * 0.4 + costScore * 0.3 + throughputScore * 0.3);
  }

  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    const fraction = index - lower;
    return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
  }

  getGlobalMetrics(modelId: string): ModelPerformanceMetrics | null {
    return this.globalMetrics.get(modelId) || null;
  }

  getContextualMetrics(modelId: string, context: ModelContext): ModelPerformanceMetrics | null {
    const contextKey = `${context.taskDomains.slice(0, 3).sort().join('|')}:${context.complexity}:${context.controlMode}`;
    return this.contextualMetrics.get(modelId)?.get(contextKey) || null;
  }

  getContextualScore(modelId: string, context: ModelContext): ContextualScore {
    const global = this.getGlobalMetrics(modelId);
    const contextual = this.getContextualMetrics(modelId, context);
    
    const hasEnoughData = (global?.sampleSize || 0) >= this.config.minSamplesForConfidence;
    const hasEnoughContextual = (contextual?.sampleSize || 0) >= this.config.minSamplesForConfidence;
    
    let confidence = 0;
    let adjustedScore = 0;
    let blendFactor = 0;

    if (hasEnoughContextual && contextual) {
      confidence = Math.min(1, contextual.sampleSize / 30);
      blendFactor = 0.7;
      adjustedScore = contextual.overallScore * blendFactor + (global?.overallScore || 0.5) * (1 - blendFactor);
    } else if (hasEnoughData && global) {
      confidence = Math.min(1, global.sampleSize / 50);
      blendFactor = 0.3;
      adjustedScore = global.overallScore * blendFactor + 0.5 * (1 - blendFactor);
    } else {
      confidence = 0;
      adjustedScore = 0.5;
    }

    return {
      modelId,
      context: this.getContextKeyFromObject(context),
      rawScore: contextual?.overallScore || global?.overallScore || 0.5,
      adjustedScore,
      confidence,
      sampleSize: contextual?.sampleSize || global?.sampleSize || 0,
      isFallback: !hasEnoughData,
    };
  }

  private getContextKeyFromObject(context: ModelContext): string {
    const domains = context.taskDomains.slice(0, 3).sort().join('|');
    return `${domains}:${context.complexity}:${context.controlMode}`;
  }

  getAllModels(): string[] {
    return Array.from(this.globalMetrics.keys());
  }

  getSnapshot(): PerformanceSnapshot {
    const models: ModelPerformanceMetrics[] = [];
    
    for (const [, metrics] of this.globalMetrics) {
      models.push({ ...metrics });
    }
    
    return {
      timestamp: Date.now(),
      models,
      totalExecutions: models.reduce((sum, m) => sum + m.totalExecutions, 0),
      averageSuccessRate: models.length > 0 
        ? models.reduce((sum, m) => sum + m.successRate, 0) / models.length
        : 0,
    };
  }

  getRecommendation(modelId: string): string {
    const metrics = this.globalMetrics.get(modelId);
    if (!metrics) return 'No data available';
    
    const issues: string[] = [];
    
    if (metrics.successTrend.direction === 'declining') {
      issues.push('Success rate declining');
    }
    if (metrics.latencyTrend.direction === 'increasing') {
      issues.push('Latency increasing');
    }
    if (metrics.successRate < 0.8) {
      issues.push('Low success rate');
    }
    if (metrics.p95LatencyMs > 60000) {
      issues.push('High P95 latency');
    }
    
    if (issues.length === 0) {
      return 'Model performing well';
    }
    
    return `Consider review: ${issues.join(', ')}`;
  }

  pruneOldData(_maxAgeMs: number): void {
    for (const [modelId, history] of this.latencyHistoryGlobal) {
      const filtered = history.filter((_, i) => i >= history.length - 100);
      this.latencyHistoryGlobal.set(modelId, filtered);
    }
    
    for (const [modelId, history] of this.successHistoryGlobal) {
      const filtered = history.filter((_, i) => i >= history.length - 100);
      this.successHistoryGlobal.set(modelId, filtered);
    }
  }
}

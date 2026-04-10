import type { ExecutionRecord, ScoredModel, ConfidenceLevel, ModelContext } from './types.js';
import { ModelPerformance } from './ModelPerformance.js';

export interface RouterConfig {
  explorationRate: number;
  minExplorationRate: number;
  explorationDecayFactor: number;
  rewardWeights: {
    success: number;
    latency: number;
    cost: number;
    quality: number;
  };
  fallbackChains: Map<string, string[]>;
  maxFallbackDepth: number;
  enableContextualRouting: boolean;
  confidenceThreshold: number;
  historyWindow: number;
}

export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  explorationRate: 0.2,
  minExplorationRate: 0.05,
  explorationDecayFactor: 0.95,
  rewardWeights: {
    success: 0.5,
    latency: 0.2,
    cost: 0.15,
    quality: 0.15,
  },
  fallbackChains: new Map(),
  maxFallbackDepth: 3,
  enableContextualRouting: true,
  confidenceThreshold: 0.5,
  historyWindow: 100,
};

export class SmartModelRouter {
  private config: RouterConfig;
  private modelPerformance: ModelPerformance;
  private betaDistributions: Map<string, { alpha: number; beta: number }> = new Map();
  private modelScores: Map<string, number> = new Map();
  private availableModels: Set<string> = new Set();
  private recentSelections: Map<string, string[]> = new Map();

  constructor(
    config: Partial<RouterConfig> = {},
    modelPerformance?: ModelPerformance
  ) {
    this.config = { ...DEFAULT_ROUTER_CONFIG, ...config };
    this.modelPerformance = modelPerformance || new ModelPerformance();
  }

  registerModel(modelId: string, initialAlpha: number = 1, initialBeta: number = 1): void {
    this.availableModels.add(modelId);
    this.betaDistributions.set(modelId, { alpha: initialAlpha, beta: initialBeta });
    this.modelScores.set(modelId, 0.5);
  }

  unregisterModel(modelId: string): void {
    this.availableModels.delete(modelId);
    this.betaDistributions.delete(modelId);
    this.modelScores.delete(modelId);
  }

  selectModel(context: ModelContext): ScoredModel {
    const models = Array.from(this.availableModels);
    
    if (models.length === 0) {
      throw new Error('No models available for selection');
    }
    
    if (models.length === 1) {
      return this.createScoredModel(models[0], context, 1);
    }

    const explorationRate = this.calculateExplorationRate();
    const shouldExplore = Math.random() < explorationRate;

    let selectedModel: string;

    if (shouldExplore) {
      selectedModel = this.explore(models);
    } else {
      selectedModel = this.exploit(models, context);
    }

    this.recordSelection(selectedModel, context);

    return this.createScoredModel(selectedModel, context, explorationRate);
  }

  private explore(models: string[]): string {
    const weights = this.calculateExplorationWeights(models);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;
    
    for (let i = 0; i < models.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return models[i];
      }
    }
    
    return models[models.length - 1];
  }

  private calculateExplorationWeights(models: string[]): number[] {
    return models.map(model => {
      const dist = this.betaDistributions.get(model);
      if (!dist) return 1;
      
      const alpha = Math.max(1, dist.alpha);
      const beta = Math.max(1, dist.beta);
      
      const mean = alpha / (alpha + beta);
      const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
      const std = Math.sqrt(variance);
      
      return mean + std;
    });
  }

  private exploit(models: string[], context: ModelContext): string {
    let bestModel = models[0];
    let bestScore = -Infinity;

    for (const modelId of models) {
      const score = this.calculateModelScore(modelId, context);
      
      if (score > bestScore) {
        bestScore = score;
        bestModel = modelId;
      }
    }

    return bestModel;
  }

  private calculateModelScore(modelId: string, context: ModelContext): number {
    const contextualScore = this.modelPerformance.getContextualScore(modelId, {
      modelId,
      taskDomains: context.taskDomains,
      complexity: context.taskComplexity,
      controlMode: context.controlMode,
    });

    if (contextualScore && contextualScore.confidence >= this.config.confidenceThreshold) {
      return contextualScore.adjustedScore;
    }

    const globalMetrics = this.modelPerformance.getGlobalMetrics(modelId);
    if (globalMetrics) {
      const globalScore = this.calculateGlobalScore(globalMetrics);
      
      if (contextualScore) {
        return contextualScore.adjustedScore * contextualScore.confidence + 
               globalScore * (1 - contextualScore.confidence);
      }
      
      return globalScore;
    }

    return this.modelScores.get(modelId) || 0.5;
  }

  private calculateGlobalScore(metrics: { reliabilityScore: number; efficiencyScore: number; qualityScore: number }): number {
    const { success, latency, cost, quality } = this.config.rewardWeights;
    
    return (
      metrics.reliabilityScore * success +
      metrics.efficiencyScore * latency +
      metrics.qualityScore * quality +
      (1 - metrics.efficiencyScore) * cost * 0.5
    );
  }

  private createScoredModel(modelId: string, context: ModelContext, explorationRate: number): ScoredModel {
    const contextualScore = this.modelPerformance.getContextualScore(modelId, {
      modelId,
      taskDomains: context.taskDomains,
      complexity: context.taskComplexity,
      controlMode: context.controlMode,
    });

    const globalMetrics = this.modelPerformance.getGlobalMetrics(modelId);

    const effectiveness = contextualScore?.adjustedScore || globalMetrics?.overallScore || 0.5;
    const reliability = globalMetrics?.reliabilityScore || 0.5;
    const speed = globalMetrics?.efficiencyScore || 0.5;
    const costEfficiency = 1 - (globalMetrics?.avgCostUSD || 0.5);

    const totalScore = (
      effectiveness * this.config.rewardWeights.success +
      speed * this.config.rewardWeights.latency +
      costEfficiency * this.config.rewardWeights.cost +
      reliability * this.config.rewardWeights.quality
    );

    const sampleSize = contextualScore?.sampleSize || globalMetrics?.sampleSize || 0;
    const confidence = this.determineConfidence(sampleSize);

    const fallbackChain = this.getFallbackChain(modelId);

    return {
      modelId,
      totalScore,
      components: {
        effectiveness,
        speed,
        costEfficiency,
        reliability,
        exploration: explorationRate,
        penalty: 0,
      },
      explanation: this.generateExplanation(modelId, contextualScore, globalMetrics),
      confidence,
      fallbackChain,
    };
  }

  private determineConfidence(sampleSize: number): ConfidenceLevel {
    if (sampleSize < 5) return 'none';
    if (sampleSize < 15) return 'low';
    if (sampleSize < 30) return 'medium';
    return 'high';
  }

  private getFallbackChain(primaryModel: string): string[] {
    const chain = [primaryModel];
    
    if (this.config.fallbackChains.has(primaryModel)) {
      const fallbacks = this.config.fallbackChains.get(primaryModel)!;
      for (const fallback of fallbacks) {
        if (chain.length >= this.config.maxFallbackDepth) break;
        if (!chain.includes(fallback)) {
          chain.push(fallback);
        }
      }
    }

    const remainingModels = Array.from(this.availableModels).filter(m => !chain.includes(m));
    for (const model of remainingModels) {
      if (chain.length >= this.config.maxFallbackDepth) break;
      chain.push(model);
    }

    return chain;
  }

  private generateExplanation(
    modelId: string,
    contextualScore: { adjustedScore: number; confidence: number } | null,
    globalMetrics: { overallScore: number; successRate: number } | null
  ): string {
    const parts: string[] = [];

    if (contextualScore && contextualScore.confidence > 0.5) {
      parts.push(`Contextual performance: ${(contextualScore.adjustedScore * 100).toFixed(1)}%`);
    }

    if (globalMetrics) {
      parts.push(`Overall score: ${(globalMetrics.overallScore * 100).toFixed(1)}%`);
      parts.push(`Success rate: ${(globalMetrics.successRate * 100).toFixed(1)}%`);
    }

    const dist = this.betaDistributions.get(modelId);
    if (dist) {
      parts.push(`Beta dist: α=${dist.alpha.toFixed(1)}, β=${dist.beta.toFixed(1)}`);
    }

    return parts.join(' | ') || `Selected ${modelId} via Thompson Sampling`;
  }

  private recordSelection(modelId: string, context: ModelContext): void {
    const key = context.sessionId || 'default';
    
    if (!this.recentSelections.has(key)) {
      this.recentSelections.set(key, []);
    }
    
    const selections = this.recentSelections.get(key)!;
    selections.push(modelId);
    
    if (selections.length > this.config.historyWindow) {
      selections.shift();
    }
  }

  private calculateExplorationRate(): number {
    let rate = this.config.explorationRate;
    
    for (const [, selections] of this.recentSelections) {
      const recentCount = selections.length;
      if (recentCount > 20) {
        const selectionCounts = new Map<string, number>();
        for (const modelId of selections.slice(-20)) {
          selectionCounts.set(modelId, (selectionCounts.get(modelId) || 0) + 1);
        }
        
        const totalSelections = 20;
        let maxConcentration = 0;
        for (const count of selectionCounts.values()) {
          maxConcentration = Math.max(maxConcentration, count / totalSelections);
        }
        
        if (maxConcentration > 0.6) {
          rate = Math.min(1, rate * 1.5);
        }
      }
    }
    
    return Math.max(this.config.minExplorationRate, rate * this.config.explorationDecayFactor);
  }

  updateReward(modelId: string, execution: ExecutionRecord, agentIndex: number = 0): void {
    const agentRecord = execution.agentsUsed[agentIndex];
    if (!agentRecord) return;

    const reward = this.calculateReward(execution, agentRecord);
    
    let dist = this.betaDistributions.get(modelId);
    if (!dist) {
      dist = { alpha: 1, beta: 1 };
      this.betaDistributions.set(modelId, dist);
    }

    if (reward > 0.5) {
      dist.alpha += reward * 2;
    } else {
      dist.beta += (1 - reward) * 2;
    }

    this.modelScores.set(modelId, this.calculateThompsonSample(modelId));
  }

  private calculateReward(
    execution: ExecutionRecord,
    agentRecord: { success: boolean; latencyMs: number; costUSD: number; retries: number }
  ): number {
    const { success, latency, cost, quality } = this.config.rewardWeights;

    let successComponent = agentRecord.success ? 1 : 0;
    if (!agentRecord.success && execution.partialSuccess) {
      successComponent = 0.5;
    }

    const latencyComponent = Math.max(0, 1 - (agentRecord.latencyMs / 120000));
    const costComponent = Math.max(0, 1 - (agentRecord.costUSD / 1));
    const retryComponent = Math.max(0, 1 - (agentRecord.retries / 5));

    const totalReward = (
      successComponent * success +
      latencyComponent * latency +
      costComponent * cost +
      retryComponent * quality
    );

    return Math.max(0, Math.min(1, totalReward));
  }

  private calculateThompsonSample(modelId: string): number {
    const dist = this.betaDistributions.get(modelId);
    if (!dist) return 0.5;

    const alpha = Math.max(0.1, dist.alpha);
    const beta = Math.max(0.1, dist.beta);

    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    
    const gamma = alpha + beta;
    const mean = alpha / gamma;
    const std = Math.sqrt((alpha * beta) / (gamma ** 2 * (gamma + 1)));
    
    return Math.max(0, Math.min(1, mean + std * z * 0.1));
  }

  setFallbackChain(primaryModel: string, chain: string[]): void {
    this.config.fallbackChains.set(primaryModel, chain);
  }

  getModelRankings(context: ModelContext): ScoredModel[] {
    const models = Array.from(this.availableModels);
    
    return models
      .map(modelId => this.createScoredModel(modelId, context, this.config.explorationRate))
      .sort((a, b) => b.totalScore - a.totalScore);
  }

  getStatistics(): {
    modelCount: number;
    averageAlpha: number;
    averageBeta: number;
    explorationRate: number;
  } {
    let totalAlpha = 0;
    let totalBeta = 0;
    let count = 0;

    for (const dist of this.betaDistributions.values()) {
      totalAlpha += dist.alpha;
      totalBeta += dist.beta;
      count++;
    }

    return {
      modelCount: this.availableModels.size,
      averageAlpha: count > 0 ? totalAlpha / count : 0,
      averageBeta: count > 0 ? totalBeta / count : 0,
      explorationRate: this.calculateExplorationRate(),
    };
  }

  resetModel(modelId: string): void {
    this.betaDistributions.set(modelId, { alpha: 1, beta: 1 });
    this.modelScores.set(modelId, 0.5);
  }

  resetAll(): void {
    for (const modelId of this.availableModels) {
      this.resetModel(modelId);
    }
    this.recentSelections.clear();
  }
}

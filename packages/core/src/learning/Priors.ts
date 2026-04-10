import type { ModelPerformanceMetrics, AggregateStats } from './types.js';

export interface ModelPrior {
  modelId: string;
  expectedSuccessRate: number;
  expectedLatencyMs: number;
  expectedCostUSD: number;
  reliabilityWeight: number;
  taskDomains?: string[];
  confidence: number;
}

export interface StrategyPrior {
  strategy: string;
  expectedSuccessRate: number;
  expectedLatencyMs: number;
  expectedCostUSD: number;
  applicability: string[];
  confidence: number;
}

export interface PromptEnrichmentPrior {
  enrichmentType: string;
  expectedImprovement: number;
  applicabilityCriteria: string[];
  confidence: number;
}

export interface PriorBootstrapConfig {
  enableModelPriors: boolean;
  enableStrategyPriors: boolean;
  enablePromptPriors: boolean;
  confidenceDecayFactor: number;
  minConfidenceThreshold: number;
}

export const DEFAULT_BOOTSTRAP_CONFIG: PriorBootstrapConfig = {
  enableModelPriors: true,
  enableStrategyPriors: true,
  enablePromptPriors: true,
  confidenceDecayFactor: 0.95,
  minConfidenceThreshold: 0.5,
};

export const KNOWN_MODEL_PRIORS: ModelPrior[] = [
  {
    modelId: 'gpt-4',
    expectedSuccessRate: 0.92,
    expectedLatencyMs: 8000,
    expectedCostUSD: 0.03,
    reliabilityWeight: 0.95,
    taskDomains: ['reasoning', 'coding', 'analysis'],
    confidence: 0.9,
  },
  {
    modelId: 'gpt-4-turbo',
    expectedSuccessRate: 0.90,
    expectedLatencyMs: 4000,
    expectedCostUSD: 0.015,
    reliabilityWeight: 0.92,
    taskDomains: ['reasoning', 'coding', 'analysis'],
    confidence: 0.88,
  },
  {
    modelId: 'gpt-3.5-turbo',
    expectedSuccessRate: 0.85,
    expectedLatencyMs: 2000,
    expectedCostUSD: 0.002,
    reliabilityWeight: 0.85,
    taskDomains: ['simple-tasks', 'formatting'],
    confidence: 0.85,
  },
  {
    modelId: 'claude-3-opus',
    expectedSuccessRate: 0.93,
    expectedLatencyMs: 10000,
    expectedCostUSD: 0.025,
    reliabilityWeight: 0.96,
    taskDomains: ['reasoning', 'coding', 'analysis', 'creativity'],
    confidence: 0.9,
  },
  {
    modelId: 'claude-3-sonnet',
    expectedSuccessRate: 0.90,
    expectedLatencyMs: 5000,
    expectedCostUSD: 0.012,
    reliabilityWeight: 0.92,
    taskDomains: ['reasoning', 'coding', 'analysis'],
    confidence: 0.88,
  },
  {
    modelId: 'claude-3-haiku',
    expectedSuccessRate: 0.85,
    expectedLatencyMs: 1500,
    expectedCostUSD: 0.003,
    reliabilityWeight: 0.82,
    taskDomains: ['simple-tasks', 'quick-responses'],
    confidence: 0.82,
  },
  {
    modelId: 'gemini-pro',
    expectedSuccessRate: 0.88,
    expectedLatencyMs: 6000,
    expectedCostUSD: 0.01,
    reliabilityWeight: 0.88,
    taskDomains: ['reasoning', 'multimodal'],
    confidence: 0.85,
  },
  {
    modelId: 'gemini-flash',
    expectedSuccessRate: 0.86,
    expectedLatencyMs: 2000,
    expectedCostUSD: 0.005,
    reliabilityWeight: 0.84,
    taskDomains: ['quick-tasks', 'simple-tasks'],
    confidence: 0.8,
  },
];

export const KNOWN_STRATEGY_PRIORS: StrategyPrior[] = [
  {
    strategy: 'sequential',
    expectedSuccessRate: 0.88,
    expectedLatencyMs: 5000,
    expectedCostUSD: 0.015,
    applicability: ['simple-tasks', 'linear-dependencies'],
    confidence: 0.85,
  },
  {
    strategy: 'parallel',
    expectedSuccessRate: 0.82,
    expectedLatencyMs: 3000,
    expectedCostUSD: 0.02,
    applicability: ['independent-tasks', 'time-sensitive'],
    confidence: 0.8,
  },
  {
    strategy: 'hierarchical',
    expectedSuccessRate: 0.90,
    expectedLatencyMs: 7000,
    expectedCostUSD: 0.025,
    applicability: ['complex-tasks', 'multi-level'],
    confidence: 0.88,
  },
  {
    strategy: 'swarm',
    expectedSuccessRate: 0.85,
    expectedLatencyMs: 10000,
    expectedCostUSD: 0.035,
    applicability: ['complex-tasks', 'diverse-expertise'],
    confidence: 0.82,
  },
];

export const KNOWN_PROMPT_PRIORS: PromptEnrichmentPrior[] = [
  {
    enrichmentType: 'chain-of-thought',
    expectedImprovement: 0.15,
    applicabilityCriteria: ['reasoning-tasks', 'complex-tasks'],
    confidence: 0.85,
  },
  {
    enrichmentType: 'few-shot-examples',
    expectedImprovement: 0.12,
    applicabilityCriteria: ['pattern-matching', 'classification'],
    confidence: 0.82,
  },
  {
    enrichmentType: 'role-assignment',
    expectedImprovement: 0.08,
    applicabilityCriteria: ['domain-specific', 'expertise-tasks'],
    confidence: 0.75,
  },
  {
    enrichmentType: 'step-by-step',
    expectedImprovement: 0.10,
    applicabilityCriteria: ['procedural-tasks', 'tutorials'],
    confidence: 0.78,
  },
  {
    enrichmentType: 'output-formatting',
    expectedImprovement: 0.05,
    applicabilityCriteria: ['structured-output', 'parsing-required'],
    confidence: 0.70,
  },
];

export class PriorsBootstrap {
  private config: PriorBootstrapConfig;
  private activePriors: Set<string> = new Set();
  private priorConfidence: Map<string, number> = new Map();
  private usedPriors: Map<string, number> = new Map();

  constructor(config: Partial<PriorBootstrapConfig> = {}) {
    this.config = { ...DEFAULT_BOOTSTRAP_CONFIG, ...config };
    this.initializePriorConfidence();
  }

  private initializePriorConfidence(): void {
    if (this.config.enableModelPriors) {
      for (const prior of KNOWN_MODEL_PRIORS) {
        this.activePriors.add(`model:${prior.modelId}`);
        this.priorConfidence.set(`model:${prior.modelId}`, prior.confidence);
      }
    }

    if (this.config.enableStrategyPriors) {
      for (const prior of KNOWN_STRATEGY_PRIORS) {
        this.activePriors.add(`strategy:${prior.strategy}`);
        this.priorConfidence.set(`strategy:${prior.strategy}`, prior.confidence);
      }
    }

    if (this.config.enablePromptPriors) {
      for (const prior of KNOWN_PROMPT_PRIORS) {
        this.activePriors.add(`prompt:${prior.enrichmentType}`);
        this.priorConfidence.set(`prompt:${prior.enrichmentType}`, prior.confidence);
      }
    }
  }

  getModelPriors(): ModelPrior[] {
    if (!this.config.enableModelPriors) return [];
    return KNOWN_MODEL_PRIORS;
  }

  getStrategyPriors(): StrategyPrior[] {
    if (!this.config.enableStrategyPriors) return [];
    return KNOWN_STRATEGY_PRIORS;
  }

  getPromptPriors(): PromptEnrichmentPrior[] {
    if (!this.config.enablePromptPriors) return [];
    return KNOWN_PROMPT_PRIORS;
  }

  getPriorForModel(modelId: string): ModelPrior | null {
    return KNOWN_MODEL_PRIORS.find(p => p.modelId === modelId) || null;
  }

  getPriorForStrategy(strategy: string): StrategyPrior | null {
    return KNOWN_STRATEGY_PRIORS.find(p => p.strategy === strategy) || null;
  }

  getPriorForPrompt(enrichmentType: string): PromptEnrichmentPrior | null {
    return KNOWN_PROMPT_PRIORS.find(p => p.enrichmentType === enrichmentType) || null;
  }

  getEffectivePrior(
    type: 'model' | 'strategy' | 'prompt',
    id: string,
    observedRate: number,
    sampleSize: number
  ): { adjustedRate: number; weight: number } {
    const priorKey = `${type}:${id}`;
    const priorConfidence = this.priorConfidence.get(priorKey) || 0.5;

    const bayesianWeight = Math.min(1, sampleSize / 20);
    const priorWeight = priorConfidence * (1 - bayesianWeight);

    let priorRate: number;
    switch (type) {
      case 'model': {
        const modelPrior = this.getPriorForModel(id);
        priorRate = modelPrior?.expectedSuccessRate || 0.5;
        break;
      }
      case 'strategy': {
        const strategyPrior = this.getPriorForStrategy(id);
        priorRate = strategyPrior?.expectedSuccessRate || 0.5;
        break;
      }
      case 'prompt': {
        const promptPrior = this.getPriorForPrompt(id);
        priorRate = promptPrior ? 0.5 + promptPrior.expectedImprovement : 0.5;
        break;
      }
    }

    const adjustedRate = priorRate * priorWeight + observedRate * bayesianWeight;
    const totalWeight = priorWeight + bayesianWeight;

    return {
      adjustedRate: totalWeight > 0 ? adjustedRate / totalWeight : observedRate,
      weight: totalWeight,
    };
  }

  recordPriorUse(type: 'model' | 'strategy' | 'prompt', id: string): void {
    const priorKey = `${type}:${id}`;
    const currentUse = this.usedPriors.get(priorKey) || 0;
    this.usedPriors.set(priorKey, currentUse + 1);

    const currentConfidence = this.priorConfidence.get(priorKey) || 0.5;
    if (currentUse > 5) {
      const decayFactor = Math.pow(this.config.confidenceDecayFactor, currentUse - 5);
      this.priorConfidence.set(priorKey, currentConfidence * decayFactor);
    }
  }

  getConfidence(type: 'model' | 'strategy' | 'prompt', id: string): number {
    const priorKey = `${type}:${id}`;
    return this.priorConfidence.get(priorKey) || 0;
  }

  isPriorActive(type: 'model' | 'strategy' | 'prompt', id: string): boolean {
    const priorKey = `${type}:${id}`;
    if (!this.activePriors.has(priorKey)) return false;

    const confidence = this.priorConfidence.get(priorKey) || 0;
    return confidence >= this.config.minConfidenceThreshold;
  }

  bootstrapModelMetrics(modelId: string): Partial<ModelPerformanceMetrics> | null {
    const prior = this.getPriorForModel(modelId);
    if (!prior || !this.config.enableModelPriors) return null;

    return {
      modelId,
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      avgLatencyMs: prior.expectedLatencyMs,
      avgCostUSD: prior.expectedCostUSD,
      avgTokensIn: 0,
      avgTokensOut: 0,
      successRate: prior.expectedSuccessRate,
      successRateCI: {
        lower: Math.max(0, prior.expectedSuccessRate - 0.1),
        upper: Math.min(1, prior.expectedSuccessRate + 0.1),
      },
      reliabilityScore: prior.reliabilityWeight,
      overallScore: prior.expectedSuccessRate * prior.reliabilityWeight,
      sampleSize: 0,
      throughput: 0,
      p50LatencyMs: prior.expectedLatencyMs * 0.8,
      p95LatencyMs: prior.expectedLatencyMs * 1.5,
      p99LatencyMs: prior.expectedLatencyMs * 2.5,
      costPerSuccess: prior.expectedCostUSD / prior.expectedSuccessRate,
      latencyTrend: { slope: 0, direction: 'stable' as const },
      successTrend: { slope: 0, direction: 'stable' as const },
      lastUpdated: Date.now(),
    };
  }

  bootstrapStrategyStats(strategy: string): Partial<AggregateStats> | null {
    const prior = this.getPriorForStrategy(strategy);
    if (!prior || !this.config.enableStrategyPriors) return null;

    return {
      successRate: prior.expectedSuccessRate,
      successRateRaw: prior.expectedSuccessRate,
      successRateCI: [
        Math.max(0, prior.expectedSuccessRate - 0.1),
        Math.min(1, prior.expectedSuccessRate + 0.1),
      ],
      avgLatencyMs: prior.expectedLatencyMs,
      medianLatencyMs: prior.expectedLatencyMs * 0.8,
      p95LatencyMs: prior.expectedLatencyMs * 1.5,
      avgRetries: 0,
      avgCostUSD: prior.expectedCostUSD,
      avgTokens: 0,
      sampleSize: 0,
      confidence: 'medium',
      trend: 'stable',
    };
  }

  getStatistics(): {
    totalPriors: number;
    activePriors: number;
    averageConfidence: number;
    usedPriors: number;
    byType: Record<string, { total: number; active: number; avgConfidence: number }>;
  } {
    const byType: Record<string, { total: number; active: number; avgConfidence: number }> = {
      model: { total: 0, active: 0, avgConfidence: 0 },
      strategy: { total: 0, active: 0, avgConfidence: 0 },
      prompt: { total: 0, active: 0, avgConfidence: 0 },
    };

    let totalConfidence = 0;
    let totalCount = 0;

    for (const [key, confidence] of this.priorConfidence) {
      const [type] = key.split(':') as ['model' | 'strategy' | 'prompt', string];
      byType[type].total++;
      byType[type].avgConfidence += confidence;

      if (confidence >= this.config.minConfidenceThreshold) {
        byType[type].active++;
      }

      totalConfidence += confidence;
      totalCount++;
    }

    for (const type of ['model', 'strategy', 'prompt'] as const) {
      if (byType[type].total > 0) {
        byType[type].avgConfidence /= byType[type].total;
      }
    }

    return {
      totalPriors: this.priorConfidence.size,
      activePriors: Array.from(this.priorConfidence.values()).filter(
        c => c >= this.config.minConfidenceThreshold
      ).length,
      averageConfidence: totalCount > 0 ? totalConfidence / totalCount : 0,
      usedPriors: this.usedPriors.size,
      byType,
    };
  }

  resetPriorConfidence(type?: 'model' | 'strategy' | 'prompt', id?: string): void {
    if (type && id) {
      const priorKey = `${type}:${id}`;
      const originalPrior = this.getOriginalConfidence(type, id);
      if (originalPrior !== null) {
        this.priorConfidence.set(priorKey, originalPrior);
        this.usedPriors.delete(priorKey);
      }
    } else {
      for (const prior of [...KNOWN_MODEL_PRIORS, ...KNOWN_STRATEGY_PRIORS, ...KNOWN_PROMPT_PRIORS]) {
        let type: 'model' | 'strategy' | 'prompt';
        let originalId: string;

        if ('modelId' in prior) {
          type = 'model';
          originalId = prior.modelId;
        } else if ('strategy' in prior) {
          type = 'strategy';
          originalId = prior.strategy;
        } else {
          type = 'prompt';
          originalId = prior.enrichmentType;
        }

        this.priorConfidence.set(`${type}:${originalId}`, prior.confidence);
      }
      this.usedPriors.clear();
    }
  }

  private getOriginalConfidence(
    type: 'model' | 'strategy' | 'prompt',
    id: string
  ): number | null {
    switch (type) {
      case 'model': {
        const prior = KNOWN_MODEL_PRIORS.find(p => p.modelId === id);
        return prior?.confidence ?? null;
      }
      case 'strategy': {
        const prior = KNOWN_STRATEGY_PRIORS.find(p => p.strategy === id);
        return prior?.confidence ?? null;
      }
      case 'prompt': {
        const prior = KNOWN_PROMPT_PRIORS.find(p => p.enrichmentType === id);
        return prior?.confidence ?? null;
      }
    }
  }

  setEnabled(type: 'model' | 'strategy' | 'prompt', enabled: boolean): void {
    switch (type) {
      case 'model':
        this.config.enableModelPriors = enabled;
        break;
      case 'strategy':
        this.config.enableStrategyPriors = enabled;
        break;
      case 'prompt':
        this.config.enablePromptPriors = enabled;
        break;
    }
  }
}

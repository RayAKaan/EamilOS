import type { ExecutionRecord } from './types.js';

export interface Attribution {
  model: number;
  strategy: number;
  prompt: number;
  parameters: number;
  confidence: number;
}

export interface ExecutionMetrics {
  success: boolean;
  latencyMs: number;
  cost: number;
  retries: number;
  timestamp: number;
  score: number;
}

export interface AttributionConfig {
  modelWeight: number;
  strategyWeight: number;
  promptWeight: number;
  parameterWeight: number;
  minConfidenceSamples: number;
}

export const DEFAULT_ATTRIBUTION_CONFIG: AttributionConfig = {
  modelWeight: 0.4,
  strategyWeight: 0.3,
  promptWeight: 0.2,
  parameterWeight: 0.1,
  minConfidenceSamples: 5,
};

export class CausalAttribution {
  private config: AttributionConfig;
  private baselineMetrics: ExecutionMetrics | null = null;
  private executionHistory: AttributionRecord[] = [];
  private readonly maxHistory = 1000;

  constructor(config: Partial<AttributionConfig> = {}) {
    this.config = { ...DEFAULT_ATTRIBUTION_CONFIG, ...config };
  }

  setBaseline(record: ExecutionRecord): void {
    this.baselineMetrics = this.computeMetrics(record);
  }

  computeAttribution(
    current: ExecutionRecord,
    changedComponents: ChangedComponents
  ): Attribution {
    const currentMetrics = this.computeMetrics(current);
    
    if (!this.baselineMetrics) {
      this.baselineMetrics = currentMetrics;
      return {
        model: this.config.modelWeight,
        strategy: this.config.strategyWeight,
        prompt: this.config.promptWeight,
        parameters: this.config.parameterWeight,
        confidence: 0,
      };
    }

    const delta = currentMetrics.score - this.baselineMetrics.score;

    if (delta === 0) {
      return {
        model: 0,
        strategy: 0,
        prompt: 0,
        parameters: 0,
        confidence: 1,
      };
    }

    const attribution = this.counterfactualAttribution(delta, changedComponents);

    const record: AttributionRecord = {
      timestamp: Date.now(),
      delta,
      attribution,
      changedComponents,
      success: current.success,
    };
    
    this.executionHistory.push(record);
    if (this.executionHistory.length > this.maxHistory) {
      this.executionHistory.shift();
    }

    this.baselineMetrics = currentMetrics;

    return attribution;
  }

  private counterfactualAttribution(
    delta: number,
    changed: ChangedComponents
  ): Attribution {
    const hasModelChange = changed.model.length > 0;
    const hasStrategyChange = changed.strategy !== null;
    const hasPromptChange = changed.prompt.length > 0;
    const hasParamChange = changed.parameters.length > 0;

    const changeCount = 
      (hasModelChange ? 1 : 0) +
      (hasStrategyChange ? 1 : 0) +
      (hasPromptChange ? 1 : 0) +
      (hasParamChange ? 1 : 0);

    if (changeCount === 0) {
      return {
        model: 0,
        strategy: 0,
        prompt: 0,
        parameters: 0,
        confidence: 0,
      };
    }

    const attribution: Attribution = {
      model: hasModelChange ? delta * this.config.modelWeight : 0,
      strategy: hasStrategyChange ? delta * this.config.strategyWeight : 0,
      prompt: hasPromptChange ? delta * this.config.promptWeight : 0,
      parameters: hasParamChange ? delta * this.config.parameterWeight : 0,
      confidence: this.computeConfidence(),
    };

    const total = attribution.model + attribution.strategy + attribution.prompt + attribution.parameters;
    if (total > 0) {
      const scale = Math.abs(delta) / total;
      attribution.model *= scale;
      attribution.strategy *= scale;
      attribution.prompt *= scale;
      attribution.parameters *= scale;
    }

    return attribution;
  }

  private computeConfidence(): number {
    const recent = this.executionHistory.slice(-this.config.minConfidenceSamples);
    if (recent.length < this.config.minConfidenceSamples) {
      return recent.length / this.config.minConfidenceSamples;
    }

    const successes = recent.filter(r => r.success).length;
    const variance = (successes / recent.length) * (1 - successes / recent.length);
    
    return Math.max(0, 1 - Math.sqrt(variance));
  }

  private computeMetrics(record: ExecutionRecord): ExecutionMetrics {
    return {
      success: record.success,
      latencyMs: record.totalLatencyMs,
      cost: record.totalCostUSD,
      retries: record.retryCount,
      timestamp: record.timestamp,
      score: computeObjectiveScore({
        success: record.success,
        latencyMs: record.totalLatencyMs,
        cost: record.totalCostUSD,
        retries: record.retryCount,
      }),
    };
  }

  getWeightedUpdate(attribution: Attribution): WeightedUpdate {
    return {
      modelWeight: Math.abs(attribution.model),
      strategyWeight: Math.abs(attribution.strategy),
      promptWeight: Math.abs(attribution.prompt),
      parameterWeight: Math.abs(attribution.parameters),
      confidence: attribution.confidence,
    };
  }

  getAttributionHistory(): AttributionRecord[] {
    return [...this.executionHistory];
  }

  getCausalInsights(): CausalInsight[] {
    const insights: CausalInsight[] = [];
    const recent = this.executionHistory.slice(-100);

    if (recent.length < 10) {
      return insights;
    }

    const modelImpacts = recent.filter(r => r.changedComponents.model.length > 0);
    const strategyImpacts = recent.filter(r => r.changedComponents.strategy !== null);
    const promptImpacts = recent.filter(r => r.changedComponents.prompt.length > 0);

    if (modelImpacts.length > 0) {
      const avgImpact = modelImpacts.reduce((sum, r) => sum + r.attribution.model, 0) / modelImpacts.length;
      insights.push({
        component: 'model',
        avgImpact,
        sampleCount: modelImpacts.length,
        direction: avgImpact > 0 ? 'positive' : avgImpact < 0 ? 'negative' : 'neutral',
      });
    }

    if (strategyImpacts.length > 0) {
      const avgImpact = strategyImpacts.reduce((sum, r) => sum + r.attribution.strategy, 0) / strategyImpacts.length;
      insights.push({
        component: 'strategy',
        avgImpact,
        sampleCount: strategyImpacts.length,
        direction: avgImpact > 0 ? 'positive' : avgImpact < 0 ? 'negative' : 'neutral',
      });
    }

    if (promptImpacts.length > 0) {
      const avgImpact = promptImpacts.reduce((sum, r) => sum + r.attribution.prompt, 0) / promptImpacts.length;
      insights.push({
        component: 'prompt',
        avgImpact,
        sampleCount: promptImpacts.length,
        direction: avgImpact > 0 ? 'positive' : avgImpact < 0 ? 'negative' : 'neutral',
      });
    }

    return insights;
  }
}

export interface ChangedComponents {
  model: string[];
  strategy: string | null;
  prompt: string[];
  parameters: string[];
}

export interface AttributionRecord {
  timestamp: number;
  delta: number;
  attribution: Attribution;
  changedComponents: ChangedComponents;
  success: boolean;
}

export interface WeightedUpdate {
  modelWeight: number;
  strategyWeight: number;
  promptWeight: number;
  parameterWeight: number;
  confidence: number;
}

export interface CausalInsight {
  component: 'model' | 'strategy' | 'prompt' | 'parameters';
  avgImpact: number;
  sampleCount: number;
  direction: 'positive' | 'negative' | 'neutral';
}

export function computeObjectiveScore(metrics: {
  success: boolean;
  latencyMs: number;
  cost: number;
  retries: number;
}): number {
  const successComponent = metrics.success ? 1 : 0;
  const latencyPenalty = Math.min(1, metrics.latencyMs / 120000) * 0.2;
  const costPenalty = Math.min(1, metrics.cost / 1) * 0.2;
  const retryPenalty = Math.min(1, metrics.retries / 5) * 0.1;

  return Math.max(0, successComponent * 0.5 - latencyPenalty - costPenalty - retryPenalty);
}

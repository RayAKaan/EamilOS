import { ModelMetrics } from './MetricsStore.js';
import { TaskCategory } from './TaskClassifier.js';

export interface ScoringWeights {
  accuracy: number;
  reliability: number;
  speed: number;
  cost: number;
  categoryFit: number;
}

export interface ModelScore {
  modelId: string;
  provider: string;
  totalScore: number;
  breakdown: {
    accuracy: number;
    reliability: number;
    speed: number;
    cost: number;
    categoryFit: number;
  };
  confidence: number;
  reasoning: string;
}

export class RoutingStrategy {

  private static readonly DEFAULT_WEIGHTS: ScoringWeights = {
    accuracy: 0.35,
    reliability: 0.25,
    speed: 0.15,
    cost: 0.10,
    categoryFit: 0.15
  };

  private static readonly CATEGORY_WEIGHTS: Record<string, Partial<ScoringWeights>> = {
    code: {
      accuracy: 0.40,
      reliability: 0.20,
      speed: 0.10,
      cost: 0.10,
      categoryFit: 0.20
    },
    multi_file: {
      accuracy: 0.30,
      reliability: 0.30,
      speed: 0.05,
      cost: 0.10,
      categoryFit: 0.25
    },
    json: {
      accuracy: 0.25,
      reliability: 0.35,
      speed: 0.15,
      cost: 0.10,
      categoryFit: 0.15
    },
    simple: {
      accuracy: 0.25,
      reliability: 0.20,
      speed: 0.30,
      cost: 0.15,
      categoryFit: 0.10
    },
    reasoning: {
      accuracy: 0.45,
      reliability: 0.15,
      speed: 0.10,
      cost: 0.10,
      categoryFit: 0.20
    },
    debug: {
      accuracy: 0.45,
      reliability: 0.20,
      speed: 0.10,
      cost: 0.10,
      categoryFit: 0.15
    },
    test: {
      accuracy: 0.35,
      reliability: 0.25,
      speed: 0.10,
      cost: 0.10,
      categoryFit: 0.20
    },
    refactor: {
      accuracy: 0.40,
      reliability: 0.20,
      speed: 0.10,
      cost: 0.10,
      categoryFit: 0.20
    },
    documentation: {
      accuracy: 0.30,
      reliability: 0.20,
      speed: 0.20,
      cost: 0.15,
      categoryFit: 0.15
    }
  };

  scoreModel(
    metrics: ModelMetrics,
    taskCategory: TaskCategory,
    allModelMetrics: ModelMetrics[]
  ): ModelScore {
    const weights = this.getWeights(taskCategory);

    const accuracy = metrics.overallSuccessRate;

    const reliability =
      (metrics.firstAttemptSuccessRate * 0.5) +
      ((1 - Math.min(metrics.averageRetriesNeeded / 5, 1)) * 0.3) +
      ((1 - metrics.failureRate) * 0.2);

    const allLatencies = allModelMetrics
      .map(m => m.averageLatencyMs)
      .filter(l => l > 0);
    const maxLatency = Math.max(...allLatencies, 1);
    const speed = allLatencies.length > 0
      ? 1 - (metrics.averageLatencyMs / maxLatency)
      : 0.5;

    const allCosts = allModelMetrics
      .map(m => m.averageCostPerTask)
      .filter(c => c > 0);
    let cost: number;
    if (metrics.averageCostPerTask === 0) {
      cost = 1.0;
    } else if (allCosts.length > 0) {
      const maxCost = Math.max(...allCosts, 0.001);
      cost = 1 - (metrics.averageCostPerTask / maxCost);
    } else {
      cost = 0.5;
    }

    const catMetrics = metrics.categoryMetrics[taskCategory];
    let categoryFit: number;
    if (catMetrics && catMetrics.totalTasks >= 3) {
      categoryFit = catMetrics.successRate;
    } else if (catMetrics && catMetrics.totalTasks > 0) {
      categoryFit = (catMetrics.successRate * 0.4) + (metrics.overallSuccessRate * 0.6);
    } else {
      categoryFit = metrics.overallSuccessRate * 0.8;
    }

    const totalScore =
      (accuracy * weights.accuracy) +
      (reliability * weights.reliability) +
      (speed * weights.speed) +
      (cost * weights.cost) +
      (categoryFit * weights.categoryFit);

    const confidence = this.computeConfidence(metrics, taskCategory);

    const reasoning = this.generateReasoning(
      metrics, taskCategory, totalScore,
      { accuracy, reliability, speed, cost, categoryFit },
      weights, confidence
    );

    return {
      modelId: metrics.modelId,
      provider: metrics.provider,
      totalScore: Math.max(0, Math.min(1, totalScore)),
      breakdown: {
        accuracy: Math.max(0, Math.min(1, accuracy)),
        reliability: Math.max(0, Math.min(1, reliability)),
        speed: Math.max(0, Math.min(1, speed)),
        cost: Math.max(0, Math.min(1, cost)),
        categoryFit: Math.max(0, Math.min(1, categoryFit))
      },
      confidence,
      reasoning
    };
  }

  private getWeights(taskCategory: TaskCategory): ScoringWeights {
    const overrides = RoutingStrategy.CATEGORY_WEIGHTS[taskCategory] || {};
    return { ...RoutingStrategy.DEFAULT_WEIGHTS, ...overrides };
  }

  private computeConfidence(metrics: ModelMetrics, taskCategory: TaskCategory): number {
    const totalTasks = metrics.totalTasks;
    const categoryTasks = metrics.categoryMetrics[taskCategory]?.totalTasks || 0;

    if (totalTasks < 5) return 0.1;

    const volumeConfidence = Math.min(1, Math.log10(totalTasks + 1) / 2.5);
    const categoryConfidence = categoryTasks >= 10 ? 1.0 :
                               categoryTasks >= 5 ? 0.7 :
                               categoryTasks >= 2 ? 0.4 :
                               categoryTasks >= 1 ? 0.2 : 0;

    return (volumeConfidence * 0.6) + (categoryConfidence * 0.4);
  }

  private generateReasoning(
    metrics: ModelMetrics,
    taskCategory: TaskCategory,
    totalScore: number,
    scores: Record<string, number>,
    _weights: ScoringWeights,
    confidence: number
  ): string {
    const parts: string[] = [];

    parts.push(`Model ${metrics.modelId} scored ${(totalScore * 100).toFixed(1)}% for ${taskCategory} tasks.`);

    const dimensions = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const strongest = dimensions[0];
    const weakest = dimensions[dimensions.length - 1];

    parts.push(`Strongest: ${strongest[0]} (${(strongest[1] * 100).toFixed(0)}%).`);
    parts.push(`Weakest: ${weakest[0]} (${(weakest[1] * 100).toFixed(0)}%).`);

    if (confidence < 0.3) {
      parts.push(`Low confidence — only ${metrics.totalTasks} tasks recorded.`);
    }

    const catData = metrics.categoryMetrics[taskCategory];
    if (catData && catData.totalTasks > 0) {
      parts.push(`Category-specific: ${catData.totalTasks} ${taskCategory} tasks, ${(catData.successRate * 100).toFixed(0)}% success.`);
    } else {
      parts.push(`No ${taskCategory}-specific data — using overall metrics as proxy.`);
    }

    return parts.join(' ');
  }
}

let globalRoutingStrategy: RoutingStrategy | null = null;

export function getRoutingStrategy(): RoutingStrategy {
  if (!globalRoutingStrategy) {
    globalRoutingStrategy = new RoutingStrategy();
  }
  return globalRoutingStrategy;
}

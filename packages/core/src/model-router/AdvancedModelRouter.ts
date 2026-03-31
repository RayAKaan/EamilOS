import { nanoid } from 'nanoid';
import { getSecureLogger, SecureLogger } from '../security/SecureLogger.js';
import { MetricsStore, ModelMetrics } from './MetricsStore.js';
import { TaskClassifier, TaskCategory } from './TaskClassifier.js';
import { ModelScore, RoutingStrategy } from './RoutingStrategy.js';

export interface ModelSelection {
  modelId: string;
  provider: string;
  score: ModelScore;
  selectionMethod: 'scored' | 'exploration' | 'override' | 'fallback' | 'default';
  alternates: ModelScore[];
  reasoning: string;
  availableModels?: Array<{ modelId: string; provider: string }>;
}

export interface RouterConfig {
  explorationRate: number;
  minimumConfidence: number;
  minimumDataPoints: number;
  overrides: Record<string, string>;
  defaultModel: string;
  defaultProvider: string;
}

export class ModelRouter {

  private metricsStore: MetricsStore;
  private classifier: TaskClassifier;
  private strategy: RoutingStrategy;
  private config: RouterConfig;
  private logger: SecureLogger;

  constructor(
    metricsStore: MetricsStore,
    config: Partial<RouterConfig> = {},
    logger?: SecureLogger
  ) {
    this.metricsStore = metricsStore;
    this.classifier = new TaskClassifier();
    this.strategy = new RoutingStrategy();
    this.logger = logger || getSecureLogger();

    this.config = {
      explorationRate: 0.1,
      minimumConfidence: 0.2,
      minimumDataPoints: 5,
      overrides: {},
      defaultModel: 'phi3:mini',
      defaultProvider: 'ollama',
      ...config
    };
  }

  selectModel(
    instruction: string,
    availableModels: Array<{ modelId: string; provider: string }>
  ): ModelSelection {
    const classification = this.classifier.classify(instruction);

    this.logger.debug('Task classified', {
      category: classification.primaryCategory,
      complexity: classification.complexity,
      confidence: classification.confidence,
      signals: classification.signals
    });

    const override = this.checkOverride(classification.primaryCategory, availableModels);
    if (override) {
      this.logger.info('Using user override', {
        category: classification.primaryCategory,
        model: override.modelId
      });
      return override;
    }

    const allMetrics = this.getAvailableModelMetrics(availableModels);

    if (allMetrics.length === 0) {
      this.logger.info('No metrics available, using default model', {
        model: this.config.defaultModel
      });
      return this.defaultSelection(availableModels);
    }

    const scores = allMetrics
      .map(m => this.strategy.scoreModel(m, classification.primaryCategory, allMetrics))
      .sort((a, b) => b.totalScore - a.totalScore);

    if (this.shouldExplore(scores)) {
      const exploration = this.exploreRandom(scores, availableModels);
      this.logger.info('Exploration: selected random model', {
        model: exploration.modelId,
        normalWinner: scores[0].modelId
      });
      return exploration;
    }

    const best = scores[0];
    const alternates = scores.slice(1);

    this.logger.info('Model selected by score', {
      model: best.modelId,
      score: best.totalScore,
      category: classification.primaryCategory,
      alternateCount: alternates.length
    });

    return {
      modelId: best.modelId,
      provider: best.provider,
      score: best,
      selectionMethod: 'scored',
      alternates,
      reasoning: best.reasoning,
      availableModels
    };
  }

  selectFallback(
    failedModelId: string,
    previousSelection: ModelSelection
  ): ModelSelection | null {
    const remaining = previousSelection.alternates
      .filter(s => s.modelId !== failedModelId);

    if (remaining.length > 0) {
      const next = remaining[0];

      this.logger.info('Falling back to next model', {
        failedModel: failedModelId,
        fallbackModel: next.modelId,
        fallbackScore: next.totalScore
      });

      return {
        modelId: next.modelId,
        provider: next.provider,
        score: next,
        selectionMethod: 'fallback',
        alternates: remaining.slice(1),
        reasoning: `Fallback from ${failedModelId}. ${next.reasoning}`
      };
    }

    const available = previousSelection.availableModels || [];
    const fallbackModel = available.find(m => m.modelId !== failedModelId);

    if (!fallbackModel) {
      this.logger.warn('No fallback models available', {
        failedModel: failedModelId
      });
      return null;
    }

    this.logger.info('Falling back to available model', {
      failedModel: failedModelId,
      fallbackModel: fallbackModel.modelId
    });

    return {
      modelId: fallbackModel.modelId,
      provider: fallbackModel.provider,
      score: {
        modelId: fallbackModel.modelId,
        provider: fallbackModel.provider,
        totalScore: 0.5,
        breakdown: { accuracy: 0.5, reliability: 0.5, speed: 0.5, cost: 0.5, categoryFit: 0.5 },
        confidence: 0,
        reasoning: 'Fallback from available models'
      },
      selectionMethod: 'fallback',
      alternates: [],
      reasoning: `Fallback from ${failedModelId} to available model ${fallbackModel.modelId}`
    };
  }

  recordResult(
    modelId: string,
    provider: string,
    instruction: string,
    result: {
      success: boolean;
      retriesUsed: number;
      latencyMs: number;
      tokensUsed: number;
      costUsd: number;
      parseSucceeded: boolean;
      validationSucceeded: boolean;
      failureReason?: string;
    }
  ): void {
    const classification = this.classifier.classify(instruction);

    this.metricsStore.recordExecution({
      id: nanoid(),
      modelId,
      provider,
      taskCategory: classification.primaryCategory,
      instruction,
      success: result.success,
      retriesUsed: result.retriesUsed,
      latencyMs: result.latencyMs,
      tokensUsed: result.tokensUsed,
      costUsd: result.costUsd,
      parseSucceeded: result.parseSucceeded,
      validationSucceeded: result.validationSucceeded,
      failureReason: result.failureReason,
      timestamp: new Date().toISOString()
    });

    this.logger.debug('Execution recorded for model learning', {
      model: modelId,
      category: classification.primaryCategory,
      success: result.success,
      retries: result.retriesUsed
    });
  }

  private checkOverride(
    taskCategory: TaskCategory,
    availableModels: Array<{ modelId: string; provider: string }>
  ): ModelSelection | null {
    const overrideModelId = this.config.overrides[taskCategory];
    if (!overrideModelId) return null;

    const found = availableModels.find(m => m.modelId === overrideModelId);
    if (!found) {
      this.logger.warn('Override model not available', {
        category: taskCategory,
        overrideModel: overrideModelId,
        available: availableModels.map(m => m.modelId)
      });
      return null;
    }

    const metrics = this.metricsStore.getMetrics(overrideModelId);
    const allMetrics = this.metricsStore.getAllModelMetrics();

    const score = metrics
      ? this.strategy.scoreModel(metrics, taskCategory, allMetrics)
      : {
          modelId: overrideModelId,
          provider: found.provider,
          totalScore: 0.5,
          breakdown: { accuracy: 0.5, reliability: 0.5, speed: 0.5, cost: 0.5, categoryFit: 0.5 },
          confidence: 0,
          reasoning: 'User override — no metrics available'
        };

    return {
      modelId: overrideModelId,
      provider: found.provider,
      score,
      selectionMethod: 'override',
      alternates: [],
      reasoning: `User override: ${taskCategory} → ${overrideModelId}`,
      availableModels
    };
  }

  private getAvailableModelMetrics(
    availableModels: Array<{ modelId: string; provider: string }>
  ): ModelMetrics[] {
    const metrics: ModelMetrics[] = [];

    for (const model of availableModels) {
      const m = this.metricsStore.getMetrics(model.modelId);
      if (m && m.totalTasks >= this.config.minimumDataPoints) {
        metrics.push(m);
      }
    }

    return metrics;
  }

  private shouldExplore(scores: ModelScore[]): boolean {
    if (scores.length <= 1) return false;

    const topConfidence = scores[0].confidence;
    if (topConfidence < 0.3) return false;

    return Math.random() < this.config.explorationRate;
  }

  private exploreRandom(
    scores: ModelScore[],
    _availableModels: Array<{ modelId: string; provider: string }>
  ): ModelSelection {
    const nonTop = scores.length > 1
      ? scores.slice(1)
      : scores;

    const randomIndex = Math.floor(Math.random() * nonTop.length);
    const selected = nonTop[randomIndex];

    return {
      modelId: selected.modelId,
      provider: selected.provider,
      score: selected,
      selectionMethod: 'exploration',
      alternates: scores.filter(s => s.modelId !== selected.modelId),
      reasoning: `Exploration mode: randomly selected ${selected.modelId} instead of top scorer ${scores[0].modelId} to gather more data.`,
      availableModels: scores.length > 0 ? scores.map(s => ({ modelId: s.modelId, provider: s.provider })) : []
    };
  }

  private defaultSelection(
    availableModels: Array<{ modelId: string; provider: string }>
  ): ModelSelection {
    let selected = availableModels.find(m => m.modelId === this.config.defaultModel);

    if (!selected && availableModels.length > 0) {
      selected = availableModels[0];
    }

    if (!selected) {
      selected = { modelId: this.config.defaultModel, provider: this.config.defaultProvider };
    }

    return {
      modelId: selected.modelId,
      provider: selected.provider,
      score: {
        modelId: selected.modelId,
        provider: selected.provider,
        totalScore: 0.5,
        breakdown: { accuracy: 0.5, reliability: 0.5, speed: 0.5, cost: 0.5, categoryFit: 0.5 },
        confidence: 0,
        reasoning: 'Default model — no metrics data available yet'
      },
      selectionMethod: 'default',
      alternates: [],
      reasoning: 'No metrics data available. Using default model. Run benchmarks to generate initial data.',
      availableModels
    };
  }

  getModelRankings(taskCategory: TaskCategory): ModelScore[] {
    const allMetrics = this.metricsStore.getAllModelMetrics();
    return allMetrics
      .map(m => this.strategy.scoreModel(m, taskCategory, allMetrics))
      .sort((a, b) => b.totalScore - a.totalScore);
  }

  getRouterStatus(): {
    totalModelsTracked: number;
    totalExecutionsRecorded: number;
    explorationRate: number;
    overrides: Record<string, string>;
    topModelPerCategory: Record<string, string>;
  } {
    const allMetrics = this.metricsStore.getAllModelMetrics();
    const categories: TaskCategory[] = [
      'code', 'multi_file', 'json', 'reasoning',
      'simple', 'refactor', 'debug', 'test', 'documentation'
    ];

    const topPerCategory: Record<string, string> = {};
    for (const cat of categories) {
      const rankings = allMetrics
        .map(m => this.strategy.scoreModel(m, cat, allMetrics))
        .sort((a, b) => b.totalScore - a.totalScore);
      if (rankings.length > 0) {
        topPerCategory[cat] = rankings[0].modelId;
      }
    }

    return {
      totalModelsTracked: allMetrics.length,
      totalExecutionsRecorded: allMetrics.reduce((sum, m) => sum + m.totalTasks, 0),
      explorationRate: this.config.explorationRate,
      overrides: this.config.overrides,
      topModelPerCategory: topPerCategory
    };
  }

  updateConfig(config: Partial<RouterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): RouterConfig {
    return { ...this.config };
  }
}

let globalModelRouter: ModelRouter | null = null;

export function initModelRouter(
  metricsStore?: MetricsStore,
  config?: Partial<RouterConfig>,
  logger?: SecureLogger
): ModelRouter {
  globalModelRouter = new ModelRouter(
    metricsStore || new MetricsStore(),
    config,
    logger
  );
  return globalModelRouter;
}

export function getModelRouter(): ModelRouter {
  if (!globalModelRouter) {
    return initModelRouter();
  }
  return globalModelRouter;
}

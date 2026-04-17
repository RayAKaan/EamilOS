import {
  PredictionSignals,
  ScoredStrategy,
  HistoricalMatch,
  OutcomeAggregation,
  PredictionConfig,
  DEFAULT_PREDICTION_CONFIG,
  BUILT_IN_STRATEGIES,
} from './prediction-types.js';
import { HistoryProfiler } from './history-profiler.js';

export interface ScoringResult {
  strategy: ScoredStrategy;
  historicalSuccessRate: number;
  contextSimilarity: number;
  attemptPenalty: number;
  finalConfidence: number;
  isColdStart: boolean;
  reasoning: string;
}

export class ConfidenceScorer {
  private config: PredictionConfig;

  constructor(_profiler: HistoryProfiler, config?: Partial<PredictionConfig>) {
    this.config = { ...DEFAULT_PREDICTION_CONFIG, ...config };
  }

  scoreStrategies(
    signals: PredictionSignals,
    historicalMatches: HistoricalMatch[],
    aggregations: OutcomeAggregation[]
  ): ScoredStrategy[] {
    const strategies: ScoredStrategy[] = [];
    const aggregationMap = new Map<string, OutcomeAggregation>();

    for (const agg of aggregations) {
      aggregationMap.set(agg.strategyUsed, agg);
    }

    for (const builtIn of BUILT_IN_STRATEGIES) {
      if (signals.failureType && !builtIn.applicableFailureTypes.includes(signals.failureType)) {
        continue;
      }

      const scoring = this.calculateStrategyScore(
        builtIn.id,
        builtIn.label,
        builtIn.strategy,
        builtIn.baseConfidence,
        builtIn.riskLevel,
        signals,
        aggregationMap.get(builtIn.strategy),
        historicalMatches
      );

      strategies.push({
        id: builtIn.id,
        label: builtIn.label,
        strategy: builtIn.strategy,
        reasoning: scoring.reasoning,
        confidence: scoring.finalConfidence,
        riskLevel: builtIn.riskLevel,
        dataPoints: scoring.strategy ? aggregationMap.get(builtIn.strategy)?.totalAttempts || 0 : 0,
        historicalSuccessRate: scoring.historicalSuccessRate,
        applied: false,
      });
    }

    strategies.sort((a, b) => b.confidence - a.confidence);

    return strategies;
  }

  private calculateStrategyScore(
    id: string,
    label: string,
    strategy: string,
    baseConfidence: number,
    riskLevel: 'safe' | 'moderate' | 'high',
    signals: PredictionSignals,
    aggregation: OutcomeAggregation | undefined,
    historicalMatches: HistoricalMatch[]
  ): ScoringResult {
    const isColdStart = !aggregation || aggregation.totalAttempts < this.config.minDataPoints;

    let historicalSuccessRate = 0;
    let contextSimilarity = 0;

    if (aggregation && aggregation.totalAttempts >= this.config.minDataPoints) {
      historicalSuccessRate = aggregation.successRate;
    }

    const matchingOutcomes = historicalMatches.filter(m => m.strategyUsed === strategy);
    if (matchingOutcomes.length > 0) {
      const successCount = matchingOutcomes.filter(m => m.outcome === 'success').length;
      contextSimilarity = matchingOutcomes.reduce((sum, m) => sum + m.similarity, 0) / matchingOutcomes.length;
      historicalSuccessRate = successCount / matchingOutcomes.length;
    }

    const attemptPenalty = signals.attempt * this.config.attemptPenalty;

    let finalConfidence: number;

    if (isColdStart) {
      finalConfidence = baseConfidence;
    } else {
      finalConfidence =
        this.config.historicalWeight * historicalSuccessRate +
        this.config.contextWeight * contextSimilarity -
        attemptPenalty;

      finalConfidence = Math.max(0, Math.min(1, finalConfidence));
    }

    const reasoning = this.generateReasoning(
      id,
      strategy,
      isColdStart,
      historicalSuccessRate,
      contextSimilarity,
      attemptPenalty,
      aggregation?.totalAttempts || 0,
      signals
    );

    return {
      strategy: {
        id,
        label,
        strategy,
        confidence: finalConfidence,
        riskLevel,
        dataPoints: aggregation?.totalAttempts || 0,
        historicalSuccessRate,
        applied: false,
        reasoning: '',
      } as ScoredStrategy,
      historicalSuccessRate,
      contextSimilarity,
      attemptPenalty,
      finalConfidence,
      isColdStart,
      reasoning,
    };
  }

  private generateReasoning(
    _id: string,
    _strategy: string,
    isColdStart: boolean,
    historicalSuccessRate: number,
    contextSimilarity: number,
    attemptPenalty: number,
    dataPoints: number,
    signals: PredictionSignals
  ): string {
    const parts: string[] = [];

    if (isColdStart) {
      parts.push(`Cold start: no historical data for ${signals.failureType || 'this context'}.`);
      parts.push(`Using base confidence of ${(this.config.coldStartBaseline * 100).toFixed(0)}%.`);
    } else {
      parts.push(`Historical success rate: ${(historicalSuccessRate * 100).toFixed(0)}% across ${dataPoints} runs.`);

      if (contextSimilarity > 0.5) {
        parts.push(`Context similarity: ${(contextSimilarity * 100).toFixed(0)}% (high relevance).`);
      }

      if (attemptPenalty > 0) {
        parts.push(`Attempt penalty: -${(attemptPenalty * 100).toFixed(0)}% (attempt ${signals.attempt}).`);
      }
    }

    if (signals.targetModel) {
      parts.push(`Model: ${signals.targetModel}.`);
    }

    if (signals.fileExtensions.length > 0) {
      parts.push(`File types: ${signals.fileExtensions.join(', ')}.`);
    }

    return parts.join(' ');
  }

  calculateConfidenceBreakdown(
    signals: PredictionSignals,
    aggregation: OutcomeAggregation | undefined
  ): {
    historicalComponent: number;
    contextComponent: number;
    penaltyComponent: number;
    finalConfidence: number;
  } {
    const isColdStart = !aggregation || aggregation.totalAttempts < this.config.minDataPoints;

    let historicalComponent = 0;
    let contextComponent = this.config.contextWeight;

    if (!isColdStart && aggregation) {
      historicalComponent = this.config.historicalWeight * aggregation.successRate;
    }

    const penaltyComponent = signals.attempt * this.config.attemptPenalty;
    const finalConfidence = Math.max(0, Math.min(1, historicalComponent + contextComponent - penaltyComponent));

    return {
      historicalComponent,
      contextComponent,
      penaltyComponent,
      finalConfidence,
    };
  }

  getRecommendedStrategy(strategies: ScoredStrategy[]): ScoredStrategy | null {
    if (strategies.length === 0) return null;
    return strategies.reduce((best, current) =>
      current.confidence > best.confidence ? current : best
    );
  }

  getStrategiesByRiskLevel(
    strategies: ScoredStrategy[],
    riskLevel: 'safe' | 'moderate' | 'high'
  ): ScoredStrategy[] {
    return strategies.filter(s => s.riskLevel === riskLevel);
  }

  getApplicableStrategies(strategies: ScoredStrategy[], maxRiskLevel: 'safe' | 'moderate'): ScoredStrategy[] {
    const riskOrder = { safe: 0, moderate: 1, high: 2 };
    const maxRiskValue = riskOrder[maxRiskLevel];

    return strategies.filter(s => riskOrder[s.riskLevel] <= maxRiskValue);
  }
}

export function createConfidenceScorer(
  profiler: HistoryProfiler,
  config?: Partial<PredictionConfig>
): ConfidenceScorer {
  return new ConfidenceScorer(profiler, config);
}

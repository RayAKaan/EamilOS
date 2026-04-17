import {
  PredictionSignals,
  PredictionResult,
  ScoredStrategy,
  DecisionPolicy,
  ExecutionOutcome,
  PredictionConfig,
  DEFAULT_PREDICTION_CONFIG,
} from './prediction-types.js';
import { SignalExtractionContext, extractSignals } from './signal-extractor.js';
import { HistoryProfiler, ProfilerConfig, initHistoryProfiler } from './history-profiler.js';
import { ConfidenceScorer } from './confidence-scorer.js';
import { PolicyRouter, PolicyRouterConfig } from './policy-router.js';
import { OutcomeLedger, OutcomeLedgerConfig } from './outcome-ledger.js';

export interface PredictiveEngineConfig {
  prediction: PredictionConfig;
  profiler: ProfilerConfig;
  policy: Pick<PolicyRouterConfig, 'allowAutoSecurityFailures'>;
  ledger: OutcomeLedgerConfig;
}

const DEFAULT_ENGINE_CONFIG: PredictiveEngineConfig = {
  prediction: DEFAULT_PREDICTION_CONFIG,
  profiler: { dbPath: './eamilos-predictions.db', maxOutcomes: 10000, retentionDays: 90 },
  policy: { allowAutoSecurityFailures: false },
  ledger: { autoRecord: true, recordFailures: true, recordSuccesses: true },
};

export class PredictiveEngine {
  private profiler: HistoryProfiler;
  private scorer: ConfidenceScorer;
  private router: PolicyRouter;
  private ledger: OutcomeLedger;
  private config: PredictiveEngineConfig;

  constructor(config?: Partial<PredictiveEngineConfig>) {
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...config };
    this.profiler = initHistoryProfiler(this.config.profiler);
    this.scorer = new ConfidenceScorer(this.profiler, this.config.prediction);
    this.router = new PolicyRouter(this.profiler, this.config.policy);
    this.ledger = new OutcomeLedger(this.profiler, this.config.ledger);
  }

  async predict(context: SignalExtractionContext): Promise<PredictionResult> {
    const signals = extractSignals(context);

    const aggregations = this.profiler.aggregateByStrategy(
      signals.failureType,
      signals.targetModel
    );

    const historicalMatches = this.profiler.findSimilarOutcomes(signals, 50);

    const strategies = this.scorer.scoreStrategies(signals, historicalMatches, aggregations);

    const result = this.router.route(signals, strategies);

    return result;
  }

  async predictForRetry(
    sessionId: string,
    nodeId: string,
    goal: string,
    targetModel: string,
    attempt: number,
    previousError?: SignalExtractionContext['previousError']
  ): Promise<PredictionResult> {
    const context: SignalExtractionContext = {
      sessionId,
      nodeId,
      goal,
      targetModel,
      attempt,
      previousError,
    };

    return this.predict(context);
  }

  recordSuccess(
    sessionId: string,
    nodeId: string,
    strategyUsed: string,
    signals: PredictionSignals,
    timeToCompleteMs?: number
  ): void {
    this.ledger.recordSuccess(sessionId, nodeId, strategyUsed, signals, timeToCompleteMs);
  }

  recordFailure(
    sessionId: string,
    nodeId: string,
    strategyUsed: string,
    signals: PredictionSignals,
    timeToCompleteMs?: number
  ): void {
    this.ledger.recordFailure(sessionId, nodeId, strategyUsed, signals, timeToCompleteMs);
  }

  recordOutcome(outcome: ExecutionOutcome): void {
    this.profiler.recordOutcome(outcome);
  }

  shouldAutoApply(result: PredictionResult): boolean {
    return this.router.shouldAutoApply(result);
  }

  getStrategiesByPolicy(result: PredictionResult): ScoredStrategy[] {
    switch (result.policy) {
      case 'auto':
        return result.strategies.filter(s => s.id === result.recommendedStrategyId);
      case 'enriched_hitl':
        return this.scorer.getApplicableStrategies(result.strategies, 'moderate');
      case 'safe_fallback':
        return this.scorer.getStrategiesByRiskLevel(result.strategies, 'safe');
      default:
        return [];
    }
  }

  getPolicyDescription(policy: DecisionPolicy): string {
    return this.router.getPolicyDescription(policy);
  }

  flushOutcomes(): void {
    this.ledger.flush();
  }

  getOutcomeCount(): number {
    return this.profiler.getOutcomeCount();
  }

  hasHistoricalData(failureType?: string, targetModel?: string): boolean {
    return this.profiler.hasDataForContext(
      failureType as Parameters<typeof this.profiler.hasDataForContext>[0],
      targetModel
    );
  }

  close(): void {
    this.ledger.close();
    this.profiler.close();
  }
}

let globalEngine: PredictiveEngine | null = null;

export function initPredictiveEngine(config?: Partial<PredictiveEngineConfig>): PredictiveEngine {
  if (globalEngine) {
    return globalEngine;
  }
  globalEngine = new PredictiveEngine(config);
  return globalEngine;
}

export function getPredictiveEngine(): PredictiveEngine {
  if (!globalEngine) {
    return initPredictiveEngine();
  }
  return globalEngine;
}

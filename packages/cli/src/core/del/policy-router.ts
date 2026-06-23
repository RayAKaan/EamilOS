import {
  PredictionSignals,
  ScoredStrategy,
  PredictionResult,
  DecisionPolicy,
  PredictionConfig,
  DEFAULT_PREDICTION_CONFIG,
} from './prediction-types.js';
import { HistoryProfiler } from './history-profiler.js';

export interface PolicyRouterConfig extends PredictionConfig {
  allowAutoSecurityFailures: boolean;
}

const DEFAULT_ROUTER_CONFIG: PolicyRouterConfig = {
  ...DEFAULT_PREDICTION_CONFIG,
  allowAutoSecurityFailures: false,
};

export class PolicyRouter {
  private config: PolicyRouterConfig;

  constructor(_profiler: HistoryProfiler, config?: Partial<PolicyRouterConfig>) {
    this.config = { ...DEFAULT_ROUTER_CONFIG, ...config };
  }

  route(
    signals: PredictionSignals,
    strategies: ScoredStrategy[]
  ): PredictionResult {
    if (strategies.length === 0) {
      return this.createSafeFallbackResult(signals, 'No strategies available');
    }

    const recommended = strategies.reduce((best, current) =>
      current.confidence > best.confidence ? current : best
    );

    if (signals.failureType === 'security_error') {
      return this.createSecurityFallbackResult(signals, strategies, recommended);
    }

    const policy = this.determinePolicy(recommended.confidence);

    const reasoning = this.generateRoutingReasoning(
      signals,
      recommended,
      strategies,
      policy
    );

    return {
      signals,
      strategies,
      recommendedStrategyId: recommended.id,
      recommendedStrategy: recommended,
      policy,
      reasoning,
      confidence: recommended.confidence,
      timestamp: Date.now(),
    };
  }

  private determinePolicy(confidence: number): DecisionPolicy {
    if (confidence >= this.config.autoThreshold) {
      return 'auto';
    }

    if (confidence >= this.config.enrichedThreshold) {
      return 'enriched_hitl';
    }

    return 'safe_fallback';
  }

  private generateRoutingReasoning(
    signals: PredictionSignals,
    recommended: ScoredStrategy,
    _strategies: ScoredStrategy[],
    policy: DecisionPolicy
  ): string {
    const parts: string[] = [];

    parts.push(`Recommended: "${recommended.label}" with ${(recommended.confidence * 100).toFixed(0)}% confidence.`);

    if (policy === 'auto') {
      parts.push(`Policy: AUTO (confidence ${(recommended.confidence * 100).toFixed(0)}% >= ${(this.config.autoThreshold * 100).toFixed(0)}% threshold).`);
      parts.push('Strategy will be applied automatically without user interruption.');
    } else if (policy === 'enriched_hitl') {
      parts.push(`Policy: ENRICHED HITL (${(this.config.enrichedThreshold * 100).toFixed(0)}% <= confidence < ${(this.config.autoThreshold * 100).toFixed(0)}%).`);
      parts.push('User will be presented with ranked strategy options.');
    } else {
      parts.push(`Policy: SAFE FALLBACK (confidence ${(recommended.confidence * 100).toFixed(0)}% < ${(this.config.enrichedThreshold * 100).toFixed(0)}%).`);
      parts.push('Insufficient confidence. Using conservative defaults.');
    }

    if (recommended.dataPoints > 0) {
      parts.push(`Based on ${recommended.dataPoints} historical data points.`);
    } else {
      parts.push('Cold start: no historical data available.');
    }

    parts.push(`Attempt: ${signals.attempt}.`);

    return parts.join(' ');
  }

  private createSecurityFallbackResult(
    signals: PredictionSignals,
    strategies: ScoredStrategy[],
    recommended: ScoredStrategy
  ): PredictionResult {
    const abortStrategy = strategies.find(s => s.strategy === 'abort');

    return {
      signals,
      strategies,
      recommendedStrategyId: abortStrategy?.id || recommended.id,
      recommendedStrategy: abortStrategy || recommended,
      policy: this.config.allowAutoSecurityFailures ? 'auto' : 'safe_fallback',
      reasoning: `Security failure detected. ${this.config.allowAutoSecurityFailures ? 'Auto-aborting.' : 'Requires manual review.'}`,
      confidence: abortStrategy?.confidence || 0.9,
      timestamp: Date.now(),
    };
  }

  private createSafeFallbackResult(
    signals: PredictionSignals,
    reason: string
  ): PredictionResult {
    return {
      signals,
      strategies: [],
      recommendedStrategyId: '',
      recommendedStrategy: {
        id: 'unknown',
        label: 'Unknown',
        strategy: 'unknown',
        reasoning: reason,
        confidence: 0,
        riskLevel: 'high',
        dataPoints: 0,
        applied: false,
      },
      policy: 'safe_fallback',
      reasoning: `Safe fallback triggered: ${reason}`,
      confidence: 0,
      timestamp: Date.now(),
    };
  }

  getPolicyDescription(policy: DecisionPolicy): string {
    switch (policy) {
      case 'auto':
        return 'Auto-apply recommended strategy without user interruption.';
      case 'enriched_hitl':
        return 'Present ranked strategy options to user for selection.';
      case 'safe_fallback':
        return 'Apply conservative defaults; may prompt for clarification.';
      default:
        return 'Unknown policy.';
    }
  }

  shouldAutoApply(result: PredictionResult): boolean {
    return result.policy === 'auto';
  }

  shouldEnrichWithRecommendations(result: PredictionResult): boolean {
    return result.policy === 'enriched_hitl';
  }

  shouldUseSafeFallback(result: PredictionResult): boolean {
    return result.policy === 'safe_fallback';
  }

  getConfig(): PolicyRouterConfig {
    return { ...this.config };
  }
}

export function createPolicyRouter(
  profiler: HistoryProfiler,
  config?: Partial<PolicyRouterConfig>
): PolicyRouter {
  return new PolicyRouter(profiler, config);
}

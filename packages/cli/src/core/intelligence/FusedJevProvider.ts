import { randomUUID } from 'node:crypto';
import { ContextHasher } from './ContextHasher.js';
import { ContextSanitizer } from './ContextSanitizer.js';
import { DecisionFusionEngine } from './DecisionFusionEngine.js';
import { DecisionOutcomeStore } from './DecisionOutcomeStore.js';
import type { IntelligenceProviderRegistry } from './ProviderRegistry.js';
import type { DecisionContext, JevProvider, JevProviderResponse } from './types.js';
import type { FusionCandidate } from './DecisionFusionTypes.js';
import type { IntelligenceRequest, IntelligenceResponse } from './IntelligenceRuntimeTypes.js';

export class FusedJevProvider implements JevProvider {
  readonly id = 'fusion';
  private readonly sanitizer = new ContextSanitizer();

  constructor(
    private readonly registry: IntelligenceProviderRegistry,
    private readonly fusion = new DecisionFusionEngine(),
    private readonly outcomes = new DecisionOutcomeStore(),
  ) {}

  async decide(context: DecisionContext): Promise<JevProviderResponse> {
    const sanitized = this.sanitizer.sanitize(context);
    const contextHash = ContextHasher.hash(sanitized);
    const request: IntelligenceRequest<DecisionContext> = {
      requestId: randomUUID(),
      missionId: context.mission.id,
      type: 'STRATEGIC_DECISION',
      priority: 'HIGH',
      contextVersion: context.taskGraph.version,
      contextHash,
      context: sanitized,
      metadata: { fusion: true },
    };

    const candidates: FusionCandidate[] = [];
    for (const provider of this.registry.list()) {
      if (provider.id === 'fusion') continue;
      const capabilities = provider.capabilities();
      if (!capabilities.strategicDecision) continue;
      const health = await provider.health();
      if (health.status !== 'READY' && health.status !== 'DEGRADED') continue;
      try {
        const response = await provider.evaluate(request) as IntelligenceResponse<JevProviderResponse['decision']>;
        if (!response.result || (response.status !== 'SUCCESS' && response.status !== 'DEGRADED')) continue;
        candidates.push({
          source: this.sourceFor(provider.id),
          decision: response.result,
          confidence: response.confidence ?? response.result.confidence ?? 0,
          model: response.model,
          latencyMs: response.latencyMs,
          usage: response.usage,
          humanReviewProbability: this.humanReviewProbability(response.result),
        });
      } catch {
        // A provider failure is evidence of unavailability, not a reason to fail the mission.
      }
    }

    const result = this.fusion.fuse(sanitized, candidates, this.outcomes.list(context.mission.id));
    if (!result.decision) throw new Error(result.reasons.join('; ') || 'Decision fusion abstained.');
    return {
      decision: result.decision,
      provider: this.id,
      model: result.decision.fusion.candidates.map(candidate => candidate.model).filter(Boolean).join(',') || undefined,
      latencyMs: Math.max(...candidates.map(candidate => candidate.latencyMs ?? 0), 0),
      usage: this.sumUsage(candidates),
    };
  }

  private sourceFor(providerId: string): FusionCandidate['source'] {
    if (providerId.startsWith('laya')) return 'laya';
    if (providerId.startsWith('jev')) return 'jev';
    return 'deterministic';
  }

  private humanReviewProbability(decision: FusionCandidate['decision']): number {
    const condition = decision.conditions?.find(item => item.type === 'human_review_signal' && typeof item.probability === 'number');
    return typeof condition?.probability === 'number' ? condition.probability : 0;
  }

  private sumUsage(candidates: FusionCandidate[]) {
    return {
      inputTokens: candidates.reduce((sum, candidate) => sum + (candidate.usage?.inputTokens ?? 0), 0),
      outputTokens: candidates.reduce((sum, candidate) => sum + (candidate.usage?.outputTokens ?? 0), 0),
      totalTokens: candidates.reduce((sum, candidate) => sum + (candidate.usage?.totalTokens ?? 0), 0),
      costUsd: candidates.reduce((sum, candidate) => sum + (candidate.usage?.costUsd ?? 0), 0),
    };
  }
}

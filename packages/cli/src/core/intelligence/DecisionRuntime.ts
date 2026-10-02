import { createHash } from 'node:crypto';
import type { DecisionContext, DecisionEvaluation, DecisionRecord, DecisionTrigger, JevDecision, JevProvider, JevProviderResponse } from './types.js';
import { DecisionValidator } from './DecisionValidator.js';
import { ContextHasher } from './ContextHasher.js';

export class DecisionRuntime {
  constructor(
    private readonly provider: JevProvider,
    private readonly validator = new DecisionValidator(),
    private readonly maxRetries = 2,
    private readonly fallback?: JevProvider,
  ) {}

  async evaluate(context: DecisionContext, trigger: DecisionTrigger): Promise<{
    evaluation: DecisionEvaluation;
    record: DecisionRecord;
  }> {
    let response: JevProviderResponse | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        response = await this.provider.decide(context);
        break;
      } catch (error) {
        lastError = error;
        if (attempt === this.maxRetries) throw error;
      }
    }
    if (!response && this.fallback) {
      response = await this.fallback.decide(context);
    }
    if (!response) throw (lastError instanceof Error ? lastError : new Error('Jev provider returned no response'));
    let evaluation = this.validator.validate(response.decision, context);
    if (!evaluation.accepted && this.fallback && response.provider !== this.fallback.id) {
      const fallbackResponse = await this.fallback.decide(context);
      response = fallbackResponse;
      evaluation = this.validator.validate(response.decision, context);
    }
    const contextHash = ContextHasher.hash(context);

    const record: DecisionRecord = {
      decisionId: response.decision.decisionId,
      missionId: context.mission.id,
      trigger,
      contextVersion: context.taskGraph.version,
      contextHash,
      provider: response.provider,
      decision: response.decision,
      status: evaluation.accepted ? 'ACCEPTED' : 'REJECTED',
      rejectionReason: evaluation.accepted ? undefined : evaluation.reasons.join('; '),
      appliedActions: [],
      createdAt: new Date().toISOString(),
    };

    return { evaluation, record };
  }

  async decide(context: DecisionContext, trigger: DecisionTrigger): Promise<JevDecision> {
    const { evaluation } = await this.evaluate(context, trigger);
    if (!evaluation.accepted || !evaluation.decision) {
      throw new Error(`Jev decision rejected: ${evaluation.reasons.join('; ')}`);
    }
    return evaluation.decision;
  }
}

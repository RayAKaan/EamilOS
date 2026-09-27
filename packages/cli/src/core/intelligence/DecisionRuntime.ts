import { createHash } from 'node:crypto';
import type { DecisionContext, DecisionEvaluation, DecisionRecord, DecisionTrigger, JevDecision, JevProvider } from './types.js';
import { DecisionValidator } from './DecisionValidator.js';

export class DecisionRuntime {
  constructor(
    private readonly provider: JevProvider,
    private readonly validator = new DecisionValidator(),
  ) {}

  async evaluate(context: DecisionContext, trigger: DecisionTrigger): Promise<{
    evaluation: DecisionEvaluation;
    record: DecisionRecord;
  }> {
    const response = await this.provider.decide(context);
    const evaluation = this.validator.validate(response.decision, context);
    const contextHash = createHash('sha256')
      .update(JSON.stringify(context))
      .digest('hex');

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

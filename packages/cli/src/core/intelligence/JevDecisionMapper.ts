import type { DecisionContext, DecisionAction, JevDecision } from './types.js';
import type { JevSystemOneResponse } from './JevSystemOneTypes.js';

const ACTIONS = new Set<DecisionAction>(['DECOMPOSE','EXECUTE','REASSIGN','RETRY','PARALLELIZE','SEQUENCE','REPLAN','VERIFY','CONTINUE','COMPLETE','ESCALATE','ABORT']);

export interface JevDecisionMapping {
  decision: JevDecision;
  confidence: number;
  humanReviewProbability: number;
  model: string | undefined;
}

export class JevDecisionMapper {
  map(context: DecisionContext, contextHash: string, response: JevSystemOneResponse, targetTaskIds: string[], candidateAgentIds: string[]): JevDecisionMapping {
    const actionAnswer = response.answers.action;
    if (!actionAnswer || actionAnswer.type !== 'choice' || !ACTIONS.has(actionAnswer.choice as DecisionAction)) {
      throw new Error('Jev returned an invalid action choice.');
    }
    const action = actionAnswer.choice as DecisionAction;
    const targetAnswer = response.answers.target_task;
    const targetTaskId = targetAnswer?.type === 'choice' && targetTaskIds.includes(targetAnswer.choice) ? targetAnswer.choice : undefined;
    const agentAnswer = response.answers.agent;
    const agentId = agentAnswer?.type === 'choice' && candidateAgentIds.includes(agentAnswer.choice) ? agentAnswer.choice : undefined;
    const humanReview = response.answers.human_review;
    const humanReviewProbability = humanReview?.type === 'noul' ? humanReview.noul : 0;
    const confidence = actionAnswer.confidence ?? (actionAnswer.type === 'choice' ? Math.max(...Object.values(actionAnswer.probabilities), 0) : 0);
    const decision: JevDecision = {
      decisionId: 'jev_' + crypto.randomUUID(),
      missionId: context.mission.id,
      action,
      reasoning: 'Jev System One selected ' + action + ' from the bounded EamilOS action set.' + (humanReviewProbability >= 0.5 ? ' Human review was also indicated by the model signal.' : ''),
      targets: targetTaskId ? [{ taskId: targetTaskId, agentId }] : [],
      assignments: targetTaskId && agentId ? [{ taskId: targetTaskId, agentId, priority: 0 }] : undefined,
      confidence,
      expectedOutcome: 'Advance the mission while EamilOS deterministic validation and policy checks remain authoritative.',
      contextVersion: context.taskGraph.version,
      contextHash,
    };
    return { decision, confidence, humanReviewProbability, model: response.model };
  }
}

import { randomUUID } from 'node:crypto';
import { DecisionValidator } from './DecisionValidator.js';
import type { DecisionContext, DecisionAction, JevDecision } from './types.js';
import type { DecisionFusionEngineContract, FusionCandidate, FusionPolicy, FusionResult, FusionScore, HistoricalOutcome, FusedDecision } from './DecisionFusionTypes.js';

const DEFAULT_POLICY: FusionPolicy = {
  deterministicWeight: 1,
  jevWeight: 0.85,
  layaWeight: 0.65,
  agreementBonus: 0.15,
  disagreementPenalty: 0.1,
  historicalInfluence: 0.2,
  minimumConfidence: 0.55,
  humanReviewThreshold: 0.7,
  requireHumanReviewFor: [],
};

const ACTIONS: DecisionAction[] = ['DECOMPOSE','EXECUTE','REASSIGN','RETRY','PARALLELIZE','SEQUENCE','REPLAN','VERIFY','CONTINUE','COMPLETE','ESCALATE','ABORT'];

export class DecisionFusionEngine implements DecisionFusionEngineContract {
  constructor(
    private readonly validator = new DecisionValidator(),
    private readonly policy: FusionPolicy = DEFAULT_POLICY,
  ) {}

  fuse(context: DecisionContext, candidates: FusionCandidate[], history: HistoricalOutcome[] = []): FusionResult {
    const valid: FusionCandidate[] = [];
    const reasons: string[] = [];

    for (const candidate of candidates) {
      const evaluation = this.validator.validate(candidate.decision, context);
      if (!evaluation.accepted || evaluation.stale) {
        reasons.push(candidate.source + ' candidate rejected: ' + evaluation.reasons.join('; '));
        continue;
      }
      valid.push({
        ...candidate,
        confidence: this.clamp(candidate.confidence),
      });
    }

    if (valid.length === 0) {
      return { accepted: false, abstained: true, humanReviewRequired: true, reasons: reasons.length ? reasons : ['No valid intelligence candidate was available.'], scores: [] };
    }

    const scores = ACTIONS.map(action => this.scoreAction(action, valid, history))
      .filter(score => score.score > 0)
      .sort((a, b) => b.score - a.score || a.action.localeCompare(b.action));

    if (!scores.length) {
      return { accepted: false, abstained: true, humanReviewRequired: true, reasons: ['No action received usable support.'], scores: [] };
    }

    const total = scores.reduce((sum, item) => sum + item.score, 0);
    for (const item of scores) item.normalizedScore = total > 0 ? item.score / total : 0;
    const winner = scores[0];
    const disagreement = new Set(valid.map(candidate => candidate.decision.action)).size > 1;

    const topConfidence = winner.normalizedScore;
    const selected = this.selectRepresentative(winner.action, valid);
    const humanReviewSignal = Math.max(...valid.map(candidate => candidate.humanReviewProbability ?? 0), 0);
    const requiredByPolicy = this.policy.requireHumanReviewFor.includes(winner.action);
    const humanReviewRequired = requiredByPolicy || humanReviewSignal >= this.policy.humanReviewThreshold || topConfidence < this.policy.minimumConfidence;
    const abstained = topConfidence < this.policy.minimumConfidence;

    if (abstained) {
      return {
        accepted: false,
        abstained: true,
        humanReviewRequired: true,
        reasons: [...reasons, 'Fusion confidence is below the configured acceptance threshold.'],
        scores,
      };
    }

    const fused: FusedDecision = {
      ...selected.decision,
      decisionId: 'fusion_' + randomUUID(),
      confidence: topConfidence,
      conditions: [
        ...(selected.decision.conditions ?? []),
        { type: 'fusion_confidence', value: topConfidence },
        { type: 'fusion_human_review_required', value: humanReviewRequired },
        { type: 'fusion_disagreement', value: disagreement },
      ],
      fusion: {
        strategy: 'CONSTRAINT_FIRST_WEIGHTED_FUSION',
        candidates: valid,
        scores,
        selectedAction: winner.action,
        confidence: topConfidence,
        humanReviewRequired,
        abstained: false,
        historicalSamples: history.length,
        disagreement,
      },
    };

    if (humanReviewRequired && !requiredByPolicy && winner.action !== 'ESCALATE') {
      fused.action = 'ESCALATE';
      fused.reasoning = 'Fusion selected ' + winner.action + ', but uncertainty or review policy requires human review.';
      fused.targets = selected.decision.targets;
      fused.assignments = selected.decision.assignments;
    }

    return {
      decision: fused,
      accepted: true,
      abstained: false,
      humanReviewRequired,
      reasons,
      scores,
    };
  }

  private scoreAction(action: DecisionAction, candidates: FusionCandidate[], history: HistoricalOutcome[]): FusionScore {
    const supporting = candidates.filter(candidate => candidate.decision.action === action);
    if (!supporting.length) return { action, score: 0, normalizedScore: 0, support: [], hardConstraintValid: true, rationale: [] };

    let score = 0;
    const rationale: string[] = [];
    for (const candidate of supporting) {
      const base = this.baseWeight(candidate.source);
      const confidence = this.clamp(candidate.confidence);
      const historical = this.historyMultiplier(candidate, action, history);
      score += base * confidence * historical;
      rationale.push(candidate.source + ' confidence=' + confidence.toFixed(3));
    }

    const distinctSources = new Set(supporting.map(candidate => candidate.source)).size;
    if (distinctSources > 1) {
      score *= 1 + this.policy.agreementBonus;
      rationale.push('cross-provider agreement bonus');
    }

    const allSources = new Set(candidates.map(candidate => candidate.source));
    if (allSources.size > distinctSources && distinctSources === 1) {
      score *= 1 - this.policy.disagreementPenalty;
      rationale.push('provider disagreement penalty');
    }

    return {
      action,
      score,
      normalizedScore: 0,
      support: supporting.map(candidate => candidate.source),
      hardConstraintValid: true,
      rationale,
    };
  }

  private historyMultiplier(candidate: FusionCandidate, action: DecisionAction, history: HistoricalOutcome[]): number {
    const relevant = history.filter(item => item.action === action && (!item.source || item.source === candidate.source));
    if (!relevant.length) return 1;
    const success = relevant.filter(item => item.success).length / relevant.length;
    return 1 + this.policy.historicalInfluence * (success - 0.5) * 2;
  }

  private selectRepresentative(action: DecisionAction, candidates: FusionCandidate[]): FusionCandidate {
    return [...candidates]
      .filter(candidate => candidate.decision.action === action)
      .sort((a, b) => b.confidence - a.confidence || a.source.localeCompare(b.source))[0];
  }

  private baseWeight(source: FusionCandidate['source']): number {
    switch (source) {
      case 'deterministic': return this.policy.deterministicWeight;
      case 'jev': return this.policy.jevWeight;
      case 'laya': return this.policy.layaWeight;
      case 'historical': return 1;
    }
  }

  private clamp(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  }
}

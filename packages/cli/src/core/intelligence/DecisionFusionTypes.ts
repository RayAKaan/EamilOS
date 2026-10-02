import type { DecisionAction, JevDecision } from './types.js';

export type FusionSource = 'deterministic' | 'jev' | 'laya' | 'historical';

export interface FusionCandidate {
  source: FusionSource;
  decision: JevDecision;
  confidence: number;
  humanReviewProbability?: number;
  model?: string;
  latencyMs?: number;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; costUsd?: number };
}

export interface HistoricalOutcome {
  source?: FusionSource;
  action: DecisionAction;
  success: boolean;
  confidence?: number;
  timestamp: string;
}

export interface FusionPolicy {
  deterministicWeight: number;
  jevWeight: number;
  layaWeight: number;
  agreementBonus: number;
  disagreementPenalty: number;
  historicalInfluence: number;
  minimumConfidence: number;
  humanReviewThreshold: number;
  requireHumanReviewFor: DecisionAction[];
}

export interface FusionScore {
  action: DecisionAction;
  score: number;
  normalizedScore: number;
  support: FusionSource[];
  hardConstraintValid: boolean;
  rationale: string[];
}

export interface FusedDecision extends JevDecision {
  fusion: {
    strategy: 'CONSTRAINT_FIRST_WEIGHTED_FUSION';
    candidates: FusionCandidate[];
    scores: FusionScore[];
    selectedAction: DecisionAction;
    confidence: number;
    humanReviewRequired: boolean;
    abstained: boolean;
    historicalSamples: number;
    disagreement: boolean;
  };
}

export interface FusionResult {
  decision?: FusedDecision;
  accepted: boolean;
  abstained: boolean;
  humanReviewRequired: boolean;
  reasons: string[];
  scores: FusionScore[];
}

export interface DecisionFusionEngineContract {
  fuse(context: DecisionContext, candidates: FusionCandidate[], history?: HistoricalOutcome[]): FusionResult;
}

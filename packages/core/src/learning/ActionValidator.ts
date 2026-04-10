import type { Action } from './types.js';

export interface ActionValidation {
  actionId: string;
  action: Action;
  appliedAt: number;
  observationWindow: number;
  outcomes: ActionOutcome[];
  status: 'pending' | 'validated' | 'rejected' | 'rolled_back';
  impact: 'positive' | 'neutral' | 'negative' | 'unknown';
  confidence: number;
}

export interface ActionOutcome {
  timestamp: number;
  success: boolean;
  latencyMs: number;
  errorType?: string;
}

export interface ActionValidationConfig {
  observationWindow: number;
  improvementThreshold: number;
  degradationThreshold: number;
  minObservations: number;
  autoRollback: boolean;
  rollbackThreshold: number;
}

export const DEFAULT_VALIDATION_CONFIG: ActionValidationConfig = {
  observationWindow: 10,
  improvementThreshold: 0.1,
  degradationThreshold: 0.15,
  minObservations: 3,
  autoRollback: true,
  rollbackThreshold: 0.2,
};

export class ActionValidator {
  private config: ActionValidationConfig;
  private pendingValidations: Map<string, ActionValidation> = new Map();
  private completedValidations: ActionValidation[] = [];
  private actionHistory: Map<string, ActionHistory> = new Map();
  private readonly maxHistory = 500;

  constructor(config: Partial<ActionValidationConfig> = {}) {
    this.config = { ...DEFAULT_VALIDATION_CONFIG, ...config };
  }

  startValidation(action: Action): string {
    const actionId = `action_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const validation: ActionValidation = {
      actionId,
      action,
      appliedAt: Date.now(),
      observationWindow: this.config.observationWindow,
      outcomes: [],
      status: 'pending',
      impact: 'unknown',
      confidence: 0,
    };

    this.pendingValidations.set(actionId, validation);

    const history = this.getOrCreateHistory(action);
    history.appliedCount++;
    history.lastApplied = Date.now();

    return actionId;
  }

  recordOutcome(actionId: string, outcome: ActionOutcome): void {
    const validation = this.pendingValidations.get(actionId);
    if (!validation) {
      return;
    }

    validation.outcomes.push(outcome);

    if (validation.outcomes.length >= this.config.minObservations) {
      this.evaluateAction(validation);
    }
  }

  private evaluateAction(validation: ActionValidation): void {
    const outcomes = validation.outcomes;
    const successes = outcomes.filter(o => o.success).length;
    const successRate = successes / outcomes.length;

    const recentBaseline = this.getRecentBaseline();
    
    let impact: 'positive' | 'neutral' | 'negative';
    const improvement = successRate - recentBaseline;

    if (improvement >= this.config.improvementThreshold) {
      impact = 'positive';
      validation.status = 'validated';
    } else if (improvement <= -this.config.degradationThreshold) {
      impact = 'negative';
      validation.status = this.config.autoRollback ? 'rolled_back' : 'rejected';
    } else {
      impact = 'neutral';
      validation.status = 'validated';
    }

    validation.impact = impact;
    validation.confidence = Math.min(1, outcomes.length / this.config.observationWindow);

    this.completedValidations.push(validation);
    this.pendingValidations.delete(validation.actionId);

    if (this.completedValidations.length > this.maxHistory) {
      this.completedValidations.shift();
    }

    this.updateHistory(validation);
  }

  private getRecentBaseline(): number {
    const recentOutcomes = this.completedValidations
      .flatMap(v => v.outcomes)
      .slice(-50);

    if (recentOutcomes.length === 0) {
      return 0.5;
    }

    return recentOutcomes.filter(o => o.success).length / recentOutcomes.length;
  }

  private getOrCreateHistory(action: Action): ActionHistory {
    const key = this.getActionKey(action);
    if (!this.actionHistory.has(key)) {
      this.actionHistory.set(key, {
        actionKey: key,
        appliedCount: 0,
        validatedCount: 0,
        rejectedCount: 0,
        rolledBackCount: 0,
        avgImpact: 0,
        lastApplied: 0,
        historicalOutcomes: [],
      });
    }
    return this.actionHistory.get(key)!;
  }

  private updateHistory(validation: ActionValidation): void {
    const key = this.getActionKey(validation.action);
    const history = this.actionHistory.get(key);
    if (!history) return;

    history.historicalOutcomes.push(...validation.outcomes);
    if (history.historicalOutcomes.length > 100) {
      history.historicalOutcomes = history.historicalOutcomes.slice(-100);
    }

    switch (validation.status) {
      case 'validated':
        history.validatedCount++;
        break;
      case 'rejected':
        history.rejectedCount++;
        break;
      case 'rolled_back':
        history.rolledBackCount++;
        break;
    }

    const avgSuccess = history.historicalOutcomes.filter(o => o.success).length / history.historicalOutcomes.length;
    history.avgImpact = avgSuccess;
  }

  private getActionKey(action: Action): string {
    switch (action.type) {
      case 'avoid-model':
        return `avoid:${action.model}`;
      case 'adjust-timeout':
        return `timeout:${action.multiplier}`;
      case 'enrich-prompt':
        return `enrich:${action.enrichment}`;
      case 'switch-strategy':
        return `switch:${action.from}->${action.to}`;
      case 'add-agent-role':
        return `add-role:${action.role}`;
      default:
        return `alert:${action.type}`;
    }
  }

  shouldRollback(actionId: string): boolean {
    const validation = this.pendingValidations.get(actionId);
    if (!validation || validation.outcomes.length < this.config.minObservations) {
      return false;
    }

    const successes = validation.outcomes.filter(o => o.success).length;
    const recentBaseline = this.getRecentBaseline();
    const degradation = recentBaseline - (successes / validation.outcomes.length);

    return degradation >= this.config.rollbackThreshold;
  }

  getPendingValidations(): ActionValidation[] {
    return Array.from(this.pendingValidations.values());
  }

  getValidationHistory(): ActionValidation[] {
    return [...this.completedValidations];
  }

  getActionRecommendations(): ActionRecommendation[] {
    const recommendations: ActionRecommendation[] = [];

    for (const [key, history] of this.actionHistory) {
      if (history.appliedCount < 2) continue;

      const effectiveness = history.validatedCount / history.appliedCount;
      const recentOutcomes = history.historicalOutcomes.slice(-10);
      const recentImpact = recentOutcomes.length > 0
        ? recentOutcomes.filter(o => o.success).length / recentOutcomes.length
        : 0.5;

      recommendations.push({
        actionPattern: key,
        effectiveness,
        recentImpact,
        sampleSize: history.appliedCount,
        recommendation: this.getRecommendation(history),
      });
    }

    return recommendations.sort((a, b) => b.effectiveness - a.effectiveness);
  }

  private getRecommendation(history: ActionHistory): 'use' | 'caution' | 'avoid' {
    if (history.validatedCount > history.rejectedCount + history.rolledBackCount) {
      return 'use';
    } else if (history.rolledBackCount > history.validatedCount) {
      return 'avoid';
    }
    return 'caution';
  }

  clear(): void {
    this.pendingValidations.clear();
    this.completedValidations = [];
    this.actionHistory.clear();
  }
}

interface ActionHistory {
  actionKey: string;
  appliedCount: number;
  validatedCount: number;
  rejectedCount: number;
  rolledBackCount: number;
  avgImpact: number;
  lastApplied: number;
  historicalOutcomes: ActionOutcome[];
}

export interface ActionRecommendation {
  actionPattern: string;
  effectiveness: number;
  recentImpact: number;
  sampleSize: number;
  recommendation: 'use' | 'caution' | 'avoid';
}

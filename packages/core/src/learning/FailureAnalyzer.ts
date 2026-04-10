import type { ExecutionRecord, FailurePattern, ErrorType, Action, FailureReport } from './types.js';

export interface FailureAnalyzerConfig {
  minOccurrencesForPattern: number;
  correlationThreshold: number;
  decayFactorPerDay: number;
  maxPatternsTracked: number;
}

export const DEFAULT_FAILURE_ANALYZER_CONFIG: FailureAnalyzerConfig = {
  minOccurrencesForPattern: 3,
  correlationThreshold: 0.3,
  decayFactorPerDay: 0.9,
  maxPatternsTracked: 50,
};

export class FailureAnalyzer {
  private config: FailureAnalyzerConfig;
  private patterns: Map<string, FailurePattern> = new Map();
  private recentFailures: FailureInfo[] = [];
  private modelFailureCounts: Map<string, number> = new Map();
  private roleFailureCounts: Map<string, number> = new Map();
  private strategyFailureCounts: Map<string, number> = new Map();

  constructor(config: Partial<FailureAnalyzerConfig> = {}) {
    this.config = { ...DEFAULT_FAILURE_ANALYZER_CONFIG, ...config };
  }

  recordFailure(
    errorType: ErrorType,
    errorSignature: string,
    execution: ExecutionRecord
  ): void {
    const patternKey = this.getPatternKey(errorType, errorSignature);
    
    let pattern = this.patterns.get(patternKey);
    
    if (!pattern) {
      pattern = {
        id: patternKey,
        errorType,
        errorSignature,
        occurrenceCount: 0,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        frequency: 'rare',
        correlatedModels: new Map(),
        correlatedRoles: new Map(),
        correlatedTaskDomains: new Map(),
        correlatedStrategies: new Map(),
        rootCauseHypothesis: '',
        recommendedActions: [],
        status: 'active',
      };
      this.patterns.set(patternKey, pattern);
    }
    
    pattern.occurrenceCount++;
    pattern.lastSeen = Date.now();
    
    this.updateFrequency(pattern);
    this.updateCorrelations(pattern, execution);
    this.updateRootCauseHypothesis(pattern);
    this.updateRecommendedActions(pattern);
    
    this.recentFailures.push({
      timestamp: Date.now(),
      errorType,
      errorSignature,
      model: execution.modelsUsed[0] || 'unknown',
      role: execution.agentsUsed[0]?.role || 'unknown',
      strategy: execution.strategy,
    });
    
    if (this.recentFailures.length > 1000) {
      this.recentFailures.shift();
    }
    
    this.pruneOldPatterns();
  }

  private getPatternKey(errorType: ErrorType, errorSignature: string): string {
    return `${errorType}:${errorSignature.substring(0, 50)}`;
  }

  private updateFrequency(pattern: FailurePattern): void {
    const ageInDays = (Date.now() - pattern.firstSeen) / (24 * 60 * 60 * 1000);
    const rate = pattern.occurrenceCount / Math.max(1, ageInDays);
    
    if (rate < 0.1) {
      pattern.frequency = 'rare';
    } else if (rate < 1) {
      pattern.frequency = 'occasional';
    } else if (rate < 5) {
      pattern.frequency = 'frequent';
    } else {
      pattern.frequency = 'systematic';
    }
  }

  private updateCorrelations(pattern: FailurePattern, execution: ExecutionRecord): void {
    for (const model of execution.modelsUsed) {
      const count = pattern.correlatedModels.get(model) || 0;
      pattern.correlatedModels.set(model, count + 1);
      this.modelFailureCounts.set(model, (this.modelFailureCounts.get(model) || 0) + 1);
    }
    
    for (const agent of execution.agentsUsed) {
      const role = agent.role;
      const count = pattern.correlatedRoles.get(role) || 0;
      pattern.correlatedRoles.set(role, count + 1);
      this.roleFailureCounts.set(role, (this.roleFailureCounts.get(role) || 0) + 1);
    }
    
    for (const domain of execution.taskDomains) {
      const count = pattern.correlatedTaskDomains.get(domain as any) || 0;
      pattern.correlatedTaskDomains.set(domain as any, count + 1);
    }
    
    const strategyCount = pattern.correlatedStrategies.get(execution.strategy) || 0;
    pattern.correlatedStrategies.set(execution.strategy, strategyCount + 1);
    this.strategyFailureCounts.set(execution.strategy, (this.strategyFailureCounts.get(execution.strategy) || 0) + 1);
  }

  private updateRootCauseHypothesis(pattern: FailurePattern): void {
    let hypothesis = '';
    
    const topModel = this.getTopCorrelated(pattern.correlatedModels);
    const topRole = this.getTopCorrelated(pattern.correlatedRoles);
    
    if (topModel && topRole) {
      hypothesis = `Likely caused by ${topModel} model with ${topRole} role: `;
    } else if (topModel) {
      hypothesis = `Likely related to ${topModel} model performance: `;
    } else if (topRole) {
      hypothesis = `Likely related to ${topRole} agent role: `;
    } else {
      hypothesis = 'Potential causes: ';
    }
    
    hypothesis += this.generateRootCauseDescription(pattern);
    
    pattern.rootCauseHypothesis = hypothesis;
  }

  private generateRootCauseDescription(pattern: FailurePattern): string {
    const parts: string[] = [];
    
    switch (pattern.errorType) {
      case 'timeout':
        parts.push('Model taking too long to respond');
        break;
      case 'rate_limit':
        parts.push('API rate limit exceeded');
        break;
      case 'context_overflow':
        parts.push('Context window exceeded');
        break;
      case 'invalid_output':
        parts.push('Model producing malformed output');
        break;
      case 'api_error':
        parts.push('External API failure');
        break;
      case 'rate_limit':
        parts.push('API rate limit exceeded');
        break;
      default:
        parts.push('Unexpected error condition');
    }
    
    if (pattern.frequency === 'systematic') {
      parts.push('occurring consistently across multiple executions');
    } else if (pattern.frequency === 'frequent') {
      parts.push('happening regularly');
    }
    
    return parts.join(', ');
  }

  private updateRecommendedActions(pattern: FailurePattern): void {
    const actions: Action[] = [];
    
    const topModel = this.getTopCorrelated(pattern.correlatedModels);
    const topStrategy = this.getTopCorrelated(pattern.correlatedStrategies);
    
    if (topModel && pattern.occurrenceCount >= 5) {
      actions.push({
        type: 'avoid-model',
        model: topModel,
        duration: 3600000,
        reason: `Model associated with ${pattern.occurrenceCount} failures`,
      });
    }
    
    if (topStrategy && pattern.occurrenceCount >= 3) {
      const strategies = Array.from(pattern.correlatedStrategies.keys());
      const fallbackStrategy = strategies.find(s => s !== topStrategy) || 'sequential';
      
      actions.push({
        type: 'switch-strategy',
        from: topStrategy,
        to: fallbackStrategy,
        reason: `Strategy ${topStrategy} correlated with failures`,
      });
    }
    
    if (pattern.errorType === 'timeout') {
      actions.push({
        type: 'adjust-timeout',
        multiplier: 1.5,
        reason: 'Increase timeout to handle slow responses',
      });
    }
    
    if (pattern.frequency === 'systematic') {
      actions.push({
        type: 'alert-operator',
        message: `Systematic failure detected: ${pattern.errorSignature}`,
        severity: 'critical',
      });
    }
    
    pattern.recommendedActions = actions;
  }

  private getTopCorrelated<T>(correlations: Map<T, number>): T | null {
    let topKey: T | null = null;
    let topCount = 0;
    
    for (const [key, count] of correlations) {
      if (count > topCount) {
        topCount = count;
        topKey = key;
      }
    }
    
    return topKey;
  }

  analyzeCorrelations(execution1: ExecutionRecord, execution2: ExecutionRecord): {
    hasSignificantCorrelation: boolean;
    correlationFactors: string[];
    correlationScore: number;
  } {
    const factors: string[] = [];
    let correlationScore = 0;
    
    const sharedModels = execution1.modelsUsed.filter(m => execution2.modelsUsed.includes(m));
    if (sharedModels.length > 0) {
      factors.push(`Shared models: ${sharedModels.join(', ')}`);
      correlationScore += 0.3;
    }
    
    const sharedStrategies = execution1.strategy === execution2.strategy;
    if (sharedStrategies) {
      factors.push(`Shared strategy: ${execution1.strategy}`);
      correlationScore += 0.2;
    }
    
    const sharedDomains = execution1.taskDomains.filter(d => execution2.taskDomains.includes(d));
    if (sharedDomains.length > 0) {
      factors.push(`Shared domains: ${sharedDomains.join(', ')}`);
      correlationScore += 0.1;
    }
    
    const latencyDiff = Math.abs(execution1.totalLatencyMs - execution2.totalLatencyMs);
    if (latencyDiff < 10000) {
      factors.push('Similar latency profiles');
      correlationScore += 0.1;
    }
    
    const hasSignificantCorrelation = correlationScore >= this.config.correlationThreshold;
    
    return { hasSignificantCorrelation, correlationFactors: factors, correlationScore };
  }

  getPattern(patternId: string): FailurePattern | null {
    return this.patterns.get(patternId) || null;
  }

  getAllPatterns(): FailurePattern[] {
    return Array.from(this.patterns.values());
  }

  getActivePatterns(): FailurePattern[] {
    return this.getAllPatterns().filter(p => p.status === 'active');
  }

  getPatternsByFrequency(frequency: 'rare' | 'occasional' | 'frequent' | 'systematic'): FailurePattern[] {
    return this.getAllPatterns().filter(p => p.frequency === frequency);
  }

  getSystematicPatterns(): FailurePattern[] {
    return this.getPatternsByFrequency('systematic');
  }

  getFrequentPatterns(): FailurePattern[] {
    return this.getPatternsByFrequency('frequent');
  }

  getReport(): FailureReport {
    const patterns = this.getAllPatterns();
    const activePatterns = patterns.filter(p => p.status === 'active');
    
    const topModels = Array.from(this.modelFailureCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([model, count]) => ({ model, count }));
    
    const allActions: Action[] = [];
    for (const pattern of activePatterns) {
      allActions.push(...pattern.recommendedActions);
    }
    
    const deduplicatedActions = this.deduplicateActions(allActions);
    
    return {
      totalPatternsDetected: patterns.length,
      activePatternsCount: activePatterns.length,
      systematicPatterns: this.getSystematicPatterns(),
      frequentPatterns: this.getFrequentPatterns(),
      topModelsWithFailures: topModels,
      recommendations: deduplicatedActions,
    };
  }

  private deduplicateActions(actions: Action[]): Action[] {
    const seen = new Set<string>();
    const deduplicated: Action[] = [];
    
    for (const action of actions) {
      const key = JSON.stringify(action);
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(action);
      }
    }
    
    return deduplicated.slice(0, 10);
  }

  resolvePattern(patternId: string, resolution: string): void {
    const pattern = this.patterns.get(patternId);
    if (pattern) {
      pattern.status = 'resolved';
      pattern.mitigationApplied = resolution;
    }
  }

  mitigatePattern(patternId: string, mitigation: string): void {
    const pattern = this.patterns.get(patternId);
    if (pattern) {
      pattern.status = 'mitigated';
      pattern.mitigationApplied = mitigation;
    }
  }

  private pruneOldPatterns(): void {
    if (this.patterns.size <= this.config.maxPatternsTracked) return;
    
    const patternsArray = Array.from(this.patterns.entries());
    patternsArray.sort((a, b) => {
      const ageDiff = a[1].lastSeen - b[1].lastSeen;
      if (Math.abs(ageDiff) > 1000) return ageDiff;
      return b[1].occurrenceCount - a[1].occurrenceCount;
    });
    
    const toRemove = patternsArray.slice(this.config.maxPatternsTracked);
    for (const [key] of toRemove) {
      this.patterns.delete(key);
    }
  }

  decayPatterns(): void {
    for (const pattern of this.patterns.values()) {
      const daysSinceLastSeen = (Date.now() - pattern.lastSeen) / (24 * 60 * 60 * 1000);
      
      if (daysSinceLastSeen > 7) {
        if (pattern.status === 'active') {
          pattern.status = 'mitigated';
        }
      }
    }
  }

  getFailureTrend(timeWindowMs: number): {
    total: number;
    byErrorType: Record<ErrorType, number>;
    trend: 'increasing' | 'stable' | 'decreasing';
  } {
    const cutoff = Date.now() - timeWindowMs;
    const recent = this.recentFailures.filter(f => f.timestamp >= cutoff);
    
    const byErrorType: Record<ErrorType, number> = {
      timeout: 0,
      rate_limit: 0,
      context_overflow: 0,
      invalid_output: 0,
      validation_failure: 0,
      api_error: 0,
      unknown: 0,
    };
    
    for (const failure of recent) {
      byErrorType[failure.errorType] = (byErrorType[failure.errorType] || 0) + 1;
    }
    
    const now = Date.now();
    const halfWindow = timeWindowMs / 2;
    const recentHalf = recent.filter(f => f.timestamp >= now - halfWindow);
    const olderHalf = recent.filter(f => f.timestamp < now - halfWindow);
    
    let trend: 'increasing' | 'stable' | 'decreasing' = 'stable';
    if (recentHalf.length > olderHalf.length * 1.5) {
      trend = 'increasing';
    } else if (recentHalf.length < olderHalf.length * 0.5) {
      trend = 'decreasing';
    }
    
    return {
      total: recent.length,
      byErrorType,
      trend,
    };
  }

  getStatistics(): {
    totalPatterns: number;
    activePatterns: number;
    systematicPatterns: number;
    frequentPatterns: number;
    totalFailuresRecorded: number;
  } {
    const patterns = this.getAllPatterns();
    
    return {
      totalPatterns: patterns.length,
      activePatterns: patterns.filter(p => p.status === 'active').length,
      systematicPatterns: patterns.filter(p => p.frequency === 'systematic').length,
      frequentPatterns: patterns.filter(p => p.frequency === 'frequent').length,
      totalFailuresRecorded: this.recentFailures.length,
    };
  }
}

interface FailureInfo {
  timestamp: number;
  errorType: ErrorType;
  errorSignature: string;
  model: string;
  role: string;
  strategy: string;
}

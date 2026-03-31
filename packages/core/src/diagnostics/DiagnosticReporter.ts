import { ErrorClassifier, ErrorCategory, ErrorSeverity, type ClassifiedError } from './ErrorClassifier.js';
import { ErrorMemory, type ErrorRecord, type ErrorMemoryStats } from './ErrorMemory.js';
import { SecureLogger } from '../security/SecureLogger.js';

export interface DiagnosticReport {
  id: string;
  timestamp: string;
  summary: {
    totalErrors: number;
    criticalIssues: number;
    highPriorityIssues: number;
    recommendations: string[];
  };
  errorDistribution: {
    byCategory: Record<ErrorCategory, number>;
    bySeverity: Record<ErrorSeverity, number>;
  };
  recentErrors: ErrorRecord[];
  patterns: DiagnosticPattern[];
  healthScore: number;
}

export interface DiagnosticPattern {
  pattern: string;
  frequency: number;
  category: ErrorCategory;
  impact: 'low' | 'medium' | 'high';
  description: string;
  mitigation: string;
}

export class DiagnosticReporter {
  private classifier: ErrorClassifier;
  private memory: ErrorMemory;
  private logger: SecureLogger;

  constructor(logger: SecureLogger) {
    this.classifier = new ErrorClassifier();
    this.memory = new ErrorMemory();
    this.logger = logger;
  }

  recordAndClassify(error: Error | string, context?: Record<string, any>): ClassifiedError {
    const classified = this.classifier.classify(error, context);
    this.memory.record(error, classified);

    this.logger.debug(`Error recorded: ${classified.category} (${classified.severity})`);

    return classified;
  }

  generateReport(): DiagnosticReport {
    const stats = this.memory.getStats();
    const recentErrors = this.memory.getRecentErrors(20);
    const patterns = this.detectPatterns(recentErrors);
    const healthScore = this.calculateHealthScore(stats);

    return {
      id: this.generateReportId(),
      timestamp: new Date().toISOString(),
      summary: {
        totalErrors: stats.totalErrors,
        criticalIssues: stats.errorsBySeverity[ErrorSeverity.CRITICAL] || 0,
        highPriorityIssues: stats.errorsBySeverity[ErrorSeverity.HIGH] || 0,
        recommendations: this.generateRecommendations(stats, patterns),
      },
      errorDistribution: {
        byCategory: stats.errorsByCategory,
        bySeverity: stats.errorsBySeverity,
      },
      recentErrors,
      patterns,
      healthScore,
    };
  }

  getClassifier(): ErrorClassifier {
    return this.classifier;
  }

  getMemory(): ErrorMemory {
    return this.memory;
  }

  private detectPatterns(errors: ErrorRecord[]): DiagnosticPattern[] {
    const patterns: DiagnosticPattern[] = [];
    const categoryGroups = new Map<ErrorCategory, ErrorRecord[]>();

    for (const error of errors) {
      if (!categoryGroups.has(error.category)) {
        categoryGroups.set(error.category, []);
      }
      categoryGroups.get(error.category)!.push(error);
    }

    for (const [category, categoryErrors] of categoryGroups) {
      if (categoryErrors.length >= 3) {
        patterns.push({
          pattern: `Multiple ${category} errors`,
          frequency: categoryErrors.length,
          category,
          impact: this.getImpactFromCategory(category, categoryErrors.length),
          description: `${categoryErrors.length} ${category} errors detected in recent history`,
          mitigation: this.getMitigation(category),
        });
      }

      const rapidErrors = this.detectRapidErrors(categoryErrors);
      if (rapidErrors) {
        patterns.push(rapidErrors);
      }
    }

    return patterns;
  }

  private detectRapidErrors(errors: ErrorRecord[]): DiagnosticPattern | null {
    if (errors.length < 3) return null;

    const timestamps = errors.map(e => new Date(e.timestamp).getTime()).sort((a, b) => a - b);
    const intervals: number[] = [];

    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const rapidThreshold = 5000;

    if (avgInterval < rapidThreshold) {
      return {
        pattern: 'Rapid error bursts',
        frequency: errors.length,
        category: errors[0].category,
        impact: 'high',
        description: `${errors.length} errors occurring within ${Math.round(avgInterval / 1000)}s average intervals`,
        mitigation: 'Consider circuit breaker pattern or request throttling',
      };
    }

    return null;
  }

  private getImpactFromCategory(category: ErrorCategory, count: number): 'low' | 'medium' | 'high' {
    const highImpactCategories = [
      ErrorCategory.SYSTEM_ERROR,
      ErrorCategory.AUTH_ERROR,
    ];

    if (highImpactCategories.includes(category) || count > 5) {
      return 'high';
    }
    if (count > 2) {
      return 'medium';
    }
    return 'low';
  }

  private getMitigation(category: ErrorCategory): string {
    switch (category) {
      case ErrorCategory.PARSE_ERROR:
        return 'Review prompt templates and response parsing logic';
      case ErrorCategory.MODEL_ERROR:
        return 'Consider model fallback or degraded mode';
      case ErrorCategory.NETWORK_ERROR:
        return 'Check network stability and implement retries';
      case ErrorCategory.RATE_LIMIT_ERROR:
        return 'Implement request queuing with backoff';
      case ErrorCategory.TIMEOUT_ERROR:
        return 'Increase timeout limits or reduce request size';
      default:
        return 'Monitor and investigate root cause';
    }
  }

  private generateRecommendations(stats: ErrorMemoryStats, patterns: DiagnosticPattern[]): string[] {
    const recommendations: string[] = [];

    if (stats.errorsBySeverity[ErrorSeverity.CRITICAL] > 0) {
      recommendations.push('URGENT: Address critical system errors immediately');
    }

    if (stats.recentErrorRate > 0.5) {
      recommendations.push('High error rate detected - consider enabling circuit breaker');
    }

    if (stats.errorsByCategory[ErrorCategory.RATE_LIMIT_ERROR] > 5) {
      recommendations.push('Rate limiting issues - implement request batching and caching');
    }

    if (stats.errorsByCategory[ErrorCategory.PARSE_ERROR] > 3) {
      recommendations.push('Multiple parsing failures - review response format expectations');
    }

    const highImpactPatterns = patterns.filter(p => p.impact === 'high');
    if (highImpactPatterns.length > 0) {
      recommendations.push(`Focus on ${highImpactPatterns.length} high-impact error patterns`);
    }

    if (recommendations.length === 0) {
      recommendations.push('System operating normally - continue monitoring');
    }

    return recommendations;
  }

  private calculateHealthScore(stats: ErrorMemoryStats): number {
    let score = 100;

    const criticalDeduction = (stats.errorsBySeverity[ErrorSeverity.CRITICAL] || 0) * 20;
    const highDeduction = (stats.errorsBySeverity[ErrorSeverity.HIGH] || 0) * 10;
    const mediumDeduction = (stats.errorsBySeverity[ErrorSeverity.MEDIUM] || 0) * 3;
    const lowDeduction = (stats.errorsBySeverity[ErrorSeverity.LOW] || 0) * 1;

    score -= Math.min(criticalDeduction, 40);
    score -= Math.min(highDeduction, 30);
    score -= Math.min(mediumDeduction, 20);
    score -= Math.min(lowDeduction, 10);

    if (stats.recentErrorRate > 1) {
      score -= 20;
    }

    return Math.max(0, Math.min(100, score));
  }

  private generateReportId(): string {
    return `diag_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

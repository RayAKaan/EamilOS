import type { ClassifiedError, ErrorCategory, ErrorSeverity } from './ErrorClassifier.js';

export interface ErrorRecord {
  id: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  stack?: string;
  timestamp: string;
  context: Record<string, any>;
  count: number;
  resolved: boolean;
  resolution?: string;
}

export interface ErrorMemoryStats {
  totalErrors: number;
  errorsByCategory: Record<ErrorCategory, number>;
  errorsBySeverity: Record<ErrorSeverity, number>;
  recentErrorRate: number;
  uniqueErrors: number;
  resolvedErrors: number;
}

export class ErrorMemory {
  private errors: Map<string, ErrorRecord> = new Map();
  private recentTimestamps: string[] = [];
  private maxRecentWindow: number = 1000 * 60 * 5; // 5 minutes
  private maxStoredErrors: number = 1000;

  record(error: Error | string, classified: ClassifiedError): string {
    const errorId = this.generateErrorId(classified.category, classified.context);
    const existing = this.errors.get(errorId);

    if (existing) {
      existing.count++;
      existing.timestamp = new Date().toISOString();
      return errorId;
    }

    const record: ErrorRecord = {
      id: errorId,
      category: classified.category,
      severity: classified.severity,
      message: classified.context.errorMessage || String(error),
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
      context: classified.context,
      count: 1,
      resolved: false,
    };

    this.errors.set(errorId, record);
    this.recentTimestamps.push(record.timestamp);
    this.cleanupOldTimestamps();

    if (this.errors.size > this.maxStoredErrors) {
      this.evictOldestErrors();
    }

    return errorId;
  }

  getError(id: string): ErrorRecord | undefined {
    return this.errors.get(id);
  }

  getErrorsByCategory(category: ErrorCategory): ErrorRecord[] {
    return Array.from(this.errors.values()).filter(e => e.category === category);
  }

  getErrorsBySeverity(severity: ErrorSeverity): ErrorRecord[] {
    return Array.from(this.errors.values()).filter(e => e.severity === severity);
  }

  getRecentErrors(limit: number = 10): ErrorRecord[] {
    return Array.from(this.errors.values())
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  resolveError(id: string, resolution: string): boolean {
    const error = this.errors.get(id);
    if (error) {
      error.resolved = true;
      error.resolution = resolution;
      return true;
    }
    return false;
  }

  getStats(): ErrorMemoryStats {
    const errors = Array.from(this.errors.values());
    const now = Date.now();

    const recentErrors = this.recentTimestamps.filter(ts => {
      const time = new Date(ts).getTime();
      return now - time < this.maxRecentWindow;
    });

    const errorsByCategory = {} as Record<ErrorCategory, number>;
    const errorsBySeverity = {} as Record<ErrorSeverity, number>;

    for (const error of errors) {
      errorsByCategory[error.category] = (errorsByCategory[error.category] || 0) + 1;
      errorsBySeverity[error.severity] = (errorsBySeverity[error.severity] || 0) + 1;
    }

    return {
      totalErrors: errors.reduce((sum, e) => sum + e.count, 0),
      errorsByCategory,
      errorsBySeverity,
      recentErrorRate: recentErrors.length / (this.maxRecentWindow / 1000),
      uniqueErrors: this.errors.size,
      resolvedErrors: errors.filter(e => e.resolved).length,
    };
  }

  clear(): void {
    this.errors.clear();
    this.recentTimestamps = [];
  }

  private generateErrorId(category: ErrorCategory, context: Record<string, any>): string {
    const key = `${category}:${context.errorMessage || ''}`;
    return this.hashString(key);
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  private cleanupOldTimestamps(): void {
    const cutoff = Date.now() - this.maxRecentWindow;
    this.recentTimestamps = this.recentTimestamps.filter(ts => {
      return new Date(ts).getTime() > cutoff;
    });
  }

  private evictOldestErrors(): void {
    const sortedErrors = Array.from(this.errors.entries())
      .sort((a, b) => new Date(a[1].timestamp).getTime() - new Date(b[1].timestamp).getTime());

    const toEvict = Math.floor(this.maxStoredErrors * 0.1);
    for (let i = 0; i < toEvict && i < sortedErrors.length; i++) {
      this.errors.delete(sortedErrors[i][0]);
    }
  }
}

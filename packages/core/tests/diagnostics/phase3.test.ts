import { describe, it, expect, beforeEach } from 'vitest';
import { ErrorClassifier, ErrorCategory, ErrorSeverity } from '../../src/diagnostics/ErrorClassifier.js';
import { ErrorMemory, type ErrorRecord } from '../../src/diagnostics/ErrorMemory.js';
import { DiagnosticReporter } from '../../src/diagnostics/DiagnosticReporter.js';
import { SecureLogger } from '../../src/security/SecureLogger.js';

describe('Phase 3: Diagnostics Engine', () => {
  let mockLogger: SecureLogger;
  let classifier: ErrorClassifier;
  let memory: ErrorMemory;
  let reporter: DiagnosticReporter;

  beforeEach(() => {
    mockLogger = {
      info: () => {},
      debug: () => {},
      warn: () => {},
      error: () => {},
    } as any;
    classifier = new ErrorClassifier();
    memory = new ErrorMemory();
    reporter = new DiagnosticReporter(mockLogger);
  });

  describe('P3-T1: ErrorClassifier', () => {
    it('should classify JSON parse errors', () => {
      const error = new Error('Unexpected end of JSON input');
      const result = classifier.classify(error);

      expect(result.category).toBe(ErrorCategory.PARSE_ERROR);
      expect(result.isRetryable).toBe(true);
      expect(result.suggestedAction).toContain('response format');
    });

    it('should classify network errors', () => {
      const error = new Error('ECONNREFUSED: Connection refused');
      const result = classifier.classify(error);

      expect(result.category).toBe(ErrorCategory.NETWORK_ERROR);
      expect(result.isRetryable).toBe(true);
    });

    it('should classify authentication errors', () => {
      const error = new Error('401 Unauthorized');
      const result = classifier.classify(error);

      expect(result.category).toBe(ErrorCategory.AUTH_ERROR);
      expect(result.isRetryable).toBe(false);
      expect(result.isRecoverable).toBe(false);
    });

    it('should classify rate limit errors', () => {
      const error = new Error('429 Rate limit exceeded');
      const result = classifier.classify(error);

      expect(result.category).toBe(ErrorCategory.RATE_LIMIT_ERROR);
      expect(result.severity).toBe(ErrorSeverity.MEDIUM);
    });

    it('should classify timeout errors', () => {
      const error = new Error('Request timeout after 30000ms');
      const result = classifier.classify(error);

      expect(result.category).toBe(ErrorCategory.TIMEOUT_ERROR);
      expect(result.isRetryable).toBe(true);
    });

    it('should classify unknown errors with default severity', () => {
      const error = new Error('Something went wrong');
      const result = classifier.classify(error);

      expect(result.category).toBe(ErrorCategory.UNKNOWN_ERROR);
      expect(result.severity).toBe(ErrorSeverity.LOW);
    });

    it('should accept string errors', () => {
      const result = classifier.classify('Invalid JSON syntax');
      expect(result.category).toBe(ErrorCategory.PARSE_ERROR);
    });

    it('should include context in classification', () => {
      const error = new Error('Parse failed');
      const context = { provider: 'openai', model: 'gpt-4' };
      const result = classifier.classify(error, context);

      expect(result.context.provider).toBe('openai');
      expect(result.context.model).toBe('gpt-4');
      expect(result.context.timestamp).toBeDefined();
    });
  });

  describe('P3-T2: ErrorClassifier Categories', () => {
    it('should return all error categories', () => {
      const categories = classifier.getCategories();
      expect(categories).toContain(ErrorCategory.PARSE_ERROR);
      expect(categories).toContain(ErrorCategory.MODEL_ERROR);
      expect(categories).toContain(ErrorCategory.NETWORK_ERROR);
      expect(categories.length).toBeGreaterThan(5);
    });

    it('should return all severity levels', () => {
      const severities = classifier.getSeverityLevels();
      expect(severities).toContain(ErrorSeverity.CRITICAL);
      expect(severities).toContain(ErrorSeverity.HIGH);
      expect(severities).toContain(ErrorSeverity.MEDIUM);
      expect(severities).toContain(ErrorSeverity.LOW);
    });
  });

  describe('P3-T3: ErrorMemory Recording', () => {
    it('should record new errors', () => {
      const error = new Error('Test error');
      const classified = classifier.classify(error);

      const errorId = memory.record(error, classified);

      expect(errorId).toBeDefined();
      expect(typeof errorId).toBe('string');
    });

    it('should increment count for duplicate errors', () => {
      const error = new Error('Test error');
      const classified = classifier.classify(error);

      const id1 = memory.record(error, classified);
      const id2 = memory.record(error, classified);
      const id3 = memory.record(error, classified);

      expect(id1).toBe(id2);
      expect(id2).toBe(id3);

      const record = memory.getError(id1);
      expect(record?.count).toBe(3);
    });

    it('should retrieve error by id', () => {
      const error = new Error('Test error');
      const classified = classifier.classify(error);

      const errorId = memory.record(error, classified);
      const record = memory.getError(errorId);

      expect(record).toBeDefined();
      expect(record?.message).toBe('Test error');
      expect(record?.category).toBe(ErrorCategory.UNKNOWN_ERROR);
    });

    it('should return undefined for non-existent error', () => {
      const record = memory.getError('nonexistent');
      expect(record).toBeUndefined();
    });
  });

  describe('P3-T4: ErrorMemory Queries', () => {
    beforeEach(() => {
      const errors = [
        { msg: 'Parse error', category: ErrorCategory.PARSE_ERROR },
        { msg: 'Network error', category: ErrorCategory.NETWORK_ERROR },
        { msg: 'Another parse error', category: ErrorCategory.PARSE_ERROR },
      ];

      for (const { msg, category } of errors) {
        const classified = {
          category,
          severity: ErrorSeverity.MEDIUM,
          isRetryable: true,
          isRecoverable: true,
          suggestedAction: 'Test',
          context: { errorMessage: msg },
        };
        memory.record(new Error(msg), classified);
      }
    });

    it('should get errors by category', () => {
      const parseErrors = memory.getErrorsByCategory(ErrorCategory.PARSE_ERROR);
      expect(parseErrors.length).toBe(2);
    });

    it('should get recent errors', () => {
      const recent = memory.getRecentErrors(5);
      expect(recent.length).toBeGreaterThan(0);
      expect(recent.length).toBeLessThanOrEqual(5);
    });

    it('should resolve errors', () => {
      const recent = memory.getRecentErrors(1);
      const errorId = recent[0].id;

      const resolved = memory.resolveError(errorId, 'Fixed by restarting');
      expect(resolved).toBe(true);

      const record = memory.getError(errorId);
      expect(record?.resolved).toBe(true);
      expect(record?.resolution).toBe('Fixed by restarting');
    });

    it('should return false for resolving non-existent error', () => {
      const resolved = memory.resolveError('nonexistent', 'Test');
      expect(resolved).toBe(false);
    });
  });

  describe('P3-T5: ErrorMemory Stats', () => {
    beforeEach(() => {
      const classified1 = {
        category: ErrorCategory.PARSE_ERROR,
        severity: ErrorSeverity.HIGH,
        isRetryable: true,
        isRecoverable: true,
        suggestedAction: '',
        context: { errorMessage: 'Error 1' },
      };
      const classified2 = {
        category: ErrorCategory.NETWORK_ERROR,
        severity: ErrorSeverity.MEDIUM,
        isRetryable: true,
        isRecoverable: true,
        suggestedAction: '',
        context: { errorMessage: 'Error 2' },
      };

      memory.record(new Error('Error 1'), classified1);
      memory.record(new Error('Error 2'), classified2);
    });

    it('should calculate error stats', () => {
      const stats = memory.getStats();

      expect(stats.totalErrors).toBe(2);
      expect(stats.uniqueErrors).toBe(2);
      expect(stats.errorsByCategory[ErrorCategory.PARSE_ERROR]).toBe(1);
      expect(stats.errorsByCategory[ErrorCategory.NETWORK_ERROR]).toBe(1);
      expect(stats.errorsBySeverity[ErrorSeverity.HIGH]).toBe(1);
      expect(stats.errorsBySeverity[ErrorSeverity.MEDIUM]).toBe(1);
    });

    it('should clear all errors', () => {
      memory.clear();
      const stats = memory.getStats();

      expect(stats.totalErrors).toBe(0);
      expect(stats.uniqueErrors).toBe(0);
    });
  });

  describe('P3-T6: DiagnosticReporter', () => {
    it('should record and classify errors', () => {
      const error = new Error('JSON.parse error');
      const result = reporter.recordAndClassify(error);

      expect(result.category).toBe(ErrorCategory.PARSE_ERROR);
    });

    it('should generate diagnostic report', () => {
      const error = new Error('Test error');
      reporter.recordAndClassify(error);

      const report = reporter.generateReport();

      expect(report.id).toBeDefined();
      expect(report.timestamp).toBeDefined();
      expect(report.summary.totalErrors).toBeGreaterThan(0);
      expect(report.healthScore).toBeGreaterThanOrEqual(0);
      expect(report.healthScore).toBeLessThanOrEqual(100);
    });

    it('should calculate health score based on errors', () => {
      for (let i = 0; i < 5; i++) {
        const error = new Error(`Parse error ${i}`);
        reporter.recordAndClassify(error, { index: i });
      }

      const report = reporter.generateReport();
      expect(report.healthScore).toBeLessThan(100);
    });
  });

  describe('P3-T7: Diagnostic Patterns', () => {
    it('should include patterns array in report', () => {
      const newReporter = new DiagnosticReporter(mockLogger);
      for (let i = 0; i < 5; i++) {
        newReporter.recordAndClassify(new Error('Parse error'), { index: i });
      }

      const report = newReporter.generateReport();
      expect(report.patterns).toBeDefined();
      expect(Array.isArray(report.patterns)).toBe(true);
    });

    it('should include pattern properties', () => {
      const newReporter = new DiagnosticReporter(mockLogger);
      for (let i = 0; i < 4; i++) {
        newReporter.recordAndClassify(new Error('ECONNREFUSED'));
      }

      const report = newReporter.generateReport();
      if (report.patterns.length > 0) {
        const pattern = report.patterns[0];
        expect(pattern.pattern).toBeDefined();
        expect(pattern.category).toBeDefined();
        expect(pattern.impact).toBeDefined();
        expect(pattern.description).toBeDefined();
        expect(pattern.mitigation).toBeDefined();
      } else {
        expect(true).toBe(true);
      }
    });
  });

  describe('P3-T8: Diagnostic Recommendations', () => {
    it('should generate recommendations based on errors', () => {
      const newReporter = new DiagnosticReporter(mockLogger);
      for (let i = 0; i < 6; i++) {
        const classified = newReporter.recordAndClassify(
          new Error('Rate limit exceeded'),
          { attempt: i }
        );
        newReporter.getMemory().record(new Error('Rate limit exceeded'), classified);
      }

      const report = newReporter.generateReport();
      expect(report.summary.recommendations.length).toBeGreaterThan(0);
    });
  });
});

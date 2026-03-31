import { describe, it, expect, beforeEach } from 'vitest';
import { AutoFixer, type FixResult } from '../../src/reliability/AutoFixer.js';
import { RetryStrategy, type RetryState } from '../../src/reliability/RetryStrategy.js';
import { OutputGuardrails } from '../../src/reliability/OutputGuardrails.js';
import { ErrorCategory } from '../../src/diagnostics/ErrorClassifier.js';

describe('Phase 4: Reliability Layer', () => {
  describe('P4-T1: AutoFixer Registration', () => {
    it('should register custom strategy', () => {
      const fixer = new AutoFixer();
      const strategy = {
        category: ErrorCategory.MODEL_ERROR,
        priority: 1,
        actions: [
          {
            type: 'fallback',
            description: 'Use fallback',
            execute: async () => ({ success: true, message: 'Fallback used' }),
          },
        ],
      };

      fixer.registerStrategy(strategy);
      expect(fixer.hasStrategy(ErrorCategory.MODEL_ERROR)).toBe(true);
    });

    it('should have default strategies', () => {
      const fixer = new AutoFixer();
      
      expect(fixer.hasStrategy(ErrorCategory.PARSE_ERROR)).toBe(true);
      expect(fixer.hasStrategy(ErrorCategory.NETWORK_ERROR)).toBe(true);
      expect(fixer.hasStrategy(ErrorCategory.RATE_LIMIT_ERROR)).toBe(true);
      expect(fixer.hasStrategy(ErrorCategory.TIMEOUT_ERROR)).toBe(true);
    });

    it('should return registered categories', () => {
      const fixer = new AutoFixer();
      const categories = fixer.getRegisteredCategories();
      
      expect(categories.length).toBeGreaterThan(0);
      expect(categories).toContain(ErrorCategory.PARSE_ERROR);
    });
  });

  describe('P4-T2: AutoFixer Fix Attempts', () => {
    it('should attempt fix for classified error', async () => {
      const fixer = new AutoFixer();
      const classified = {
        category: ErrorCategory.PARSE_ERROR,
        severity: 'high' as any,
        isRetryable: true,
        isRecoverable: true,
        suggestedAction: 'Retry parsing',
        context: { errorMessage: 'Parse error' },
      };

      const result = await fixer.attemptFix(classified);
      
      expect(result).toBeDefined();
      expect(result.message).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });

    it('should return no strategy message for unknown category', async () => {
      const fixer = new AutoFixer();
      const classified = {
        category: ErrorCategory.UNKNOWN_ERROR,
        severity: 'low' as any,
        isRetryable: true,
        isRecoverable: true,
        suggestedAction: '',
        context: { errorMessage: 'Unknown' },
      };

      const result = await fixer.attemptFix(classified);
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('No fix strategy');
    });

    it('should track fix history', async () => {
      const fixer = new AutoFixer();
      const classified = {
        category: ErrorCategory.PARSE_ERROR,
        severity: 'high' as any,
        isRetryable: true,
        isRecoverable: true,
        suggestedAction: '',
        context: { errorMessage: 'Parse error' },
      };

      await fixer.attemptFix(classified);
      const history = fixer.getFixHistory(ErrorCategory.PARSE_ERROR);
      
      expect(history.length).toBeGreaterThan(0);
      expect(history[0].action).toBeDefined();
    });

    it('should calculate success rate', async () => {
      const fixer = new AutoFixer();
      const classified = {
        category: ErrorCategory.PARSE_ERROR,
        severity: 'high' as any,
        isRetryable: true,
        isRecoverable: true,
        suggestedAction: '',
        context: { errorMessage: 'Parse error' },
      };

      await fixer.attemptFix(classified);
      const rate = fixer.getSuccessRate(ErrorCategory.PARSE_ERROR);
      
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(1);
    });
  });

  describe('P4-T3: RetryStrategy Configuration', () => {
    it('should use default config', () => {
      const strategy = new RetryStrategy();
      const config = strategy.getConfig();

      expect(config.maxRetries).toBe(3);
      expect(config.baseDelayMs).toBe(1000);
      expect(config.backoffMultiplier).toBe(2);
      expect(config.jitterEnabled).toBe(true);
    });

    it('should accept custom config', () => {
      const strategy = new RetryStrategy({
        maxRetries: 5,
        baseDelayMs: 500,
      });
      const config = strategy.getConfig();

      expect(config.maxRetries).toBe(5);
      expect(config.baseDelayMs).toBe(500);
      expect(config.backoffMultiplier).toBe(2);
    });

    it('should create initial retry state', () => {
      const strategy = new RetryStrategy();
      const state = strategy.createRetryState();

      expect(state.attemptNumber).toBe(0);
      expect(state.totalAttempts).toBe(0);
      expect(state.isComplete).toBe(false);
      expect(state.success).toBe(false);
    });
  });

  describe('P4-T4: RetryStrategy Retry Logic', () => {
    it('should not retry when max attempts reached', () => {
      const strategy = new RetryStrategy({ maxRetries: 3 });
      const state: RetryState = {
        attemptNumber: 3,
        totalAttempts: 3,
        isComplete: false,
        success: false,
      };

      const shouldRetry = strategy.shouldRetry(state, true);
      expect(shouldRetry).toBe(false);
    });

    it('should not retry when complete', () => {
      const strategy = new RetryStrategy();
      const state: RetryState = {
        attemptNumber: 1,
        totalAttempts: 1,
        isComplete: true,
        success: true,
      };

      const shouldRetry = strategy.shouldRetry(state, true);
      expect(shouldRetry).toBe(false);
    });

    it('should not retry non-retryable errors', () => {
      const strategy = new RetryStrategy();
      const state = strategy.createRetryState();

      const shouldRetry = strategy.shouldRetry(state, false);
      expect(shouldRetry).toBe(false);
    });

    it('should calculate exponential backoff delay', () => {
      const strategy = new RetryStrategy({ 
        baseDelayMs: 1000, 
        backoffMultiplier: 2,
        jitterEnabled: false,
      });

      const delay0 = strategy.getDelayForAttempt(0);
      const delay1 = strategy.getDelayForAttempt(1);
      const delay2 = strategy.getDelayForAttempt(2);

      expect(delay0).toBe(1000);
      expect(delay1).toBe(2000);
      expect(delay2).toBe(4000);
    });

    it('should cap delay at maxDelayMs', () => {
      const strategy = new RetryStrategy({ 
        baseDelayMs: 1000, 
        maxDelayMs: 5000,
        jitterEnabled: false,
      });

      const delay = strategy.getDelayForAttempt(10);
      expect(delay).toBeLessThanOrEqual(5000);
    });
  });

  describe('P4-T5: RetryStrategy State Management', () => {
    it('should record attempt', () => {
      const strategy = new RetryStrategy();
      const state = strategy.createRetryState();
      const newState = strategy.recordAttempt(state, new Error('Test error'));

      expect(newState.attemptNumber).toBe(1);
      expect(newState.totalAttempts).toBe(1);
      expect(newState.lastError).toBe('Test error');
      expect(newState.nextRetryAt).toBeDefined();
    });

    it('should record success', () => {
      const strategy = new RetryStrategy();
      const state: RetryState = {
        attemptNumber: 2,
        totalAttempts: 2,
        isComplete: false,
        success: false,
      };
      const newState = strategy.recordSuccess(state);

      expect(newState.isComplete).toBe(true);
      expect(newState.success).toBe(true);
    });

    it('should mark complete when max retries reached', () => {
      const strategy = new RetryStrategy({ maxRetries: 3 });
      const state: RetryState = {
        attemptNumber: 2,
        totalAttempts: 2,
        isComplete: false,
        success: false,
      };
      const newState = strategy.recordAttempt(state);

      expect(newState.isComplete).toBe(true);
      expect(newState.attemptNumber).toBe(3);
    });
  });

  describe('P4-T6: OutputGuardrails Configuration', () => {
    it('should use default config', () => {
      const guardrails = new OutputGuardrails();
      const config = guardrails.getConfig();

      expect(config.strictMode).toBe(false);
      expect(config.maxFileSize).toBe(1_000_000);
      expect(config.maxFiles).toBe(50);
      expect(config.requireSummary).toBe(false);
    });

    it('should accept custom config', () => {
      const guardrails = new OutputGuardrails({
        strictMode: true,
        maxFiles: 10,
      });
      const config = guardrails.getConfig();

      expect(config.strictMode).toBe(true);
      expect(config.maxFiles).toBe(10);
    });

    it('should update config', () => {
      const guardrails = new OutputGuardrails();
      guardrails.updateConfig({ maxFileSize: 500 });
      
      const config = guardrails.getConfig();
      expect(config.maxFileSize).toBe(500);
    });

    it('should have default rules', () => {
      const guardrails = new OutputGuardrails();
      const rules = guardrails.getRules();

      expect(rules).toContain('hasFiles');
      expect(rules).toContain('maxFiles');
      expect(rules).toContain('fileSize');
      expect(rules).toContain('validPaths');
    });
  });

  describe('P4-T7: OutputGuardrails Validation', () => {
    it('should validate valid result', () => {
      const guardrails = new OutputGuardrails({ strictMode: true });
      const result = {
        success: true,
        files: [
          { path: 'test.js', content: 'console.log("test")' },
        ],
      };

      const validation = guardrails.validate(result);
      
      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });

    it('should reject empty files', () => {
      const guardrails = new OutputGuardrails({ strictMode: true });
      const result = {
        success: true,
        files: [],
      };

      const validation = guardrails.validate(result);
      
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('No files'))).toBe(true);
    });

    it('should reject too many files', () => {
      const guardrails = new OutputGuardrails({ strictMode: true, maxFiles: 2 });
      const result = {
        success: true,
        files: [
          { path: 'a.js', content: 'a' },
          { path: 'b.js', content: 'b' },
          { path: 'c.js', content: 'c' },
        ],
      };

      const validation = guardrails.validate(result);
      
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('Too many files'))).toBe(true);
    });

    it('should reject invalid paths', () => {
      const guardrails = new OutputGuardrails({ strictMode: true });
      const result = {
        success: true,
        files: [
          { path: '', content: 'test' },
          { path: '/absolute/path', content: 'test' },
        ],
      };

      const validation = guardrails.validate(result);
      
      expect(validation.valid).toBe(false);
    });

    it('should reject oversized files', () => {
      const guardrails = new OutputGuardrails({ strictMode: true, maxFileSize: 10 });
      const result = {
        success: true,
        files: [
          { path: 'big.js', content: 'x'.repeat(100) },
        ],
      };

      const validation = guardrails.validate(result);
      
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('exceed max size'))).toBe(true);
    });
  });

  describe('P4-T8: OutputGuardrails Sanitization', () => {
    it('should sanitize result', () => {
      const guardrails = new OutputGuardrails();
      const result = {
        success: true,
        files: [
          { path: '  test.js  ', content: '  content  ' },
        ],
      };

      const sanitized = guardrails.sanitize(result);
      
      expect(sanitized.files[0].path).toBe('test.js');
      expect(sanitized.files[0].content).toBe('content');
    });

    it('should filter empty paths', () => {
      const guardrails = new OutputGuardrails();
      const result = {
        success: true,
        files: [
          { path: '', content: 'test' },
          { path: 'valid.js', content: 'test' },
        ],
      };

      const sanitized = guardrails.sanitize(result);
      
      expect(sanitized.files.length).toBe(1);
      expect(sanitized.files[0].path).toBe('valid.js');
    });
  });
});

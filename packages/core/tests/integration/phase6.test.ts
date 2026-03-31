import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EamilOS } from '../../src/index.js';
import { SecretManager } from '../../src/security/SecretManager.js';
import { SecureLogger } from '../../src/security/SecureLogger.js';
import { LeakDetector } from '../../src/security/LeakDetector.js';
import { SecurityGuard } from '../../src/security/SecurityGuard.js';
import { ErrorClassifier, ErrorCategory } from '../../src/diagnostics/ErrorClassifier.js';
import { ErrorMemory } from '../../src/diagnostics/ErrorMemory.js';
import { DiagnosticReporter } from '../../src/diagnostics/DiagnosticReporter.js';
import { AutoFixer } from '../../src/reliability/AutoFixer.js';
import { RetryStrategy } from '../../src/reliability/RetryStrategy.js';
import { OutputGuardrails } from '../../src/reliability/OutputGuardrails.js';
import { ModelRegistry, initModelRegistry } from '../../src/models/ModelRegistry.js';
import { TaskSplitter } from '../../src/models/TaskSplitter.js';

describe('Phase 6: Full Integration', () => {
  let mockLogger: SecureLogger;
  let secretManager: SecretManager;

  beforeEach(() => {
    mockLogger = {
      info: () => {},
      debug: () => {},
      warn: () => {},
      error: () => {},
      security: () => {},
    } as any;
    secretManager = new SecretManager({});
  });

  describe('P6-T1: Security + Diagnostics Integration', () => {
    it('should integrate security leak detection with error classification', () => {
      const classifier = new ErrorClassifier();
      const memory = new ErrorMemory();

      const error = new Error('API key exposed: sk-1234567890abcdef');
      const classified = classifier.classify(error, { source: 'api-call' });
      
      memory.record(error, classified);

      const stats = memory.getStats();
      expect(stats.totalErrors).toBe(1);
    });

    it('should create diagnostic report for security events', () => {
      const reporter = new DiagnosticReporter(mockLogger);
      
      reporter.recordAndClassify(new Error('401 Unauthorized'), { source: 'auth' });
      reporter.recordAndClassify(new Error('ECONNREFUSED'), { source: 'network' });

      const report = reporter.generateReport();
      expect(report.summary.totalErrors).toBe(2);
      expect(report.healthScore).toBeLessThan(100);
    });
  });

  describe('P6-T2: Security + Reliability Integration', () => {
    it('should retry failed operations with security context', () => {
      const retryStrategy = new RetryStrategy({ maxRetries: 3 });
      const fixer = new AutoFixer();

      const state = retryStrategy.createRetryState();
      const shouldRetry = retryStrategy.shouldRetry(state, true);
      
      expect(shouldRetry).toBe(true);

      const newState = retryStrategy.recordAttempt(state, new Error('Network error'));
      expect(newState.attemptNumber).toBe(1);
    });

    it('should apply guardrails to output from retry', () => {
      const guardrails = new OutputGuardrails({ strictMode: true });
      
      const result = {
        success: true,
        files: [{ path: 'config.json', content: '{}' }],
      };

      const validation = guardrails.validate(result);
      expect(validation.valid).toBe(true);
    });
  });

  describe('P6-T3: Diagnostics + Reliability Integration', () => {
    it('should use classified error to determine retry strategy', () => {
      const classifier = new ErrorClassifier();
      const retryStrategy = new RetryStrategy();
      const fixer = new AutoFixer();

      const error = new Error('429 Rate limit exceeded');
      const classified = classifier.classify(error);

      expect(classified.isRetryable).toBe(true);

      const shouldRetry = retryStrategy.shouldRetry(
        retryStrategy.createRetryState(),
        classified.isRetryable
      );
      
      expect(shouldRetry).toBe(true);
    });

    it('should auto-fix retryable errors', async () => {
      const classifier = new ErrorClassifier();
      const fixer = new AutoFixer();

      const error = new Error('Network timeout');
      const classified = classifier.classify(error);

      const fixResult = await fixer.attemptFix(classified);
      
      expect(fixResult.message).toBeDefined();
    });

    it('should not auto-fix non-retryable errors', async () => {
      const classifier = new ErrorClassifier();
      const fixer = new AutoFixer();

      const error = new Error('401 Unauthorized');
      const classified = classifier.classify(error);

      const fixResult = await fixer.attemptFix(classified);
      
      expect(fixResult.remainingAttempts).toBe(0);
    });
  });

  describe('P6-T4: Model Abstraction + Reliability Integration', () => {
    it('should validate output against guardrails', () => {
      const guardrails = new OutputGuardrails({ 
        strictMode: true,
        maxFiles: 5,
        maxFileSize: 1000,
      });

      const result = {
        success: true,
        files: [
          { path: 'main.js', content: 'console.log("hello")' },
          { path: 'index.html', content: '<html></html>' },
        ],
      };

      const validation = guardrails.validate(result);
      const sanitized = guardrails.sanitize(result);

      expect(validation.valid).toBe(true);
      expect(sanitized.files.length).toBe(2);
    });

    it('should reject oversized output', () => {
      const guardrails = new OutputGuardrails({ 
        strictMode: true,
        maxFileSize: 10,
      });

      const result = {
        success: true,
        files: [
          { path: 'big.js', content: 'x'.repeat(1000) },
        ],
      };

      const validation = guardrails.validate(result);
      expect(validation.valid).toBe(false);
    });

    it('should split large tasks', () => {
      const splitter = new TaskSplitter();
      const strategy = {
        mode: 'json_nuclear' as const,
        promptStrictness: 'nuclear' as const,
        maxRetries: 5,
        retryDelayMs: 1000,
        requiresTaskSplitting: true,
        maxTaskSizeChars: 100,
        systemPrompt: '',
      };

      const largeTask = 'x'.repeat(200);
      const shouldSplit = splitter.shouldSplit(largeTask, strategy);
      
      expect(shouldSplit).toBe(true);
    });
  });

  describe('P6-T5: Full Error Handling Pipeline', () => {
    it('should handle complete error flow', async () => {
      const classifier = new ErrorClassifier();
      const memory = new ErrorMemory();
      const reporter = new DiagnosticReporter(mockLogger);
      const fixer = new AutoFixer();
      const retryStrategy = new RetryStrategy({ maxRetries: 3 });

      const error = new Error('Parse error: unexpected token');

      const classified = classifier.classify(error);
      memory.record(error, classified);
      reporter.recordAndClassify(error);

      const retryState = retryStrategy.createRetryState();
      const shouldRetry = retryStrategy.shouldRetry(retryState, classified.isRetryable);
      expect(shouldRetry).toBe(true);

      const fixResult = await fixer.attemptFix(classified);
      expect(fixResult).toBeDefined();

      const report = reporter.generateReport();
      expect(report.summary.totalErrors).toBeGreaterThan(0);
    });

    it('should handle rate limit error flow', async () => {
      const classifier = new ErrorClassifier();
      const retryStrategy = new RetryStrategy({ maxRetries: 5, baseDelayMs: 1000 });

      const error = new Error('429 Too many requests');
      const classified = classifier.classify(error);

      expect(classified.category).toBe(ErrorCategory.RATE_LIMIT_ERROR);
      expect(classified.isRetryable).toBe(true);

      let state = retryStrategy.createRetryState();
      state = retryStrategy.recordAttempt(state);
      
      const delay = retryStrategy.calculateDelay(state.attemptNumber);
      expect(delay).toBeGreaterThan(0);

      state = retryStrategy.recordSuccess(state);
      expect(state.success).toBe(true);
    });

    it('should handle auth error flow', async () => {
      const classifier = new ErrorClassifier();
      const retryStrategy = new RetryStrategy();

      const error = new Error('401 Unauthorized');
      const classified = classifier.classify(error);

      expect(classified.category).toBe(ErrorCategory.AUTH_ERROR);
      expect(classified.isRetryable).toBe(false);
      expect(classified.isRecoverable).toBe(false);

      const shouldRetry = retryStrategy.shouldRetry(
        retryStrategy.createRetryState(),
        classified.isRetryable
      );
      expect(shouldRetry).toBe(false);
    });
  });

  describe('P6-T6: Output Validation Pipeline', () => {
    it('should validate and sanitize complete output', () => {
      const guardrails = new OutputGuardrails({
        strictMode: true,
        maxFiles: 10,
        maxFileSize: 50000,
      });

      const rawResult = {
        success: true,
        files: [
          { path: '  test.js  ', content: '  console.log("hi")  ' },
          { path: 'readme.md', content: '# Project' },
        ],
      };

      const validation = guardrails.validate(rawResult);
      const sanitized = guardrails.sanitize(rawResult);

      expect(validation.valid).toBe(true);
      expect(sanitized.files[0].path).toBe('test.js');
    });

    it('should block dangerous file types', () => {
      const guardrails = new OutputGuardrails({
        strictMode: true,
        blockedExtensions: ['.exe', '.dll', '.bat'],
      });

      const result = {
        success: true,
        files: [
          { path: 'malware.exe', content: 'malicious code' },
        ],
      };

      const validation = guardrails.validate(result);
      expect(validation.valid).toBe(false);
    });
  });

  describe('P6-T7: Model Strategy Selection', () => {
    it('should select correct strategy based on model profile', () => {
      const registry = initModelRegistry(mockLogger);
      
      const highReliabilityProfile = {
        name: 'gpt-4',
        provider: 'openai',
        supportsTools: true,
        supportsJSON: true,
        supportsStreaming: true,
        maxContextTokens: 8192,
        maxOutputTokens: 4096,
        reliabilityScore: 0.95,
        jsonComplianceRate: 0.95,
        avgResponseTimeMs: 1000,
        testedAt: new Date().toISOString(),
        testResults: [],
      };

      const strategy = registry.getExecutionStrategy(highReliabilityProfile);
      
      expect(strategy.mode).toBe('tool');
      expect(strategy.maxRetries).toBe(3);
    });

    it('should use nuclear mode for unreliable models', () => {
      const registry = initModelRegistry(mockLogger);
      
      const lowReliabilityProfile = {
        name: 'local-model',
        provider: 'ollama',
        supportsTools: false,
        supportsJSON: false,
        supportsStreaming: false,
        maxContextTokens: 2048,
        maxOutputTokens: 1024,
        reliabilityScore: 0.2,
        jsonComplianceRate: 0.1,
        avgResponseTimeMs: 5000,
        testedAt: new Date().toISOString(),
        testResults: [],
      };

      const strategy = registry.getExecutionStrategy(lowReliabilityProfile);
      
      expect(strategy.mode).toBe('json_nuclear');
      expect(strategy.requiresTaskSplitting).toBe(true);
      expect(strategy.maxRetries).toBe(5);
    });
  });

  describe('P6-T8: Security Guard Integration', () => {
    it('should validate config with security guard', () => {
      const guard = new SecurityGuard(secretManager, mockLogger);
      
      const cleanConfig = {
        providers: [
          {
            id: 'openai',
            type: 'openai',
            models: [{ id: 'gpt-4', tier: 'strong', context_window: 8192 }],
          },
        ],
      };

      const result = guard.validateConfig(cleanConfig);
      expect(result.valid).toBe(true);
    });

    it('should detect secrets in config', () => {
      const guard = new SecurityGuard(mockLogger);
      
      const configWithSecrets = {
        api_key: 'sk-1234567890abcdef', 
        secret: 'my-secret',
      };

      const result = guard.validateConfig(configWithSecrets as any);
      expect(result.valid).toBe(false);
    });

    it('should scan for secrets in artifacts', () => {
      const detector = new LeakDetector();
      const guard = new SecurityGuard(mockLogger);

      const artifact = {
        path: 'config.json',
        content: 'api_key = "sk-1234567890abcdefghij"',
      };

      const result = guard.validateArtifact(artifact as any);
      expect(result.safe).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it('should sanitize agent context', () => {
      const guard = new SecurityGuard(secretManager, mockLogger);

      const context = {
        apiKey: 'secret-key',
        userId: 'user-123',
        settings: { debug: true },
      };

      const sanitized = guard.sanitizeAgentContext(context as any);
      
      expect((sanitized as any).apiKey).toBeUndefined();
      expect((sanitized as any).userId).toBe('user-123');
    });
  });
});

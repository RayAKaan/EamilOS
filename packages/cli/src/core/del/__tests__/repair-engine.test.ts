import { describe, it, expect } from 'vitest';
import { RepairEngine } from '../repair-engine.js';
import { DELValidationError, DELErrorCode } from '../types.js';

function makeError(code: DELErrorCode, overrides?: Partial<DELValidationError>): DELValidationError {
  return {
    code,
    message: `Test error: ${code}`,
    context: 'test context',
    stage: 'content',
    filePath: 'src/test.ts',
    ...overrides,
  };
}

describe('RepairEngine', () => {
  describe('analyze', () => {
    it('returns no retry for empty errors', () => {
      const engine = new RepairEngine();
      const result = engine.analyze([]);
      expect(result.shouldRetry).toBe(false);
      expect(result.shouldTerminate).toBe(false);
    });

    it('terminates on PATH_TRAVERSAL errors', () => {
      const engine = new RepairEngine();
      const result = engine.analyze([makeError(DELErrorCode.PATH_TRAVERSAL)]);
      expect(result.shouldRetry).toBe(false);
      expect(result.shouldTerminate).toBe(true);
      expect(result.terminationReason).toContain('Security');
    });

    it('terminates on SECRET_DETECTED errors', () => {
      const engine = new RepairEngine();
      const result = engine.analyze([makeError(DELErrorCode.SECRET_DETECTED)]);
      expect(result.shouldRetry).toBe(false);
      expect(result.shouldTerminate).toBe(true);
    });

    it('allows retry for non-security errors', () => {
      const engine = new RepairEngine();
      const result = engine.analyze([makeError(DELErrorCode.SCHEMA_MISMATCH)]);
      expect(result.shouldRetry).toBe(true);
      expect(result.shouldTerminate).toBe(false);
    });

    it('allows retry for SYNTAX_ERROR', () => {
      const engine = new RepairEngine();
      const result = engine.analyze([makeError(DELErrorCode.SYNTAX_ERROR)]);
      expect(result.shouldRetry).toBe(true);
    });
  });

  describe('generateRepairPrompt', () => {
    it('terminates when max attempts reached', () => {
      const engine = new RepairEngine(3);
      const result = engine.generateRepairPrompt(
        [makeError(DELErrorCode.SCHEMA_MISMATCH)],
        { attempt: 3, maxAttempts: 3, failureHistory: [], escalationLevel: 'standard' }
      );
      expect(result.shouldRetry).toBe(false);
      expect(result.shouldTerminate).toBe(true);
      expect(result.terminationReason).toContain('Max attempts');
    });

    it('generates standard repair prompt at standard escalation', () => {
      const engine = new RepairEngine();
      const result = engine.generateRepairPrompt(
        [makeError(DELErrorCode.SCHEMA_MISMATCH)],
        { attempt: 0, maxAttempts: 3, failureHistory: [], escalationLevel: 'standard' }
      );
      expect(result.shouldRetry).toBe(true);
      expect(result.repairPrompt).toBeDefined();
      expect(result.repairPrompt!.systemInstruction).toContain('JSON');
      expect(result.nextEscalationLevel).toBe('strict');
    });

    it('generates strict repair prompt at strict escalation', () => {
      const engine = new RepairEngine();
      const result = engine.generateRepairPrompt(
        [makeError(DELErrorCode.PLACEHOLDER_DETECTED)],
        { attempt: 1, maxAttempts: 3, failureHistory: [], escalationLevel: 'strict' }
      );
      expect(result.shouldRetry).toBe(true);
      expect(result.repairPrompt).toBeDefined();
      expect(result.repairPrompt!.correctionContext).toContain('placeholders');
      expect(result.nextEscalationLevel).toBe('decompose');
    });

    it('generates decompose repair prompt at decompose escalation', () => {
      const engine = new RepairEngine();
      const result = engine.generateRepairPrompt(
        [makeError(DELErrorCode.LOW_CODE_DENSITY, { filePath: 'src/app.ts' })],
        { attempt: 2, maxAttempts: 3, failureHistory: [], escalationLevel: 'decompose' }
      );
      expect(result.shouldRetry).toBe(true);
      expect(result.repairPrompt).toBeDefined();
      expect(result.nextEscalationLevel).toBe('decompose');
    });

    it('terminates on security failure in generateRepairPrompt', () => {
      const engine = new RepairEngine();
      const result = engine.generateRepairPrompt(
        [makeError(DELErrorCode.PATH_TRAVERSAL)],
        { attempt: 0, maxAttempts: 3, failureHistory: [], escalationLevel: 'standard' }
      );
      expect(result.shouldRetry).toBe(false);
      expect(result.shouldTerminate).toBe(true);
    });
  });

  describe('createRetryContext', () => {
    it('creates context with correct fields', () => {
      const engine = new RepairEngine(5);
      const history = [makeError(DELErrorCode.SCHEMA_MISMATCH)];
      const ctx = engine.createRetryContext(2, history, 'strict');
      expect(ctx.attempt).toBe(2);
      expect(ctx.maxAttempts).toBe(5);
      expect(ctx.failureHistory).toHaveLength(1);
      expect(ctx.escalationLevel).toBe('strict');
    });
  });

  describe('getEscalationDescription', () => {
    it('returns correct descriptions', () => {
      const engine = new RepairEngine();
      expect(engine.getEscalationDescription('standard')).toContain('error context');
      expect(engine.getEscalationDescription('strict')).toContain('schema');
      expect(engine.getEscalationDescription('decompose')).toContain('single-file');
    });
  });

  describe('createRepairEngine', () => {
    it('creates a RepairEngine instance', () => {
      const engine = new RepairEngine();
      expect(engine).toBeInstanceOf(RepairEngine);
    });
  });
});

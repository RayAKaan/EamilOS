import { describe, it, expect, beforeEach } from 'vitest';
import { SecretManager } from '../../src/security/SecretManager.js';
import { SecretNotFoundError } from '../../src/security/errors.js';
import { LeakDetector } from '../../src/security/LeakDetector.js';
import { SecureLogger } from '../../src/security/SecureLogger.js';
import { SecurityGuard } from '../../src/security/SecurityGuard.js';
import { Logger } from '../../src/logger.js';

describe('PHASE 1: Security Layer', () => {
  describe('P1-T1: Secret Access', () => {
    it('should return key and audit log entry with masked value', () => {
      process.env.TEST_API_KEY = 'sk-test1234567890abcdefghij1234567890ab';
      const sm = new SecretManager();
      
      const value = sm.get('TEST_API_KEY');
      
      expect(value).toBe('sk-test1234567890abcdefghij1234567890ab');
      
      const auditLog = sm.getAuditLog();
      expect(auditLog.length).toBeGreaterThan(0);
      expect(auditLog[0].key).toBe('sk-t****90ab');
      
      delete process.env.TEST_API_KEY;
    });
  });

  describe('P1-T2: Missing Secret', () => {
    it('should throw SecretNotFoundError with helpful message', () => {
      delete process.env.NONEXISTENT_KEY;
      const sm = new SecretManager();
      
      expect(() => sm.get('NONEXISTENT_KEY')).toThrow(SecretNotFoundError);
      try {
        sm.get('NONEXISTENT_KEY');
      } catch (e) {
        expect((e as Error).message).toContain('NONEXISTENT_KEY');
        expect((e as Error).message).toContain('eamilos init');
      }
    });
  });

  describe('P1-T3: Leak Detection in Artifact', () => {
    it('should detect OpenAI API key in artifact content', () => {
      const ld = new LeakDetector();
      const file = {
        path: 'config.py',
        content: 'API_KEY = "sk-live1234567890abcdefghij1234567890ab"',
      };
      
      const result = ld.scanFile(file);
      
      expect(result.safe).toBe(false);
      expect(result.violations.some(v => v.pattern === 'OpenAI API Key')).toBe(true);
    });
  });

  describe('P1-T4: Leak Detection in Log', () => {
    it('should sanitize API key in logged message', () => {
      const mockLogger = {
        log: (level: string, message: string, data?: Record<string, unknown>) => {
          expect(message).toContain('[REDACTED]');
          expect(message).not.toContain('sk-test1234567890abcdefghij1234567890ab');
        },
        warn: (message: string, data?: Record<string, unknown>) => {},
        success: (message: string, data?: Record<string, unknown>) => {},
      } as unknown as Logger;
      
      const sl = new SecureLogger(mockLogger);
      sl.log('info', 'Using key sk-test1234567890abcdefghij1234567890ab');
    });
  });

  describe('P1-T5: Config Rejection', () => {
    it('should reject config with hardcoded secrets', () => {
      const mockLogger = {
        log: (level: string, message: string, data?: Record<string, unknown>) => {},
        warn: (message: string, data?: Record<string, unknown>) => {},
        success: (message: string, data?: Record<string, unknown>) => {},
      } as unknown as Logger;
      
      const sg = new SecurityGuard(new SecureLogger(mockLogger));
      const result = sg.validateConfig({ api_key: 'sk-real-key-value-here-1234567890' });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('hardcode'))).toBe(true);
    });
  });

  describe('P1-T6: Agent Context Sanitization', () => {
    it('should remove apiKey, secret, token fields entirely', () => {
      const mockLogger = {
        log: (level: string, message: string, data?: Record<string, unknown>) => {},
        warn: (message: string, data?: Record<string, unknown>) => {},
        success: (message: string, data?: Record<string, unknown>) => {},
      } as unknown as Logger;
      
      const sg = new SecurityGuard(new SecureLogger(mockLogger));
      const context = {
        task: 'build app',
        apiKey: 'sk-secret-value-1234567890abcdefghijklmn',
        data: 'safe content',
        password: 'secret123',
        authToken: 'token123',
      };
      
      const sanitized = sg.sanitizeAgentContext(context);
      
      expect(sanitized).not.toHaveProperty('apiKey');
      expect(sanitized).not.toHaveProperty('password');
      expect(sanitized).not.toHaveProperty('authToken');
      expect(sanitized).toHaveProperty('task');
      expect(sanitized).toHaveProperty('data');
      expect((sanitized as any).task).toBe('build app');
    });
  });

  describe('P1-T7: Clean Artifact Passes', () => {
    it('should pass clean artifact with no violations', () => {
      const ld = new LeakDetector();
      const file = {
        path: 'app.py',
        content: "print('hello world')",
      };
      
      const result = ld.scanFile(file);
      
      expect(result.safe).toBe(true);
      expect(result.violations.length).toBe(0);
    });
  });

  describe('SecretManager.mask()', () => {
    it('should mask long values correctly', () => {
      const sm = new SecretManager();
      
      expect(sm.mask('sk-verylongkeyvalue1234567890ab')).toBe('sk-v****90ab');
      expect(sm.mask('short')).toBe('********');
      expect(sm.mask('12345678901')).toBe('********'); // 11 chars < 12, so full mask
    });
  });

  describe('SecretManager.validate()', () => {
    it('should validate OpenAI API key format', () => {
      process.env.OPENAI_API_KEY = 'sk-test1234567890abcdefghijklmnopqrstuvwx';
      const sm = new SecretManager();
      
      const result = sm.validate('OPENAI_API_KEY');
      expect(result.valid).toBe(true);
      expect(result.format).toContain('sk-');
      
      delete process.env.OPENAI_API_KEY;
    });

    it('should reject invalid OpenAI API key format', () => {
      process.env.OPENAI_API_KEY = 'invalid-key';
      const sm = new SecretManager();
      
      const result = sm.validate('OPENAI_API_KEY');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('sk-');
      
      delete process.env.OPENAI_API_KEY;
    });
  });

  describe('LeakDetector patterns', () => {
    it('should detect Anthropic API keys', () => {
      const ld = new LeakDetector();
      // Anthropic keys after 'sk-ant-' need 20+ alphanumeric chars
      const result = ld.scan('sk-ant-api03abcdefghijklmnopqrstuvwxyz1234567890');
      
      expect(result.safe).toBe(false);
      expect(result.violations.some(v => v.pattern === 'Anthropic API Key')).toBe(true);
    });

    it('should detect AWS Access Keys', () => {
      const ld = new LeakDetector();
      const result = ld.scan('AKIAIOSFODNN7EXAMPLE');
      
      expect(result.safe).toBe(false);
      expect(result.violations.some(v => v.pattern === 'AWS Access Key')).toBe(true);
    });

    it('should detect Bearer tokens', () => {
      const ld = new LeakDetector();
      const result = ld.scan('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ');
      
      expect(result.safe).toBe(false);
      expect(result.violations.some(v => v.pattern === 'Bearer Token')).toBe(true);
    });

    it('should detect Private Key Blocks', () => {
      const ld = new LeakDetector();
      const result = ld.scan('-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyf8Qj...\n-----END RSA PRIVATE KEY-----');
      
      expect(result.safe).toBe(false);
      expect(result.violations.some(v => v.pattern === 'Private Key Block')).toBe(true);
    });
  });

  describe('SecurityGuard.validateArtifact()', () => {
    it('should block artifact with API key and log security event', () => {
      const securityEvents: any[] = [];
      const mockLogger = {
        log: () => {},
        warn: () => {},
        success: () => {},
        security: (event: string, details: any) => {
          securityEvents.push({ event, details });
        },
      } as unknown as Logger;
      
      const sg = new SecurityGuard(mockLogger as any);
      const result = sg.validateArtifact({
        path: 'config.py',
        content: 'API_KEY = "sk-live1234567890abcdefghij1234567890ab"',
      });
      
      expect(result.safe).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(securityEvents.some(e => e.event.includes('validation failed'))).toBe(true);
    });
  });
});

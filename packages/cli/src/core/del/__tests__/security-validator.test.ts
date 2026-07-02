import { describe, it, expect } from 'vitest';
import path from 'path';
import { validateSecurity, isSecurityFailure } from '../security-validator.js';
import { ExtractedFile, DELErrorCode, DELConfig } from '../types.js';

function makeFile(filePath: string, content: string): ExtractedFile {
  return { path: filePath, content };
}

function makeConfig(overrides?: Partial<DELConfig>): DELConfig {
  return {
    workspaceRoot: process.cwd(),
    maxAttempts: 3,
    strictMode: false,
    allowDescriptiveContent: false,
    maxFileSizeBytes: 10 * 1024 * 1024,
    ...overrides,
  };
}

describe('validateSecurity', () => {
  describe('absolute path rejection', () => {
    it('rejects Unix absolute paths', () => {
      const result = validateSecurity(
        [makeFile('/etc/passwd', 'content')],
        makeConfig()
      );
      expect(result.valid).toBe(false);
      expect(result.rejectedFiles[0].reason).toContain('Absolute');
    });

    it('rejects Windows absolute paths', () => {
      const result = validateSecurity(
        [makeFile('C:\\Windows\\System32\\config', 'content')],
        makeConfig()
      );
      expect(result.valid).toBe(false);
      expect(result.rejectedFiles[0].reason).toContain('Absolute');
    });

    it('accepts relative paths', () => {
      const result = validateSecurity(
        [makeFile('src/app.ts', 'const x = 1;')],
        makeConfig()
      );
      expect(result.valid).toBe(true);
      expect(result.safeFiles).toHaveLength(1);
    });
  });

  describe('path traversal rejection', () => {
    it('rejects paths with .. sequences', () => {
      const result = validateSecurity(
        [makeFile('../../etc/passwd', 'content')],
        makeConfig()
      );
      expect(result.valid).toBe(false);
      expect(result.rejectedFiles[0].reason).toContain('traversal');
    });

    it('rejects nested traversal', () => {
      const result = validateSecurity(
        [makeFile('src/../../../etc/passwd', 'content')],
        makeConfig()
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('blocked filenames', () => {
    it('rejects .env files', () => {
      const result = validateSecurity(
        [makeFile('.env', 'API_KEY=secret')],
        makeConfig()
      );
      expect(result.valid).toBe(false);
      expect(result.rejectedFiles[0].reason).toContain('Blocked');
    });

    it('rejects .env.local', () => {
      const result = validateSecurity(
        [makeFile('.env.local', 'KEY=val')],
        makeConfig()
      );
      expect(result.valid).toBe(false);
    });

    it('rejects id_rsa', () => {
      const result = validateSecurity(
        [makeFile('id_rsa', 'private key content')],
        makeConfig()
      );
      expect(result.valid).toBe(false);
    });

    it('rejects package-lock.json', () => {
      const result = validateSecurity(
        [makeFile('package-lock.json', '{}')],
        makeConfig()
      );
      expect(result.valid).toBe(false);
    });

    it('allows .gitignore', () => {
      const result = validateSecurity(
        [makeFile('.gitignore', 'node_modules/\n.env')],
        makeConfig()
      );
      expect(result.valid).toBe(true);
    });

    it('allows .github', () => {
      const result = validateSecurity(
        [makeFile('.github/workflows/ci.yml', 'name: CI')],
        makeConfig()
      );
      expect(result.valid).toBe(true);
    });

    it('rejects data.json (placeholder name)', () => {
      const result = validateSecurity(
        [makeFile('data.json', '{}')],
        makeConfig()
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('secret detection', () => {
    it('detects OpenAI API keys', () => {
      const content = 'const key = "sk-abcdefghijklmnopqrstuvwx"';
      const result = validateSecurity([makeFile('src/config.ts', content)], makeConfig());
      expect(result.valid).toBe(false);
      expect(result.rejectedFiles[0].code).toBe(DELErrorCode.SECRET_DETECTED);
      expect(result.rejectedFiles[0].reason).toContain('OpenAI');
    });

    it('detects Anthropic API keys', () => {
      const content = 'const key = "sk-ant-abcdefghijklmnopqrstuvwx"';
      const result = validateSecurity([makeFile('src/config.ts', content)], makeConfig());
      expect(result.valid).toBe(false);
      expect(result.rejectedFiles[0].reason).toContain('Anthropic');
    });

    it('detects AWS access keys', () => {
      const content = 'const key = "AKIAIOSFODNN7EXAMPLE"';
      const result = validateSecurity([makeFile('src/config.ts', content)], makeConfig());
      expect(result.valid).toBe(false);
      expect(result.rejectedFiles[0].reason).toContain('AWS');
    });

    it('detects private key blocks', () => {
      const content = '-----BEGIN RSA PRIVATE KEY-----\nMIIE...';
      const result = validateSecurity([makeFile('key.pem', content)], makeConfig());
      expect(result.valid).toBe(false);
      expect(result.rejectedFiles[0].reason).toContain('Private Key');
    });

    it('detects password assignments', () => {
      const content = 'const password = "supersecretpassword123"';
      const result = validateSecurity([makeFile('config.ts', content)], makeConfig());
      expect(result.valid).toBe(false);
      expect(result.rejectedFiles[0].reason).toContain('Password');
    });

    it('accepts clean code', () => {
      const content = 'const apiKey = process.env.API_KEY;\nexport default { apiKey };';
      const result = validateSecurity([makeFile('src/config.ts', content)], makeConfig());
      expect(result.valid).toBe(true);
    });
  });

  describe('workspace boundary', () => {
    it('rejects files escaping workspace via traversal', () => {
      const result = validateSecurity(
        [makeFile('../outside/file.ts', 'content')],
        makeConfig()
      );
      expect(result.valid).toBe(false);
      expect(result.rejectedFiles[0].reason).toContain('traversal');
    });
  });

  describe('dangerous characters', () => {
    it('rejects paths with null bytes', () => {
      const result = validateSecurity(
        [makeFile('src/app\x00.ts', 'content')],
        makeConfig()
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('mixed results', () => {
    it('separates safe and rejected files', () => {
      const files = [
        makeFile('src/good.ts', 'const x = 1;'),
        makeFile('.env', 'SECRET=abc'),
        makeFile('src/also-good.ts', 'const y = 2;'),
      ];
      const result = validateSecurity(files, makeConfig());
      expect(result.safeFiles).toHaveLength(2);
      expect(result.rejectedFiles).toHaveLength(1);
    });
  });

  describe('empty input', () => {
    it('returns invalid for no files', () => {
      const result = validateSecurity([], makeConfig());
      expect(result.valid).toBe(false);
    });
  });
});

describe('isSecurityFailure', () => {
  it('returns true for PATH_TRAVERSAL', () => {
    expect(isSecurityFailure(DELErrorCode.PATH_TRAVERSAL)).toBe(true);
  });

  it('returns true for SECRET_DETECTED', () => {
    expect(isSecurityFailure(DELErrorCode.SECRET_DETECTED)).toBe(true);
  });

  it('returns false for other codes', () => {
    expect(isSecurityFailure(DELErrorCode.SCHEMA_MISMATCH)).toBe(false);
    expect(isSecurityFailure(DELErrorCode.SYNTAX_ERROR)).toBe(false);
    expect(isSecurityFailure(DELErrorCode.PLACEHOLDER_DETECTED)).toBe(false);
  });
});

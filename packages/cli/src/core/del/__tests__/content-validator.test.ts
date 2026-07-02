import { describe, it, expect } from 'vitest';
import { validateContent, calculateFileHash } from '../content-validator.js';
import { ExtractedFile, DELErrorCode } from '../types.js';

function makeFile(path: string, content: string): ExtractedFile {
  return { path, content };
}

describe('validateContent', () => {
  describe('placeholder detection', () => {
    it('rejects files with TODO comments', () => {
      const result = validateContent([makeFile('src/app.ts', 'const x = 1;\n// TODO: implement this')]);
      expect(result.valid).toBe(false);
      expect(result.rejectedFiles).toHaveLength(1);
      expect(result.rejectedFiles[0].code).toBe(DELErrorCode.PLACEHOLDER_DETECTED);
      expect(result.rejectedFiles[0].reason).toContain('TODO');
    });

    it('rejects files with FIXME', () => {
      const result = validateContent([makeFile('src/app.ts', '// FIXME: broken\nconst x = 1;')]);
      expect(result.valid).toBe(false);
      expect(result.rejectedFiles[0].reason).toContain('FIXME');
    });

    it('rejects files with trailing ellipsis', () => {
      const result = validateContent([makeFile('src/app.ts', 'const x = ...')]);
      expect(result.valid).toBe(false);
      expect(result.rejectedFiles[0].reason).toContain('ellipsis');
    });

    it('rejects files with "implementation here"', () => {
      const result = validateContent([makeFile('src/app.ts', '// implementation here\nconst x = 1;')]);
      expect(result.valid).toBe(false);
    });

    it('rejects lorem ipsum', () => {
      const result = validateContent([makeFile('src/app.ts', 'Lorem ipsum dolor sit amet')]);
      expect(result.valid).toBe(false);
      expect(result.rejectedFiles[0].reason).toContain('Lorem ipsum');
    });

    it('accepts files without placeholders', () => {
      const result = validateContent([makeFile('src/app.ts', 'const x = 1;\nexport default x;')]);
      expect(result.valid).toBe(true);
      expect(result.rejectedFiles).toHaveLength(0);
    });
  });

  describe('description detection', () => {
    it('rejects pure description content', () => {
      const content = 'This file creates a REST API with authentication endpoints.';
      const result = validateContent([makeFile('src/app.ts', content)]);
      expect(result.valid).toBe(false);
      expect(result.rejectedFiles[0].reason).toContain('description');
    });

    it('rejects "Here is" pattern', () => {
      const content = 'Here is the implementation of the calculator class.';
      const result = validateContent([makeFile('src/app.ts', content)]);
      expect(result.valid).toBe(false);
    });

    it('accepts actual code', () => {
      const content = `import express from 'express';
const app = express();
app.get('/health', (req, res) => res.json({ status: 'ok' }));
export default app;`;
      const result = validateContent([makeFile('src/app.ts', content)]);
      expect(result.valid).toBe(true);
    });
  });

  describe('code density', () => {
    it('rejects low code density files', () => {
      const content = [
        '// This is a comment',
        '// Another comment',
        '// More comments',
        '// Comments everywhere',
        '// Still commenting',
        'const x = 1;',
      ].join('\n');
      const result = validateContent([makeFile('src/app.ts', content)]);
      expect(result.valid).toBe(false);
      expect(result.rejectedFiles[0].code).toBe(DELErrorCode.LOW_CODE_DENSITY);
    });

    it('accepts high code density files', () => {
      const content = `import { Router } from 'express';
const router = Router();
router.get('/api', (req, res) => {
  res.json({ message: 'hello' });
});
router.post('/api', (req, res) => {
  const { name } = req.body;
  res.json({ greeting: \`Hello \${name}\` });
});
export default router;`;
      const result = validateContent([makeFile('src/routes.ts', content)]);
      expect(result.valid).toBe(true);
    });
  });

  describe('syntax checking', () => {
    it('rejects invalid JavaScript syntax', () => {
      const content = 'const x = {; // broken syntax';
      const result = validateContent([makeFile('src/app.ts', content)]);
      expect(result.valid).toBe(false);
      expect(result.rejectedFiles[0].code).toBe(DELErrorCode.SYNTAX_ERROR);
    });

    it('accepts valid JavaScript syntax', () => {
      const content = 'const x = { a: 1, b: 2 };';
      const result = validateContent([makeFile('src/app.js', content)]);
      expect(result.valid).toBe(true);
    });

    it('skips syntax check when disabled', () => {
      const content = 'const x = {; // broken';
      const result = validateContent([makeFile('src/app.ts', content)], { checkSyntax: false });
      expect(result.valid).toBe(true);
    });

    it('detects infinite loop patterns', () => {
      const content = 'while (true) { console.log("loop"); }';
      const result = validateContent([makeFile('src/app.js', content)]);
      expect(result.valid).toBe(false);
      expect(result.rejectedFiles[0].reason).toContain('infinite loop');
    });
  });

  describe('file handling', () => {
    it('processes multiple files', () => {
      const files = [
        makeFile('src/a.ts', 'const a = 1;'),
        makeFile('src/b.ts', 'const b = 2;'),
        makeFile('src/c.ts', 'const c = 3;'),
      ];
      const result = validateContent(files);
      expect(result.validFiles).toHaveLength(3);
    });

    it('separates valid and rejected files', () => {
      const files = [
        makeFile('src/good.ts', 'const x = 1;'),
        makeFile('src/bad.ts', '// TODO: fix this'),
      ];
      const result = validateContent(files);
      expect(result.validFiles).toHaveLength(1);
      expect(result.rejectedFiles).toHaveLength(1);
    });

    it('returns empty when no files provided', () => {
      const result = validateContent([]);
      expect(result.valid).toBe(false);
      expect(result.validFiles).toHaveLength(0);
    });
  });

  describe('minCodeDensity option', () => {
    it('respects custom minCodeDensity', () => {
      const content = '// comment\nconst x = 1;';
      const strict = validateContent([makeFile('src/app.ts', content)], { minCodeDensity: 0.8 });
      expect(strict.valid).toBe(false);

      const lenient = validateContent([makeFile('src/app.ts', content)], { minCodeDensity: 0.1 });
      expect(lenient.valid).toBe(true);
    });
  });

  describe('non-JS files', () => {
    it('skips syntax check for unknown extensions', () => {
      const result = validateContent([makeFile('README.md', '# Hello\nconst x = 1;')]);
      expect(result.valid).toBe(true);
    });

    it('validates Python bracket balance', () => {
      const bad = 'def foo():\n    x = (1 + 2';
      const result = validateContent([makeFile('app.py', bad)]);
      expect(result.valid).toBe(false);
      expect(result.rejectedFiles[0].reason).toContain('unclosed parenthesis');
    });
  });
});

describe('calculateFileHash', () => {
  it('returns consistent hash for same content', () => {
    const h1 = calculateFileHash('hello world');
    const h2 = calculateFileHash('hello world');
    expect(h1).toBe(h2);
  });

  it('returns different hash for different content', () => {
    const h1 = calculateFileHash('hello');
    const h2 = calculateFileHash('world');
    expect(h1).not.toBe(h2);
  });

  it('returns 8-character hex string', () => {
    const hash = calculateFileHash('test');
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });
});

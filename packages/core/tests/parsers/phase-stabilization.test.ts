import { describe, it, expect } from 'vitest';
import { parseResponse } from '../../src/parsers/ResponseParser.js';

describe('PHASE - Stabilization: Parser Tests (P-1 through P-10)', () => {

  describe('P-1: Direct parse with JSON starting with brace', () => {
    it('should extract JSON when response starts with {', () => {
      const response = `{
  "files": [
    { "path": "test.js", "content": "console.log('hello');" }
  ]
}`;
      const result = parseResponse(response);
      
      expect(result.success).toBe(true);
      expect(result.extractionMethod).toBe('DIRECT_PARSE');
      expect(result.files.length).toBe(1);
      expect(result.files[0].path).toBe('test.js');
    });
  });

  describe('P-2: Code block extraction', () => {
    it('should extract JSON from ```json code blocks', () => {
      const response = `Here's the code:

\`\`\`json
{
  "files": [
    { "path": "app.py", "content": "print('hello')" }
  ]
}
\`\`\`

Let me know if you need anything else!`;
      const result = parseResponse(response);
      
      expect(result.success).toBe(true);
      expect(result.extractionMethod).toBe('CODE_BLOCK');
      expect(result.files.length).toBe(1);
      expect(result.files[0].path).toBe('app.py');
    });
  });

  describe('P-3: Brace extraction fallback', () => {
    it('should extract JSON using brace positions when direct parse fails', () => {
      const response = `The following files were created:

Some text before...
{"files": [{"path": "config.yaml", "content": "key: value enabled: true"}]}
...and some text after`;
      const result = parseResponse(response);
      
      expect(result.success).toBe(true);
      expect(result.extractionMethod).toBe('BRACE_EXTRACTION');
      expect(result.files.length).toBe(1);
      expect(result.files[0].path).toBe('config.yaml');
    });
  });

  describe('P-4: Blocked filename rejection', () => {
    it('should reject files with blocked filenames like data.json', () => {
      const response = `{
  "files": [
    { "path": "data.json", "content": "This is placeholder content that looks like description text." },
    { "path": "real.js", "content": "module.exports = {};" }
  ]
}`;
      const result = parseResponse(response);
      
      expect(result.success).toBe(true);
      expect(result.files.length).toBe(1);
      expect(result.files[0].path).toBe('real.js');
      expect(result.files.some(f => f.path === 'data.json')).toBe(false);
    });
  });

  describe('P-5: No valid extension rejection', () => {
    it('should reject files without valid extensions', () => {
      const response = `{
  "files": [
    { "path": "noextension", "content": "some content without extension here" },
    { "path": "valid.ts", "content": "const x = 1;" }
  ]
}`;
      const result = parseResponse(response);
      
      expect(result.success).toBe(true);
      expect(result.files.length).toBe(1);
      expect(result.files[0].path).toBe('valid.ts');
    });
  });

  describe('P-6: Description-like content rejection', () => {
    it('should reject content that looks like descriptions', () => {
      const response = `{
  "files": [
    { "path": "readme.txt", "content": "This is a readme file. It contains important information." },
    { "path": "index.js", "content": "console.log('hello');" }
  ]
}`;
      const result = parseResponse(response);
      
      expect(result.success).toBe(true);
      expect(result.files.some(f => f.path === 'readme.txt')).toBe(false);
      expect(result.files.length).toBe(1);
      expect(result.files[0].path).toBe('index.js');
    });
  });

  describe('P-7: Empty files array', () => {
    it('should return NO_FILES_ARRAY when files is not an array', () => {
      const response = `{
  "summary": "No files to create"
}`;
      const result = parseResponse(response);
      
      expect(result.success).toBe(false);
      expect(result.failureReason).toBe('NO_FILES_ARRAY');
    });
  });

  describe('P-8: Invalid JSON', () => {
    it('should return INVALID_JSON for malformed JSON', () => {
      const response = `{
  "files": [
    { "path": "test.js", "content": "missing closing"
  ]
}`;
      const result = parseResponse(response);
      
      expect(result.success).toBe(false);
      expect(result.failureReason === 'INVALID_JSON' || result.failureReason === 'NO_JSON_FOUND').toBe(true);
    });
  });

  describe('P-9: NO_JSON_FOUND', () => {
    it('should return NO_JSON_FOUND when no JSON-like structure exists', () => {
      const response = `I understand you want me to create a file. Here's the implementation:

The code will print "hello world" to the console.

Let me know if you need anything else!`;
      const result = parseResponse(response);
      
      expect(result.success).toBe(false);
      expect(result.failureReason).toBe('NO_JSON_FOUND');
      expect(result.extractionMethod).toBe('NONE');
    });
  });

  describe('P-10: Multiple valid files', () => {
    it('should extract all valid files from a response', () => {
      const response = `{
  "files": [
    { "path": "main.ts", "content": "import { App } from './app';" },
    { "path": "app.ts", "content": "export class App {}" },
    { "path": "utils/helpers.ts", "content": "export function help() {}" }
  ],
  "summary": "Created main files"
}`;
      const result = parseResponse(response);
      
      expect(result.success).toBe(true);
      expect(result.files.length).toBe(3);
      expect(result.files.map(f => f.path)).toEqual(['main.ts', 'app.ts', 'utils/helpers.ts']);
      expect(result.summary).toBe('Created main files');
    });
  });

});

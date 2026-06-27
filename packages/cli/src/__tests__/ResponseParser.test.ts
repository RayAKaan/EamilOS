import { describe, it, expect } from 'vitest';
import { parseResponse, extractFileChanges } from '../core/parsers/ResponseParser.js';

describe('ResponseParser', () => {
  it('should parse valid JSON with files array', () => {
    const raw = `{"summary": "Test", "files": [{"path": "calc.py", "content": "print('hello')", "language": "python"}]}`;
    const res = parseResponse(raw);
    expect(res.success).toBe(true);
    expect(res.files.length).toBe(1);
    expect(res.files[0]!.path).toBe('calc.py');
  });

  it('should fail when no JSON found', () => {
    const res = parseResponse('just some markdown text');
    expect(res.success).toBe(false);
    expect(res.failureReason).toBe('NO_JSON_FOUND');
  });

  it('preserves action from parsed file JSON', () => {
    const raw = `{"files": [{"path": "src/new.ts", "action": "create", "content": "const x = 1;"}]}`;
    const changes = extractFileChanges(raw, 'opencode');
    expect(changes).toHaveLength(1);
    expect(changes[0].action).toBe('create');
    expect(changes[0].path).toBe('src/new.ts');
  });

  it('defaults to modify when no action in JSON', () => {
    const raw = `{"files": [{"path": "src/file.ts", "content": "const x = 1;"}]}`;
    const changes = extractFileChanges(raw, 'test');
    expect(changes).toHaveLength(1);
    expect(changes[0].action).toBe('modify');
  });
});

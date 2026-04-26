import { describe, it, expect } from 'vitest';
import { ParserChain } from '../../src/parsers/ParserChain.js';

describe('ParserChain', () => {
  it('should parse valid structured JSON through unified chain', async () => {
    const chain = new ParserChain();
    const content = `{
      "files": [
        { "path": "src/index.ts", "content": "export const x = 1;" }
      ]
    }`;

    const result = await chain.parse(content, { expectedFormat: 'json' });
    expect(result.success).toBe(true);
    expect(result.metadata.parser).toBeDefined();
    expect(result.metadata.confidence).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from 'vitest';
import { AgentFactory } from '../core/agents/AgentFactory.js';

describe('DeepSeek Harness integration', () => {
  it('is a first-class harness adapter', () => {
    const agent = AgentFactory.createAdapter('deepseek-harness', { workingDir: process.cwd() });
    expect(agent).not.toBeNull();
    expect(agent?.id).toBe('deepseek-harness');
    expect(agent?.kind).toBe('harness');
  });
});

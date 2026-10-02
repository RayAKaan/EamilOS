import { describe, expect, it } from 'vitest';
import { AgentRecoveryCoordinator } from './AgentRecoveryCoordinator.js';
import { UniversalAgentRegistry } from './UniversalAgentRegistry.js';

describe('AgentRecoveryCoordinator', () => {
  it('returns a bounded recovery result when no workers are installed', async () => {
    const registry = new UniversalAgentRegistry([]);
    const recovery = new AgentRecoveryCoordinator(registry);
    const result = await recovery.recover({
      request: {
        id: 'request-1', sessionId: 'session-1', prompt: 'test', systemPrompt: '',
        mode: 'execution', workingDir: process.cwd(), timeoutMs: 10,
      },
    }, 3);
    expect(result.success).toBe(false);
    expect(result.attempts).toHaveLength(0);
  });
});

import { describe, it, expect } from 'vitest';
import { CallsignRegistry } from '../core/identity/CallsignRegistry.js';

describe('CallsignRegistry', () => {
  it('should assign callsigns in order', async () => {
    const registry = new CallsignRegistry('./.eamilos/test_session.json');
    await registry.assign(['claude-cli', 'opencode']);
    expect(registry.callsignFor('claude-cli')).toBe('Alpha');
    expect(registry.callsignFor('opencode')).toBe('Beta');
    expect(registry.resolve('Alpha')).toBe('claude-cli');
  });
});

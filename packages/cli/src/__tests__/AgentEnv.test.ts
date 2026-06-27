import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildAgentEnv, buildSafeEnv } from '../core/security/AgentEnv.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe('buildAgentEnv', () => {
  it('includes base safe env vars when present', () => {
    process.env.PATH = '/usr/bin';
    process.env.HOME = '/home/user';
    const env = buildAgentEnv('opencode');
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/user');
    expect(env.NO_COLOR).toBe('true');
  });

  it('does not leak arbitrary env vars', () => {
    process.env.SECRET_TOKEN = 'super-secret';
    const env = buildAgentEnv('opencode');
    expect(env.SECRET_TOKEN).toBeUndefined();
  });

  it('includes provider-specific keys for opencode', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const env = buildAgentEnv('opencode');
    expect(env.OPENAI_API_KEY).toBe('sk-test');
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test');
  });

  it('does not include provider keys for unrelated agents', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const env = buildAgentEnv('ollama');
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('includes extra vars passed as parameter', () => {
    process.env.PATH = '/usr/bin';
    const env = buildAgentEnv('opencode', { EXTRA_VAR: 'extra-value' });
    expect(env.EXTRA_VAR).toBe('extra-value');
  });

  it('extra vars override allowed env vars', () => {
    process.env.PATH = '/usr/bin';
    const env = buildAgentEnv('opencode', { PATH: '/custom/bin' });
    expect(env.PATH).toBe('/custom/bin');
  });

  it('returns NO_COLOR even without base env', () => {
    process.env = {};
    const env = buildAgentEnv('unknown-agent');
    expect(env.NO_COLOR).toBe('true');
  });

  it('handles unknown agent id gracefully', () => {
    process.env.PATH = '/usr/bin';
    const env = buildAgentEnv('non-existent-agent');
    expect(env.PATH).toBe('/usr/bin');
    expect(Object.keys(env)).not.toContain('OPENAI_API_KEY');
  });
});

describe('buildSafeEnv', () => {
  it('includes only base safe vars', () => {
    process.env.PATH = '/usr/bin';
    process.env.OPENAI_API_KEY = 'sk-leaked';
    const env = buildSafeEnv();
    expect(env.PATH).toBe('/usr/bin');
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it('includes extra vars', () => {
    process.env.PATH = '/usr/bin';
    const env = buildSafeEnv({ CUSTOM: 'val' });
    expect(env.CUSTOM).toBe('val');
  });
});

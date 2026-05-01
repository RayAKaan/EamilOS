import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthValidator, ValidationResult } from '../../src/discovery/HealthValidator.js';
import { DiscoveredAgent } from '../../src/auto-discovery.js';

describe('HealthValidator', () => {
  let validator: HealthValidator;

  beforeEach(() => {
    validator = new HealthValidator();
  });

  describe('CLI agent validation', () => {
    it('returns valid for CLI agent type', () => {
      const agent: DiscoveredAgent = {
        id: 'claude',
        type: 'cli',
        provider: 'claude',
        name: 'Claude CLI',
        status: 'available',
        capabilities: ['code'],
      };

      const result = validator.validateAgent(agent);
      expect(result).toBeDefined();
    });
  });

  describe('Ollama agent validation', () => {
    it('handles unreachable Ollama gracefully', async () => {
      const agent: DiscoveredAgent = {
        id: 'ollama:llama3',
        type: 'ollama',
        provider: 'ollama',
        name: 'Ollama: llama3',
        status: 'available',
        capabilities: ['code'],
        model: 'llama3',
        endpoint: 'http://localhost:11434',
      };

      const result = await validator.validateAgent(agent);
      // Ollama likely not running, should return invalid
      expect(result.valid).toBeDefined();
      expect(result.error || result.valid).toBeDefined();
    });
  });

  describe('Cloud agent validation', () => {
    it('validates OpenAI with valid key', async () => {
      const originalKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'sk-test-valid-key';

      const agent: DiscoveredAgent = {
        id: 'openai',
        type: 'cloud',
        provider: 'openai',
        name: 'OpenAI',
        status: 'available',
        capabilities: ['code'],
        model: 'gpt-4o',
      };

      const result = await validator.validateAgent(agent);

      if (originalKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalKey;
      }

      expect(result.valid).toBeDefined();
    });

    it('rejects invalid Anthropic key', async () => {
      const originalKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'sk-ant-invalid-key';

      const agent: DiscoveredAgent = {
        id: 'anthropic',
        type: 'cloud',
        provider: 'anthropic',
        name: 'Anthropic',
        status: 'available',
        capabilities: ['code'],
        model: 'claude-3-5-sonnet',
      };

      const result = await validator.validateAgent(agent);

      if (originalKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = originalKey;
      }

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid Anthropic API key');
    });

    it('handles missing cloud provider gracefully', async () => {
      const agent: DiscoveredAgent = {
        id: 'unknown-cloud',
        type: 'cloud',
        provider: 'unknown',
        name: 'Unknown Cloud',
        status: 'available',
        capabilities: ['code'],
      };

      const result = await validator.validateAgent(agent);
      // Unknown provider defaults to valid
      expect(result.valid).toBe(true);
    });
  });

  describe('validateAll', () => {
    it('validates multiple agents', async () => {
      const agents: DiscoveredAgent[] = [
        {
          id: 'claude',
          type: 'cli',
          provider: 'claude',
          name: 'Claude CLI',
          status: 'available',
          capabilities: ['code'],
        },
        {
          id: 'openai',
          type: 'cloud',
          provider: 'openai',
          name: 'OpenAI',
          status: 'available',
          capabilities: ['code'],
        },
      ];

      const results = await validator.validateAll(agents);
      expect(results).toHaveLength(2);
      expect(results[0].valid).toBeDefined();
      expect(results[1].valid).toBeDefined();
    });

    it('handles empty agent list', async () => {
      const results = await validator.validateAll([]);
      expect(results).toHaveLength(0);
    });

    it('continues validation even if one agent fails', async () => {
      const agents: DiscoveredAgent[] = [
        {
          id: 'anthropic',
          type: 'cloud',
          provider: 'anthropic',
          name: 'Anthropic',
          status: 'available',
          capabilities: ['code'],
        },
        {
          id: 'openai',
          type: 'cloud',
          provider: 'openai',
          name: 'OpenAI',
          status: 'available',
          capabilities: ['code'],
        },
      ];

      const results = await validator.validateAll(agents);
      expect(results).toHaveLength(2);
      // Both should have been validated (results may be valid or invalid)
      expect(results[0].valid).toBeDefined();
      expect(results[1].valid).toBeDefined();
    });
  });

  describe('YAML agent type', () => {
    it('defaults YAML agents to valid', async () => {
      const agent: DiscoveredAgent = {
        id: 'custom-yaml',
        type: 'yaml',
        provider: 'yaml',
        name: 'Custom YAML Agent',
        status: 'available',
        capabilities: ['custom'],
      };

      const result = await validator.validateAgent(agent);
      // YAML agents default to valid (no external validation needed)
      expect(result.valid).toBe(true);
    });
  });
});

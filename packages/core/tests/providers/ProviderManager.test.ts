import { describe, it, expect } from 'vitest';
import { ProviderManager } from '../../src/providers/ProviderManager.js';
import type { LLMProvider, ChatRequest, ChatResponse, ProviderStatus, ModelInfo } from '../../src/providers/types.js';

const mockProvider: LLMProvider = {
  id: 'mock',
  type: 'api',
  engine: 'openai',
  async chat(request: ChatRequest): Promise<ChatResponse> {
    return {
      content: 'ok',
      model: request.model,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      durationMs: 10,
      provider: 'mock',
    };
  },
  async listModels(): Promise<ModelInfo[]> {
    return [{ name: 'gpt-4o-mini', verified: true }];
  },
  async healthCheck(): Promise<ProviderStatus> {
    return {
      id: 'mock',
      type: 'api',
      engine: 'openai',
      available: true,
      latencyMs: 50,
      issues: [],
      models: [{ name: 'gpt-4o-mini', verified: true }],
      capabilities: {
        chat: true,
        streaming: false,
        embeddings: false,
        functionCalling: true,
      },
      lastChecked: new Date(),
      score: 100,
    };
  },
  supportsModel(modelId: string): boolean {
    return modelId === 'gpt-4o-mini';
  },
};

describe('ProviderManager', () => {
  it('should update health scores based on performance', () => {
    const manager = new ProviderManager();
    manager.registerProvider('test-provider', mockProvider);

    manager.updateProviderHealth('test-provider', true, 500);
    expect(manager.getHealthScore('test-provider')).toBeGreaterThan(95);

    manager.updateProviderHealth('test-provider', false, 0);
    expect(manager.getHealthScore('test-provider')).toBeLessThan(80);
  });
});

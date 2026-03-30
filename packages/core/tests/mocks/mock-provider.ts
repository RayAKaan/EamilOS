import type { ModelConfig } from "../../src/index.js";

export type MockProviderPreset = "openai" | "anthropic" | "ollama" | "mock" | "error";

export interface MockLLMResponse {
  content: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  finishReason?: "stop" | "length" | "content_filter" | "error";
}

export interface MockProviderConfig {
  preset: MockProviderPreset;
  responses?: MockLLMResponse[];
  delayMs?: number;
  errorRate?: number;
}

export class MockModelProvider {
  private responses: MockLLMResponse[];
  private delayMs: number;
  private errorRate: number;
  private callCount = 0;

  constructor(config: MockProviderConfig) {
    this.responses = config.responses ?? [{ content: "Mock response" }];
    this.delayMs = config.delayMs ?? 0;
    this.errorRate = config.errorRate ?? 0;
  }

  async complete(prompt: string, _systemPrompt?: string): Promise<MockLLMResponse> {
    await this.delay(this.delayMs);
    this.callCount++;

    if (Math.random() < this.errorRate) {
      throw new Error("Mock provider error");
    }

    const response = this.responses[this.callCount % this.responses.length];
    return {
      ...response,
      content: response.content.replace("{{prompt}}", prompt),
    };
  }

  getConfig(): ModelConfig {
    return {
      provider: "mock",
      model_name: "mock-model",
      api_key: "mock-key",
      max_tokens: 1000,
    };
  }

  getCallCount(): number {
    return this.callCount;
  }

  resetCallCount(): void {
    this.callCount = 0;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function createMockProvider(preset: MockProviderPreset = "mock"): MockModelProvider {
  const configs: Record<MockProviderPreset, MockProviderConfig> = {
    openai: {
      preset: "openai",
      responses: [
        { content: "OpenAI response to: {{prompt}}" },
      ],
    },
    anthropic: {
      preset: "anthropic",
      responses: [
        { content: "Anthropic response to: {{prompt}}" },
      ],
    },
    ollama: {
      preset: "ollama",
      responses: [
        { content: "Ollama response to: {{prompt}}" },
      ],
    },
    mock: {
      preset: "mock",
      responses: [
        { content: "Mock response 1", usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } },
        { content: "Mock response 2", usage: { prompt_tokens: 15, completion_tokens: 25, total_tokens: 40 } },
      ],
    },
    error: {
      preset: "error",
      responses: [],
      errorRate: 1.0,
    },
  };

  return new MockModelProvider(configs[preset]);
}

import { DetectedProvider, ProviderType } from "./types.js";

interface EnvKeyPattern {
  engine: string;
  type: ProviderType;
  baseUrl?: string;
}

const ENV_KEY_PATTERNS: Record<string, EnvKeyPattern> = {
  OPENAI_API_KEY: { engine: "openai", type: "api" },
  ANTHROPIC_API_KEY: { engine: "anthropic", type: "api" },
  GOOGLE_API_KEY: { engine: "google", type: "api" },
  GOOGLE_GENERATIVE_AI_API_KEY: { engine: "google", type: "api" },
  MISTRAL_API_KEY: { engine: "mistral", type: "api" },
  GROQ_API_KEY: {
    engine: "groq",
    type: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
  },
  TOGETHER_API_KEY: {
    engine: "together",
    type: "openai-compatible",
    baseUrl: "https://api.together.xyz/v1",
  },
  DEEPSEEK_API_KEY: {
    engine: "deepseek",
    type: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
  },
  FIREWORKS_API_KEY: {
    engine: "fireworks",
    type: "openai-compatible",
    baseUrl: "https://api.fireworks.ai/inference/v1",
  },
  OPENROUTER_API_KEY: {
    engine: "openrouter",
    type: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
  },
  PERPLEXITY_API_KEY: {
    engine: "perplexity",
    type: "openai-compatible",
    baseUrl: "https://api.perplexity.ai",
  },
};

export class ProviderAutoDetect {
  static async detect(): Promise<DetectedProvider[]> {
    const detected: DetectedProvider[] = [];

    const ollamaResult = await this.checkOllama();
    if (ollamaResult) {
      detected.push(ollamaResult);
    }

    const lmStudioResult = await this.checkLMStudio();
    if (lmStudioResult) {
      detected.push(lmStudioResult);
    }

    const vLLMResult = await this.checkVLLM();
    if (vLLMResult) {
      detected.push(vLLMResult);
    }

    for (const [envVar, config] of Object.entries(ENV_KEY_PATTERNS)) {
      const apiKey = process.env[envVar];
      if (apiKey && apiKey.length > 10) {
        detected.push({
          id: `${config.engine}-auto`,
          type: config.type,
          engine: config.engine,
          baseUrl: config.baseUrl,
          credentials: { apiKey },
          models: [],
          autoDetected: true,
        });
      }
    }

    return detected;
  }

  private static async checkOllama(): Promise<DetectedProvider | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const response = await fetch("http://localhost:11434/api/version", {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        let models: string[] = [];
        try {
          const tagsResponse = await fetch(
            "http://localhost:11434/api/tags",
            { signal: controller.signal }
          );
          if (tagsResponse.ok) {
            const data = (await tagsResponse.json()) as {
              models?: Array<{ name: string }>;
            };
            models = (data.models || []).map((m) => m.name);
          }
        } catch {
          // Could not fetch models
        }

        return {
          id: "ollama-local",
          type: "local",
          engine: "ollama",
          baseUrl: "http://localhost:11434",
          models,
          autoDetected: true,
        };
      }
    } catch {
      // Ollama not available
    }
    return null;
  }

  private static async checkLMStudio(): Promise<DetectedProvider | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const response = await fetch("http://localhost:1234/v1/models", {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = (await response.json()) as {
          data?: Array<{ id: string }>;
        };
        const models = data.data?.map((m) => m.id) || [];

        return {
          id: "lm-studio-local",
          type: "openai-compatible",
          engine: "lm-studio",
          baseUrl: "http://localhost:1234/v1",
          models,
          autoDetected: true,
        };
      }
    } catch {
      // LM Studio not available
    }
    return null;
  }

  private static async checkVLLM(): Promise<DetectedProvider | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const response = await fetch("http://localhost:8000/v1/models", {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = (await response.json()) as {
          data?: Array<{ id: string }>;
        };
        const models = data.data?.map((m) => m.id) || [];

        return {
          id: "vllm-local",
          type: "openai-compatible",
          engine: "vllm",
          baseUrl: "http://localhost:8000/v1",
          models,
          autoDetected: true,
        };
      }
    } catch {
      // vLLM not available
    }
    return null;
  }

  static getEnvKeySuggestions(): Record<string, string[]> {
    const suggestions: Record<string, string[]> = {};

    for (const [envVar, config] of Object.entries(ENV_KEY_PATTERNS)) {
      if (!suggestions[config.engine]) {
        suggestions[config.engine] = [];
      }
      suggestions[config.engine].push(envVar);
    }

    return suggestions;
  }
}

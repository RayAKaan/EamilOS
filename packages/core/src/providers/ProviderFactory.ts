import { ProviderConfig, LLMProvider } from "./types.js";
import { ExplainableError } from "../errors/ExplainableError.js";
import { OpenAICompatibleAdapter } from "./adapters/OpenAICompatibleAdapter.js";
import { OllamaAdapter } from "./adapters/OllamaAdapter.js";
import { AnthropicAdapter } from "./adapters/AnthropicAdapter.js";

export class ProviderFactory {
  static create(config: ProviderConfig): LLMProvider {
    switch (config.type) {
      case "local":
        return this.createLocalProvider(config);

      case "api":
        return this.createApiProvider(config);

      case "openai-compatible":
        return new OpenAICompatibleAdapter(config);

      case "custom":
        return new OpenAICompatibleAdapter(config);

      default:
        throw new ExplainableError({
          code: "UNKNOWN_PROVIDER_TYPE",
          title: `Unknown Provider Type: '${config.type}'`,
          message: `Provider '${config.id}' has type '${config.type}' which is not recognized.`,
          fixes: [
            `Valid types: local, api, openai-compatible, custom`,
            `Most third-party APIs work with type: openai-compatible`,
            `For local models (Ollama), use type: local`,
          ],
        });
    }
  }

  private static createLocalProvider(config: ProviderConfig): LLMProvider {
    switch (config.engine) {
      case "ollama":
      case undefined:
        return new OllamaAdapter(config);

      case "llamacpp":
        return new OpenAICompatibleAdapter({
          ...config,
          type: "openai-compatible",
          baseUrl: config.baseUrl || "http://localhost:8080/v1",
        });

      default:
        return new OpenAICompatibleAdapter({
          ...config,
          type: "openai-compatible",
        });
    }
  }

  private static createApiProvider(config: ProviderConfig): LLMProvider {
    switch (config.engine) {
      case "openai":
      case undefined:
        return new OpenAICompatibleAdapter({
          ...config,
          baseUrl: config.baseUrl || "https://api.openai.com/v1",
        });

      case "anthropic":
        return new AnthropicAdapter(config);

      case "google":
        return new OpenAICompatibleAdapter({
          ...config,
          engine: "google",
          baseUrl: config.baseUrl || "https://generativelanguage.googleapis.com/v1beta",
        });

      case "mistral":
        return new OpenAICompatibleAdapter({
          ...config,
          baseUrl: config.baseUrl || "https://api.mistral.ai/v1",
        });

      case "groq":
        return new OpenAICompatibleAdapter({
          ...config,
          engine: "groq",
          baseUrl: config.baseUrl || "https://api.groq.com/openai/v1",
        });

      case "together":
        return new OpenAICompatibleAdapter({
          ...config,
          engine: "together",
          baseUrl: config.baseUrl || "https://api.together.xyz/v1",
        });

      case "deepseek":
        return new OpenAICompatibleAdapter({
          ...config,
          engine: "deepseek",
          baseUrl: config.baseUrl || "https://api.deepseek.com/v1",
        });

      case "lm-studio":
        return new OpenAICompatibleAdapter({
          ...config,
          engine: "lm-studio",
          baseUrl: config.baseUrl || "http://localhost:1234/v1",
        });

      default:
        return new OpenAICompatibleAdapter({
          ...config,
          type: "openai-compatible",
        });
    }
  }
}

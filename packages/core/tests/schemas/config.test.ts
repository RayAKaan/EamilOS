import { describe, it, expect } from "vitest";
import {
  ModelConfigSchema,
  ProviderConfigSchema,
  ConfigSchema,
} from "../../src/schemas/config.js";

describe("Config Schemas", () => {
  describe("ModelConfigSchema", () => {
    it("validates correct model config", () => {
      const config = {
        id: "gpt-4o",
        tier: "strong" as const,
        context_window: 128000,
      };
      const result = ModelConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("rejects empty id", () => {
      const config = {
        id: "",
        tier: "cheap" as const,
        context_window: 4096,
      };
      const result = ModelConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("rejects invalid tier", () => {
      const config = {
        id: "test",
        tier: "invalid",
        context_window: 4096,
      };
      const result = ModelConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("rejects context_window less than 1", () => {
      const config = {
        id: "test",
        tier: "cheap" as const,
        context_window: 0,
      };
      const result = ModelConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe("ProviderConfigSchema", () => {
    it("validates correct provider config with api_key", () => {
      const config = {
        id: "openai-main",
        type: "openai" as const,
        api_key: "sk-xxx",
        models: [{ id: "gpt-4o", tier: "strong" as const, context_window: 128000 }],
      };
      const result = ProviderConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("validates correct provider config with endpoint", () => {
      const config = {
        id: "ollama-local",
        type: "ollama" as const,
        endpoint: "http://localhost:11434",
        models: [{ id: "llama3", tier: "cheap" as const, context_window: 8192 }],
      };
      const result = ProviderConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("rejects empty id", () => {
      const config = {
        id: "",
        type: "openai" as const,
        models: [],
      };
      const result = ProviderConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("rejects invalid provider type", () => {
      const config = {
        id: "test",
        type: "unknown",
        models: [],
      };
      const result = ProviderConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("rejects empty models array", () => {
      const config = {
        id: "test",
        type: "openai" as const,
        models: [],
      };
      const result = ProviderConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("accepts rate_limit_rpm", () => {
      const config = {
        id: "test",
        type: "openai" as const,
        rate_limit_rpm: 500,
        models: [{ id: "gpt-4o", tier: "strong" as const, context_window: 128000 }],
      };
      const result = ProviderConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe("ConfigSchema", () => {
    it("validates minimal valid config", () => {
      const config = {
        providers: [
          {
            id: "openai",
            type: "openai" as const,
            models: [{ id: "gpt-4o", tier: "strong" as const, context_window: 128000 }],
          },
        ],
        routing: {
          fallback_order: ["openai"],
        },
        workspace: {
          base_dir: "./data/projects",
          git_enabled: true,
          max_file_size_mb: 10,
          max_workspace_size_mb: 500,
        },
        budget: {
          max_tokens_per_task: 50000,
          max_cost_per_project_usd: 5.0,
          warn_at_percentage: 80,
        },
        settings: {
          max_parallel_tasks: 3,
          task_timeout_seconds: 300,
          model_call_timeout_seconds: 120,
          preview_mode: true,
          auto_retry: true,
        },
        logging: {
          level: "info" as const,
          console: true,
          live: true,
        },
      };
      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("applies default values", () => {
      const config = {
        providers: [
          {
            id: "openai",
            type: "openai" as const,
            models: [{ id: "gpt-4o", tier: "strong" as const, context_window: 128000 }],
          },
        ],
        routing: {
          fallback_order: ["openai"],
        },
        workspace: {
          base_dir: "./data/projects",
          git_enabled: true,
          max_file_size_mb: 10,
          max_workspace_size_mb: 500,
        },
        budget: {
          max_tokens_per_task: 50000,
          max_cost_per_project_usd: 5.0,
          warn_at_percentage: 80,
        },
        settings: {
          max_parallel_tasks: 3,
          task_timeout_seconds: 300,
          model_call_timeout_seconds: 120,
          preview_mode: true,
          auto_retry: true,
        },
        logging: {
          level: "info" as const,
          console: true,
          live: true,
        },
      };
      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBe(1);
        expect(result.data.routing.default_tier).toBe("cheap");
        expect(result.data.settings.preview_mode).toBe(true);
        expect(result.data.logging.live).toBe(true);
      }
    });

    it("rejects invalid log level", () => {
      const config = {
        providers: [
          {
            id: "openai",
            type: "openai" as const,
            models: [{ id: "gpt-4o", tier: "strong" as const, context_window: 128000 }],
          },
        ],
        routing: {
          fallback_order: ["openai"],
        },
        logging: {
          level: "invalid",
        },
      };
      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("rejects warn_at_percentage outside 0-100", () => {
      const config = {
        providers: [
          {
            id: "openai",
            type: "openai" as const,
            models: [{ id: "gpt-4o", tier: "strong" as const, context_window: 128000 }],
          },
        ],
        routing: {
          fallback_order: ["openai"],
        },
        budget: {
          warn_at_percentage: 150,
        },
      };
      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("validates full config with all options", () => {
      const config = {
        version: 1,
        providers: [
          {
            id: "openai",
            type: "openai" as const,
            api_key: "sk-xxx",
            rate_limit_rpm: 500,
            models: [{ id: "gpt-4o", tier: "strong" as const, context_window: 128000 }],
          },
          {
            id: "ollama",
            type: "ollama" as const,
            endpoint: "http://localhost:11434",
            models: [{ id: "llama3", tier: "cheap" as const, context_window: 8192 }],
          },
        ],
        routing: {
          default_tier: "strong",
          task_routing: { research: "cheap", coding: "strong" },
          fallback_order: ["openai", "ollama"],
        },
        workspace: {
          base_dir: "./data/projects",
          git_enabled: true,
          max_file_size_mb: 10,
          max_workspace_size_mb: 500,
        },
        budget: {
          max_tokens_per_task: 50000,
          max_cost_per_project_usd: 10.0,
          warn_at_percentage: 80,
        },
        settings: {
          max_parallel_tasks: 5,
          task_timeout_seconds: 600,
          model_call_timeout_seconds: 180,
          preview_mode: false,
          auto_retry: true,
        },
        logging: {
          level: "debug",
          console: true,
          file: "./logs/eamilos.log",
          max_file_size_mb: 100,
          max_files: 10,
          live: false,
        },
      };
      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });
});

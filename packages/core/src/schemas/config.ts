import { z } from 'zod';

export const ModelConfigSchema = z.object({
  id: z.string().min(1),
  tier: z.enum(['cheap', 'strong']),
  context_window: z.number().int().min(1),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const ProviderConfigSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['openai', 'ollama', 'anthropic', 'google', 'custom']),
  api_key: z.string().optional(),
  endpoint: z.string().optional(),
  models: z.array(ModelConfigSchema).min(1),
  rate_limit_rpm: z.number().int().optional(),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const ConfigSchema = z.object({
  version: z.number().int().min(1).default(1),
  providers: z.array(ProviderConfigSchema).min(1),
  routing: z.object({
    default_tier: z.enum(['cheap', 'strong']).default('cheap'),
    task_routing: z.record(z.enum(['cheap', 'strong'])).default({}),
    fallback_order: z.array(z.string()).min(1),
  }),
  workspace: z.object({
    base_dir: z.string().default('./data/projects'),
    git_enabled: z.boolean().default(true),
    max_file_size_mb: z.number().min(1).default(10),
    max_workspace_size_mb: z.number().min(1).default(500),
  }),
  budget: z.object({
    max_tokens_per_task: z.number().int().min(1).default(50000),
    max_cost_per_project_usd: z.number().min(0).default(5.0),
    warn_at_percentage: z.number().min(0).max(100).default(80),
  }),
  settings: z.object({
    max_parallel_tasks: z.number().int().min(1).default(3),
    task_timeout_seconds: z.number().int().min(1).default(300),
    model_call_timeout_seconds: z.number().int().min(1).default(120),
    preview_mode: z.boolean().default(true),
    auto_retry: z.boolean().default(true),
  }),
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    console: z.boolean().default(true),
    file: z.string().optional(),
    max_file_size_mb: z.number().min(1).default(50),
    max_files: z.number().int().min(1).default(5),
    live: z.boolean().default(true),
  }),
});

export type EamilOSConfig = z.infer<typeof ConfigSchema>;

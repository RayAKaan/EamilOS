import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import * as fs from 'fs';

export class ConfigWriter {
  static write(config: Record<string, unknown>, filePath: string): void {
    const yamlContent = yamlStringify(config, {
      indent: 2,
      lineWidth: 0,
      defaultKeyType: 'PLAIN',
      defaultStringType: 'PLAIN',
    });

    let reparsed: unknown;
    try {
      reparsed = yamlParse(yamlContent);
    } catch (parseError) {
      throw new Error(
        `YAML generation produced invalid output. ` +
        `This is a bug in ConfigWriter. ` +
        `Error: ${parseError instanceof Error ? parseError.message : String(parseError)}\n` +
        `Generated YAML:\n${yamlContent}`
      );
    }

    const original = config as Record<string, unknown>;
    const parsed = reparsed as Record<string, unknown>;

    if (original.provider && parsed.provider !== original.provider) {
      throw new Error(
        `YAML round-trip corrupted 'provider': ` +
        `wrote '${original.provider}', read back '${parsed.provider}'`
      );
    }

    if (original.model && parsed.model !== original.model) {
      throw new Error(
        `YAML round-trip corrupted 'model': ` +
        `wrote '${original.model}', read back '${parsed.model}'`
      );
    }

    const header = [
      '# EamilOS Configuration',
      `# Generated: ${new Date().toISOString()}`,
      '#',
      '# Edit this file or run: eamilos setup',
      '',
    ].join('\n');

    const finalContent = header + yamlContent;

    const tempPath = filePath + '.tmp.' + Date.now();
    fs.writeFileSync(tempPath, finalContent, 'utf-8');

    try {
      yamlParse(fs.readFileSync(tempPath, 'utf-8'));
    } catch {
      fs.unlinkSync(tempPath);
      throw new Error('Written file is not valid YAML — write aborted');
    }

    if (fs.existsSync(filePath)) {
      const backupPath = filePath + '.backup';
      fs.copyFileSync(filePath, backupPath);
    }

    fs.renameSync(tempPath, filePath);
  }

  static generateDefault(provider: string, model: string): Record<string, unknown> {
    const config: Record<string, unknown> = {
      provider,
      model,
      mode: 'auto',
      debug: false,
    };

    config.routing = {
      mode: 'auto',
      default_tier: 'cheap',
      task_routing: {},
      fallback_order: [provider],
      exploration_rate: 0.1,
      minimum_data_points: 5,
      overrides: {},
      default_model: model,
      default_provider: provider,
    };

    config.features = {
      self_healing_routing: {
        enabled: true,
        failure_threshold: 3,
        cooldown_minutes: 30,
      },
      adaptive_prompting: {
        enabled: true,
        strategy: 'per_model',
      },
    };

    config.workspace = {
      base_dir: './data/projects',
      git_enabled: true,
      max_file_size_mb: 10,
      max_workspace_size_mb: 500,
    };

    config.budget = {
      max_tokens_per_task: 50000,
      max_cost_per_project_usd: 5.0,
      warn_at_percentage: 80,
    };

    config.settings = {
      max_parallel_tasks: 3,
      task_timeout_seconds: 300,
      model_call_timeout_seconds: 120,
      preview_mode: true,
      auto_retry: true,
    };

    config.logging = {
      level: 'info',
      console: true,
      live: true,
    };

    return config;
  }
}

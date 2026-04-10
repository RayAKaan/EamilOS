import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parse } from 'yaml';
import { ConfigNormalizer } from '@eamilos/core';
import { OllamaDetector } from '@eamilos/core';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  config?: Record<string, unknown>;
  normalized?: Record<string, unknown>;
}

export interface ValidationError {
  field: string;
  message: string;
  suggestion?: string;
}

export interface ValidationWarning {
  field: string;
  message: string;
  suggestion?: string;
}

export async function validateCommand(options: {
  config?: string;
  verbose: boolean;
}): Promise<void> {
  console.log('\n  EamilOS Config Validator\n');
  console.log('  ' + '─'.repeat(50));

  const configPath = options.config || findDefaultConfigPath();

  if (!configPath) {
    console.log('\n  ❌ No config file found\n');
    console.log('  Searched locations:');
    const searchPaths = getSearchPaths();
    for (const p of searchPaths) {
      console.log(`    - ${p}`);
    }
    console.log('\n  Run "eamilos setup" to create a configuration.\n');
    return;
  }

  console.log(`\n  Config: ${configPath}\n`);

  const result = await validateConfig(configPath);

  let errors = 0;

  if (result.errors.length > 0) {
    console.log('  ❌ ERRORS\n');
    for (const err of result.errors) {
      console.log(`    • ${err.field}: ${err.message}`);
      if (err.suggestion) {
        console.log(`      Fix: ${err.suggestion}`);
      }
    }
    console.log('');
    errors = result.errors.length;
  }

  if (options.verbose && result.warnings.length > 0) {
    console.log('  ⚠️  WARNINGS\n');
    for (const warn of result.warnings) {
      console.log(`    • ${warn.field}: ${warn.message}`);
    }
    console.log('');
  }

  if (options.verbose && result.config) {
    console.log('  CONFIGURATION\n');
    console.log(`    Provider: ${result.config.provider || 'not set'}`);
    console.log(`    Model: ${result.config.model || 'not set'}`);

    if (result.config.routing) {
      const routing = result.config.routing as Record<string, unknown>;
      console.log(`    Routing mode: ${routing.mode || 'auto'}`);
    }

    if (result.config.providers) {
      const providers = result.config.providers as unknown[];
      console.log(`    Providers: ${providers.length}`);
    }

    console.log('');
  }

  console.log('  ' + '─'.repeat(50));

  if (result.valid) {
    console.log(`\n  ✅ Config is valid`);

    if (options.verbose) {
      const normalizer = new ConfigNormalizer();
      const raw = parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
      const normalized = normalizer.normalize(raw);

      console.log(`\n  Normalized config:`);
      console.log(`    Default provider: ${normalized.defaultProvider}`);
      console.log(`    Default model: ${normalized.defaultModel}`);
      console.log(`    Providers: ${normalized.providers.length}`);

      for (const p of normalized.providers) {
        console.log(`      - ${p.id} (${p.type}): ${p.models.length} model(s)`);
      }
    }

    console.log('\n');
  } else {
    console.log(`\n  ❌ Config has ${errors} error(s)\n`);
    console.log('  Run "eamilos setup" to regenerate a valid config.\n');
  }
}

export async function validateConfig(configPath: string): Promise<ValidationResult> {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  if (!fs.existsSync(configPath)) {
    result.valid = false;
    result.errors.push({
      field: 'config',
      message: 'Config file not found',
      suggestion: 'Run "eamilos setup" to create one',
    });
    return result;
  }

  let raw: Record<string, unknown>;
  try {
    raw = parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  } catch (e) {
    result.valid = false;
    result.errors.push({
      field: 'yaml',
      message: 'Invalid YAML syntax',
      suggestion: 'Check for syntax errors in the file',
    });
    return result;
  }

  result.config = raw;

  if (!raw.provider && !raw.providers) {
    result.valid = false;
    result.errors.push({
      field: 'provider',
      message: 'No provider specified',
      suggestion: 'Add "provider: ollama" or configure providers array',
    });
  }

  if (!raw.model && !raw.models) {
    result.valid = false;
    result.errors.push({
      field: 'model',
      message: 'No model specified',
      suggestion: 'Add "model: phi3:mini" or configure models array',
    });
  }

  const normalizer = new ConfigNormalizer();
  const normalized = normalizer.normalize(raw);

  const warnings = normalizer.getWarnings();
  if (warnings.length > 0) {
    for (const w of warnings) {
      result.warnings.push({
        field: 'format',
        message: w,
      });
    }
  }

  if (normalized.providers.length === 0) {
    result.valid = false;
    result.errors.push({
      field: 'providers',
      message: 'No valid providers in config',
      suggestion: 'Configure at least one provider (ollama or openai)',
    });
  }

  for (const provider of normalized.providers) {
    if (provider.type === 'ollama' && !provider.endpoint) {
      result.warnings.push({
        field: `provider:${provider.id}`,
        message: 'Ollama provider missing endpoint — using default localhost:11434',
      });
    }

    if (provider.type === 'openai') {
      const hasApiKey = (raw.providers as unknown[])?.some(
        (p: unknown) =>
          (p as Record<string, unknown>).type === 'openai' &&
          (p as Record<string, unknown>).api_key
      );

      if (!hasApiKey && !process.env.OPENAI_API_KEY) {
        result.warnings.push({
          field: `provider:${provider.id}`,
          message: 'OpenAI provider needs api_key or OPENAI_API_KEY environment variable',
        });
      }
    }
  }

  if (normalized.providers.some((p) => p.type === 'ollama')) {
    const detector = new OllamaDetector();
    const status = await detector.detect();

    if (!status.running) {
      result.warnings.push({
        field: 'ollama',
        message: 'Ollama is not running — provider may not work',
        suggestion: 'Start Ollama: ollama serve',
      });
    } else if (status.models.length === 0) {
      result.warnings.push({
        field: 'ollama',
        message: 'Ollama has no models installed',
        suggestion: 'Install a model: ollama pull phi3:mini',
      });
    } else {
      const configuredModel = normalized.defaultModel;
      const hasModel = status.models.some((m) => m.name === configuredModel);

      if (!hasModel) {
        result.warnings.push({
          field: 'model',
          message: `Default model "${configuredModel}" not installed in Ollama`,
          suggestion: `Available: ${status.models.map((m) => m.name).join(', ')}`,
        });
      }
    }
  }

  result.normalized = normalized as unknown as Record<string, unknown>;

  return result;
}

function findDefaultConfigPath(): string | null {
  const paths = getSearchPaths();

  for (const p of paths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

function getSearchPaths(): string[] {
  const homeDir = os.homedir();
  return [
    path.join(process.cwd(), 'eamilos.yaml'),
    path.join(process.cwd(), '.eamilos.yaml'),
    path.join(homeDir, '.config', 'eamilos', 'config.yaml'),
    path.join(homeDir, '.eamilos.yaml'),
    path.join(homeDir, '.config', 'eamilos', 'eamilos.yaml'),
    path.join(process.cwd(), 'eamilos.config.yaml'),
    path.join(process.cwd(), '.eamilos.config.yaml'),
  ];
}

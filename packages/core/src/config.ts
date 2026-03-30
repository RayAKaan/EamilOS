import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { ConfigSchema, EamilOSConfig } from './schemas/config.js';

export class ConfigLoader {
  private config: EamilOSConfig | null = null;
  private configPath: string;

  constructor(configPath: string = 'eamilos.config.yaml') {
    this.configPath = configPath;
  }

  load(): EamilOSConfig {
    if (this.config) {
      return this.config;
    }

    const content = readFileSync(this.configPath, 'utf-8');
    const resolved = this.resolveEnvVars(content);
    const parsed = parse(resolved) as unknown;

    const result = ConfigSchema.safeParse(parsed);

    if (!result.success) {
      const errors = result.error.errors.map(
        (e) => `  - ${e.path.join('.')}: ${e.message}`
      );
      throw new Error(
        `Config validation failed:\n${errors.join('\n')}`
      );
    }

    this.config = result.data;
    return this.config;
  }

  private resolveEnvVars(content: string): string {
    return content.replace(/\$\{([^}]+)\}/g, (_match, varName) => {
      const value = process.env[varName];
      if (value === undefined) {
        console.warn(`Warning: Environment variable ${varName} is not set`);
        return '';
      }
      return value;
    });
  }

  get(): EamilOSConfig {
    if (!this.config) {
      return this.load();
    }
    return this.config;
  }
}

let globalConfig: EamilOSConfig | null = null;

export function loadConfig(configPath?: string): EamilOSConfig {
  if (globalConfig) {
    return globalConfig;
  }
  const loader = new ConfigLoader(configPath);
  globalConfig = loader.load();
  return globalConfig;
}

export function getConfig(): EamilOSConfig {
  if (!globalConfig) {
    return loadConfig();
  }
  return globalConfig;
}

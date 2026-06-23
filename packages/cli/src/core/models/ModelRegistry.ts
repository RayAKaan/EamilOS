import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { PreflightTester } from './PreflightTester.js';
import { SecureLogger } from '../security/SecureLogger.js';
import type { ModelProfile, ExecutionStrategy } from './types.js';

export const TOOL_SYSTEM_PROMPT = `You are a code generation assistant with tool-calling capabilities.
When asked to create files, use the provided tools to write them.
Always provide complete, working code.`;

export const STRICT_JSON_SYSTEM_PROMPT = `You are a code generation assistant.
You MUST output ONLY valid JSON. No exceptions.

Required format:
{
  "summary": "brief description",
  "files": [
    {
      "path": "real_filename.ext",
      "content": "complete file content",
      "language": "language_name"
    }
  ]
}

RULES:
1. Output MUST be valid JSON parseable by JSON.parse()
2. files array MUST have at least one entry
3. path MUST be a real filename with extension — NOT data.json or output.txt
4. content MUST be the COMPLETE file content, not a description

DO NOT add any text before or after the JSON.
DO NOT use markdown code blocks.
DO NOT explain anything.

Your response will be machine-parsed. Deviations cause rejection.`;

export const NUCLEAR_JSON_SYSTEM_PROMPT = `JSON ONLY. No text. No markdown. No explanation.

Format: {"summary":"...","files":[{"path":"filename.ext","content":"code here","language":"lang"}]}

ONLY output the JSON object. Nothing else. Your output goes directly to JSON.parse().
If it fails to parse, your response is thrown away.`;

export class ModelRegistry {
  private profiles: Map<string, ModelProfile> = new Map();
  private preflightTester: PreflightTester;
  private logger: SecureLogger;
  private cacheDir: string = '.eamilos/model-profiles';

  constructor(logger: SecureLogger) {
    this.logger = logger;
    this.preflightTester = new PreflightTester();
    
    try {
      if (!existsSync(this.cacheDir)) {
        mkdirSync(this.cacheDir, { recursive: true });
      }
    } catch {
      this.logger.debug('Could not create model profiles cache directory');
    }
  }

  async getOrCreateProfile(provider: string, modelName: string): Promise<ModelProfile> {
    const cacheKey = `${provider}:${modelName}`;

    if (this.profiles.has(cacheKey)) {
      this.logger.debug(`Using cached profile for ${cacheKey}`);
      return this.profiles.get(cacheKey)!;
    }

    const cachedProfile = this.loadFromFileCache(provider, modelName);
    if (cachedProfile && this.isCacheValid(cachedProfile)) {
      this.logger.debug(`Using file cache for ${cacheKey}`);
      this.profiles.set(cacheKey, cachedProfile);
      return cachedProfile;
    }

    this.logger.info(`Running preflight test for ${cacheKey}`);
    const profile = await this.preflightTester.testModel(provider, modelName);

    this.saveToFileCache(provider, modelName, profile);
    this.profiles.set(cacheKey, profile);

    return profile;
  }

  getExecutionStrategy(profile: ModelProfile): ExecutionStrategy {
    if (profile.supportsTools && profile.reliabilityScore >= 0.8) {
      return {
        mode: 'tool',
        promptStrictness: 'normal',
        maxRetries: 3,
        retryDelayMs: 0,
        requiresTaskSplitting: false,
        maxTaskSizeChars: 50000,
        systemPrompt: TOOL_SYSTEM_PROMPT,
      };
    }

    if (profile.supportsJSON && profile.reliabilityScore >= 0.5) {
      return {
        mode: 'json_strict',
        promptStrictness: 'strict',
        maxRetries: 4,
        retryDelayMs: 500,
        requiresTaskSplitting: false,
        maxTaskSizeChars: 10000,
        systemPrompt: STRICT_JSON_SYSTEM_PROMPT,
      };
    }

    return {
      mode: 'json_nuclear',
      promptStrictness: 'nuclear',
      maxRetries: 5,
      retryDelayMs: 1000,
      requiresTaskSplitting: true,
      maxTaskSizeChars: 3000,
      systemPrompt: NUCLEAR_JSON_SYSTEM_PROMPT,
    };
  }

  private loadFromFileCache(provider: string, modelName: string): ModelProfile | null {
    const cacheFile = this.getCacheFilePath(provider, modelName);
    
    try {
      if (existsSync(cacheFile)) {
        const content = readFileSync(cacheFile, 'utf-8');
        return JSON.parse(content);
      }
    } catch {
      this.logger.debug(`Could not load cache from ${cacheFile}`);
    }
    
    return null;
  }

  private saveToFileCache(provider: string, modelName: string, profile: ModelProfile): void {
    const cacheFile = this.getCacheFilePath(provider, modelName);
    
    try {
      writeFileSync(cacheFile, JSON.stringify(profile, null, 2), 'utf-8');
    } catch {
      this.logger.debug(`Could not save cache to ${cacheFile}`);
    }
  }

  private getCacheFilePath(provider: string, modelName: string): string {
    const safeName = modelName.replace(/[^a-zA-Z0-9]/g, '_');
    return `${this.cacheDir}/${provider}_${safeName}.json`;
  }

  private isCacheValid(profile: ModelProfile): boolean {
    const cacheAge = Date.now() - new Date(profile.testedAt).getTime();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    return cacheAge < maxAge;
  }
}

let globalModelRegistry: ModelRegistry | null = null;

export function initModelRegistry(logger: SecureLogger): ModelRegistry {
  globalModelRegistry = new ModelRegistry(logger);
  return globalModelRegistry;
}

export function getModelRegistry(): ModelRegistry {
  if (!globalModelRegistry) {
    throw new Error('ModelRegistry not initialized. Call initModelRegistry first.');
  }
  return globalModelRegistry;
}

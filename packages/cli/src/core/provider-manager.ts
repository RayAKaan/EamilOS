import { getConfig } from './config.js';
import { Logger, getLogger } from './logger.js';
import { createOpenAIProvider, LLMProvider } from './providers/openai.js';
import { createOllamaProvider } from './providers/ollama.js';
import { ToolDefinition } from './providers/types.js';
import { ChatMessage } from './types.js';

export interface ProviderInfo {
  id: string;
  type: string;
  model: string;
  available: boolean;
  supportsTools: boolean;
}

export class ProviderManager {
  private logger: Logger;
  private providers: Map<string, LLMProvider> = new Map();
  private defaultProvider: string | null = null;
  private providerModels: Map<string, string> = new Map();

  constructor() {
    this.logger = getLogger();
    this.initializeProviders();
  }

  private initializeProviders(): void {
    const config = getConfig();

    for (const providerConfig of config.providers) {
      if (providerConfig.type === 'openai' && providerConfig.api_key) {
        const model = providerConfig.models[0]?.id || 'gpt-4o-mini';
        const provider = createOpenAIProvider(providerConfig.api_key, model);
        this.providers.set(providerConfig.id, provider);
        
        if (!this.defaultProvider) {
          this.defaultProvider = providerConfig.id;
        }
        
        this.logger.debug(`Initialized OpenAI provider: ${providerConfig.id} with model ${model}`);
      } else if (providerConfig.type === 'ollama' && providerConfig.endpoint) {
        const model = providerConfig.models[0]?.id || 'phi3:mini';
        const provider = createOllamaProvider(providerConfig.endpoint, model);
        this.providers.set(providerConfig.id, provider);
        this.providerModels.set(providerConfig.id, model);
        
        if (!this.defaultProvider) {
          this.defaultProvider = providerConfig.id;
        }
        
        this.logger.debug(`Initialized Ollama provider: ${providerConfig.id} with model ${model}`);
      }
    }

    if (this.providers.size === 0) {
      this.logger.warn('No LLM providers configured');
    }
  }

  getProvider(id?: string): LLMProvider | null {
    const providerId = id || this.defaultProvider;
    if (!providerId) {
      return null;
    }
    return this.providers.get(providerId) || null;
  }

  getProviders(): ProviderInfo[] {
    const config = getConfig();
    return config.providers.map((p) => {
      const model = this.providerModels.get(p.id) || p.models[0]?.id || 'unknown';
      const type = p.type;
      return {
        id: p.id,
        type,
        model,
        available: this.providers.has(p.id),
        supportsTools: this.checkSupportsTools(type, model),
      };
    });
  }

  getProviderInfo(id: string): ProviderInfo | null {
    const providers = this.getProviders();
    return providers.find((p) => p.id === id) ?? null;
  }

  private checkSupportsTools(type: string, model: string): boolean {
    if (type === 'ollama') {
      const modelLower = model.toLowerCase();
      const modelsWithoutTools = ['phi3', 'phi3:mini', 'phi3:medium', 'llama2', 'llama3', 'mistral', 'codellama'];
      return !modelsWithoutTools.some(m => modelLower.includes(m));
    }
    return type === 'openai';
  }

  supportsTools(providerId?: string): boolean {
    const id = providerId || this.defaultProvider;
    if (!id) return false;
    
    const provider = this.providers.get(id);
    if (!provider) return false;
    
    const config = getConfig();
    const providerConfig = config.providers.find(p => p.id === id);
    if (!providerConfig) return false;
    
    const model = this.providerModels.get(id) || providerConfig.models[0]?.id || 'unknown';
    return this.checkSupportsTools(providerConfig.type, model);
  }

  async checkAvailability(id: string): Promise<boolean> {
    const provider = this.providers.get(id);
    if (!provider) {
      return false;
    }

    try {
      await provider.chatSimple('Hello', 'You are a test assistant.');
      return true;
    } catch {
      return false;
    }
  }

  async chat(messages: ChatMessage[], tools?: ToolDefinition[], providerId?: string): Promise<{
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  }> {
    const provider = this.getProvider(providerId);
    if (!provider) {
      throw new Error('No LLM provider available. Configure a provider in your config.');
    }

    const filteredMessages = messages.filter((m) => m.role !== 'tool' || m.tool_call_id);
    const response = await provider.chat(filteredMessages, tools);
    return {
      content: response.content,
      toolCalls: response.toolCalls,
    };
  }
}

let globalProviderManager: ProviderManager | null = null;

export function initProviderManager(): ProviderManager {
  globalProviderManager = new ProviderManager();
  return globalProviderManager;
}

export function getProviderManager(): ProviderManager {
  if (!globalProviderManager) {
    return initProviderManager();
  }
  return globalProviderManager;
}

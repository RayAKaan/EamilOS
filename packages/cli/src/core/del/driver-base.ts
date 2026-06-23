import {
  ProviderDriver,
  ProviderHealth,
  ExecutionRequest,
  RawProviderOutput,
  ProviderCapability,
  ProviderType,
} from './provider-types.js';

export abstract class BaseProviderDriver implements ProviderDriver {
  abstract id: string;
  abstract name: string;
  abstract type: ProviderType;
  abstract capabilities: ProviderCapability[];
  protected initialized = false;
  protected config: Record<string, unknown> = {};

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = config;
    this.initialized = true;
  }

  abstract healthCheck(): Promise<ProviderHealth>;

  abstract execute(request: ExecutionRequest): Promise<RawProviderOutput>;

  async terminate(): Promise<void> {
    this.initialized = false;
  }

  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(`Driver ${this.id} not initialized. Call initialize() first.`);
    }
  }

  protected getConfig<T>(key: string, defaultValue: T): T {
    return (this.config[key] as T) ?? defaultValue;
  }
}

export abstract class ApiDriver extends BaseProviderDriver {
  type: ProviderType = 'api';

  protected getApiKey(envVar: string): string {
    const apiKey = process.env[envVar];
    if (!apiKey) {
      throw new Error(`${envVar} not set`);
    }
    return apiKey;
  }

  protected getBaseUrl(): string {
    return this.getConfig('baseUrl', 'https://api.openai.com/v1');
  }

  protected async makeRequest<T>(path: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<T> {
    const url = `${this.getBaseUrl()}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response.json() as Promise<T>;
  }
}

export abstract class LocalDriver extends BaseProviderDriver {
  type: ProviderType = 'local';

  protected getBaseUrl(): string {
    return this.getConfig('baseUrl', 'http://localhost:11434');
  }

  protected getModel(): string {
    return this.getConfig('model', 'llama3');
  }

  protected async makeRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.getBaseUrl()}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Local provider error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  protected createTimeoutPromise<T>(ms: number, errorMsg: string): Promise<T> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(errorMsg)), ms)
    );
  }
}
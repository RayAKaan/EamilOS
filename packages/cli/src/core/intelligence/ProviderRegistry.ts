import type { IntelligenceProvider } from './IntelligenceRuntimeTypes.js';

export class IntelligenceProviderRegistry {
  private readonly providers = new Map<string, IntelligenceProvider>();

  register(provider: IntelligenceProvider): void {
    if (this.providers.has(provider.id)) throw new Error(`Intelligence provider already registered: ${provider.id}`);
    this.providers.set(provider.id, provider);
  }

  replace(provider: IntelligenceProvider): void {
    this.providers.set(provider.id, provider);
  }

  unregister(providerId: string): boolean {
    return this.providers.delete(providerId);
  }

  get(providerId: string): IntelligenceProvider | undefined {
    return this.providers.get(providerId);
  }

  list(): IntelligenceProvider[] {
    return [...this.providers.values()];
  }
}

import type { IntelligenceHealth, IntelligenceProvider } from './IntelligenceRuntimeTypes.js';
import { IntelligenceProviderRegistry } from './ProviderRegistry.js';

export class IntelligenceLifecycleManager {
  constructor(private readonly registry: IntelligenceProviderRegistry) {}

  async initialize(): Promise<void> {
    for (const provider of this.registry.list()) {
      try {
        await provider.initialize();
      } catch {
        // Provider health exposes initialization failure without preventing core startup.
      }
    }
  }

  async health(): Promise<IntelligenceHealth[]> {
    const results: IntelligenceHealth[] = [];
    for (const provider of this.registry.list()) {
      try {
        results.push(await provider.health());
      } catch (error) {
        results.push({
          providerId: provider.id,
          status: 'FAILED',
          checkedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
          capabilities: provider.capabilities(),
        });
      }
    }
    return results;
  }

  async shutdown(): Promise<void> {
    for (const provider of this.registry.list().reverse()) {
      try {
        await provider.shutdown();
      } catch {
        // Shutdown is best-effort; one provider must not block the rest.
      }
    }
  }
}

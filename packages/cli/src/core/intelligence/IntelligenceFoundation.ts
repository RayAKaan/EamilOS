import type { ExecutionStore } from '../execution/ExecutionStore.js';
import type { DecisionStore } from './DecisionStore.js';
import { ContextCompiler } from './ContextCompiler.js';
import { IntelligenceRuntime } from './IntelligenceRuntime.js';
import { IntelligenceProviderRegistry } from './ProviderRegistry.js';
import type { IntelligenceEventSink, IntelligenceRuntime as IntelligenceRuntimeContract } from './IntelligenceRuntimeTypes.js';
import { IntelligenceRouter } from './IntelligenceRouter.js';
import { IntelligenceLifecycleManager } from './IntelligenceLifecycleManager.js';
import type { JevProvider, LayaModelAdapter } from './types.js';
import { LegacyJevProviderAdapter, LegacyLayaProviderAdapter } from './providers/LegacyProviderAdapters.js';
import { DeterministicIntelligenceProvider } from './DeterministicIntelligenceProvider.js';

export interface IntelligenceFoundation {
  runtime: IntelligenceRuntimeContract;
  registry: IntelligenceProviderRegistry;
  compiler: ContextCompiler;
  lifecycle: IntelligenceLifecycleManager;
}

export interface IntelligenceFoundationOptions {
  jev?: JevProvider;
  laya?: LayaModelAdapter;
  events?: IntelligenceEventSink;
}

export function createIntelligenceFoundation(options: IntelligenceFoundationOptions = {}): IntelligenceFoundation {
  const registry = new IntelligenceProviderRegistry();
  if (options.jev) registry.register(new LegacyJevProviderAdapter(options.jev));
  if (options.laya) registry.register(new LegacyLayaProviderAdapter(options.laya));
  registry.register(new DeterministicIntelligenceProvider());
  const lifecycle = new IntelligenceLifecycleManager(registry);
  const runtime = new IntelligenceRuntime(registry, new IntelligenceRouter(registry), lifecycle, undefined, options.events);
  return { runtime, registry, compiler: new ContextCompiler(), lifecycle };
}

export type IntelligenceFoundationStores = {
  executions?: ExecutionStore;
  decisions?: DecisionStore;
};

import { EventEmitter } from 'node:events';
import { CapabilityRegistry, type CapabilityKey } from './CapabilityRegistry.js';
import type { RuntimeEventPayloadMap, RuntimeEventName } from './RuntimeEventVocabulary.js';
import { RuntimeDependencyGraph, type PluginDependencyDescriptor } from './RuntimeDependencyGraph.js';

export interface PluginContext {
  readonly id: string;
  readonly runtime: PluginRuntime;
  readonly signal: AbortSignal;
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  resolve<T>(key: CapabilityKey<T>): T;
  provide<T>(key: CapabilityKey<T>, value: T): () => void;
  on<K extends RuntimeEventName>(event: K, listener: (payload: RuntimeEventPayloadMap[K]) => void): () => void;
  emit<K extends RuntimeEventName>(event: K, payload: RuntimeEventPayloadMap[K]): void;
  effect(dispose: () => void | Promise<void>): () => void;
}

interface InstalledPlugin {
  name: string;
  disposers: Array<() => void | Promise<void>>;
  descriptor: PluginDependencyDescriptor;
}

export interface EamilOSPlugin extends PluginDependencyDescriptor {
  readonly name: string;
  readonly inject?: readonly string[];
  readonly provides?: readonly string[];
  setup(ctx: PluginContext): void | (() => void) | Promise<void | (() => void)>;
}

export class PluginRuntime {
  private readonly services = new Map<string, unknown>();
  private readonly capabilities = new CapabilityRegistry();
  private readonly emitter = new EventEmitter();
  private readonly installed = new Map<string, InstalledPlugin>();

  registerService<T>(key: string, service: T): void {
    if (this.services.has(key)) throw new Error(`Service already registered: ${key}`);
    this.services.set(key, service);
  }

  getService<T>(key: string): T | undefined {
    return this.services.get(key) as T | undefined;
  }

  registerCapability<T>(key: CapabilityKey<T>, service: T): () => void {
    const dispose = this.capabilities.register(key, service);
    return () => {
      dispose();
      this.emitter.emit('capability.unregistered', { capability: key.id });
    };
  }

  resolveCapability<T>(key: CapabilityKey<T>): T {
    return this.capabilities.resolve(key);
  }

  listCapabilities() {
    return this.capabilities.list();
  }

  async use(plugin: EamilOSPlugin, options?: { signal?: AbortSignal }): Promise<() => Promise<void>> {
    if (this.installed.has(plugin.name)) throw new Error(`Plugin already installed: ${plugin.name}`);
    for (const dependency of plugin.inject ?? []) {
      if (!this.services.has(dependency) && !this.capabilities.list().some((capability) => capability.id === dependency)) {
        throw new Error(`Plugin ${plugin.name} requires missing service: ${dependency}`);
      }
    }

    const controller = new AbortController();
    const signal = options?.signal;
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });

    const disposers: Array<() => void | Promise<void>> = [];
    const context: PluginContext = {
      id: plugin.name,
      runtime: this,
      signal: controller.signal,
      get: <T>(key: string) => this.getService<T>(key),
      set: <T>(key: string, value: T) => this.services.set(key, value),
      resolve: <T>(key: CapabilityKey<T>) => this.resolveCapability(key),
      provide: <T>(key: CapabilityKey<T>, value: T) => {
        const dispose = this.registerCapability(key, value);
        disposers.push(dispose);
        return dispose;
      },
      on: (event, listener) => {
        this.emitter.on(event, listener);
        const dispose = () => { this.emitter.off(event, listener); };
        disposers.push(dispose);
        return dispose;
      },
      emit: (event, payload) => this.emitter.emit(event, payload),
      effect: (dispose) => {
        disposers.push(dispose);
        return dispose;
      },
    };

    try {
      const cleanup = await plugin.setup(context);
      if (cleanup) disposers.push(cleanup);
      this.installed.set(plugin.name, { name: plugin.name, disposers, descriptor: { name: plugin.name, inject: plugin.inject, provides: plugin.provides } });
      this.emitter.emit('plugin.installed', { plugin: plugin.name });
    } catch (error) {
      for (const dispose of disposers.reverse()) await dispose();
      signal?.removeEventListener('abort', onAbort);
      throw error;
    }

    return async () => {
      const installed = this.installed.get(plugin.name);
      if (!installed) return;
      this.installed.delete(plugin.name);
      controller.abort('plugin disposed');
      signal?.removeEventListener('abort', onAbort);
      for (const dispose of [...installed.disposers].reverse()) await dispose();
      this.emitter.emit('plugin.disposed', { plugin: plugin.name });
    };
  }

  dependencyGraph(): ReturnType<RuntimeDependencyGraph['snapshot']> {
    const graph = new RuntimeDependencyGraph();
    for (const plugin of this.installed.values()) graph.addPlugin(plugin.descriptor);
    return graph.snapshot(this.capabilities.list().map((capability) => capability.id));
  }

  dependencyGraphMermaid(): string {
    const graph = new RuntimeDependencyGraph();
    for (const plugin of this.installed.values()) graph.addPlugin(plugin.descriptor);
    return graph.toMermaid(this.capabilities.list().map((capability) => capability.id));
  }

  async dispose(): Promise<void> {
    for (const name of [...this.installed.keys()].reverse()) {
      const plugin = this.installed.get(name);
      if (!plugin) continue;
      this.installed.delete(name);
      for (const dispose of [...plugin.disposers].reverse()) await dispose();
    }
    this.emitter.removeAllListeners();
    this.capabilities.clear();
    this.services.clear();
  }
}

import { EventEmitter } from 'node:events';

export interface PluginContext {
  readonly id: string;
  readonly runtime: PluginRuntime;
  readonly signal: AbortSignal;
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  on(event: string, listener: (...args: any[]) => void): () => void;
  emit(event: string, payload?: unknown): void;
  effect(dispose: () => void | Promise<void>): () => void;
}

export interface EamilOSPlugin {
  readonly name: string;
  readonly inject?: readonly string[];
  setup(ctx: PluginContext): void | (() => void) | Promise<void | (() => void)>;
}

interface InstalledPlugin {
  name: string;
  disposers: Array<() => void | Promise<void>>;
}

export class PluginRuntime {
  private readonly services = new Map<string, unknown>();
  private readonly emitter = new EventEmitter();
  private readonly installed = new Map<string, InstalledPlugin>();

  registerService<T>(key: string, service: T): void {
    if (this.services.has(key)) throw new Error(`Service already registered: ${key}`);
    this.services.set(key, service);
  }

  getService<T>(key: string): T | undefined {
    return this.services.get(key) as T | undefined;
  }

  async use(plugin: EamilOSPlugin, options?: { signal?: AbortSignal }): Promise<() => Promise<void>> {
    if (this.installed.has(plugin.name)) throw new Error(`Plugin already installed: ${plugin.name}`);
    for (const dependency of plugin.inject ?? []) {
      if (!this.services.has(dependency)) throw new Error(`Plugin ${plugin.name} requires missing service: ${dependency}`);
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
      this.installed.set(plugin.name, { name: plugin.name, disposers });
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
    };
  }

  async dispose(): Promise<void> {
    for (const name of [...this.installed.keys()].reverse()) {
      const plugin = this.installed.get(name);
      if (!plugin) continue;
      this.installed.delete(name);
      for (const dispose of [...plugin.disposers].reverse()) await dispose();
    }
    this.emitter.removeAllListeners();
    this.services.clear();
  }
}

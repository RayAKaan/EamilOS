import type { EamilOSPlugin, PluginRuntime } from './PluginRuntime.js';
import { ProfileRuntime, type ResolvedProfile } from './ProfileRuntime.js';

export interface RuntimeBundle {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly profile: string;
  readonly plugins: readonly EamilOSPlugin[];
}

export interface BundleResolution {
  readonly bundle: RuntimeBundle;
  readonly profile: ResolvedProfile;
  readonly plugins: readonly EamilOSPlugin[];
}

export class BundleRuntime {
  private readonly bundles = new Map<string, RuntimeBundle>();

  constructor(private readonly profiles: ProfileRuntime) {}

  register(bundle: RuntimeBundle): () => void {
    if (this.bundles.has(bundle.id)) throw new Error(`Bundle already registered: ${bundle.id}`);
    this.bundles.set(bundle.id, bundle);
    return () => this.bundles.delete(bundle.id);
  }

  resolve(id: string): BundleResolution {
    const bundle = this.bundles.get(id);
    if (!bundle) throw new Error(`Unknown runtime bundle: ${id}`);
    const profile = this.profiles.resolve(bundle.profile);
    const allowed = new Set(profile.plugins);
    const plugins = bundle.plugins.filter(plugin => allowed.size === 0 || allowed.has(plugin.name));
    const missing = profile.plugins.filter(name => !plugins.some(plugin => plugin.name === name));
    if (missing.length) throw new Error(`Bundle ${id} is missing profile plugins: ${missing.join(', ')}`);
    return { bundle, profile, plugins };
  }

  async install(runtime: PluginRuntime, id: string): Promise<() => Promise<void>> {
    const { plugins } = this.resolve(id);
    const disposers: Array<() => Promise<void>> = [];
    try {
      for (const plugin of plugins) disposers.push(await runtime.use(plugin));
    } catch (error) {
      for (const dispose of [...disposers].reverse()) await dispose();
      throw error;
    }
    return async () => {
      for (const dispose of [...disposers].reverse()) await dispose();
    };
  }

  list(): RuntimeBundle[] {
    return [...this.bundles.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
}

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { EamilOSPlugin, PluginRuntime } from './PluginRuntime.js';

export interface ExternalPluginManifest {
  readonly name: string;
  readonly entry: string;
  readonly inject?: readonly string[];
  readonly provides?: readonly string[];
}

export class ExternalPluginRuntime {
  constructor(private readonly runtime: PluginRuntime) {}

  async load(manifest: ExternalPluginManifest, baseDir: string): Promise<() => Promise<void>> {
    const entry = resolve(baseDir, manifest.entry);
    const module = await import(pathToFileURL(entry).href);
    const plugin = (module.default ?? module.plugin) as EamilOSPlugin | undefined;
    if (!plugin) throw new Error(`External plugin ${manifest.name} has no default/plugin export`);
    if (plugin.name !== manifest.name) {
      throw new Error(`External plugin name mismatch: manifest=${manifest.name}, export=${plugin.name}`);
    }
    return this.runtime.use({
      ...plugin,
      inject: manifest.inject ?? plugin.inject,
      provides: manifest.provides ?? plugin.provides,
    });
  }

  async loadMany(manifests: readonly ExternalPluginManifest[], baseDir: string): Promise<() => Promise<void>> {
    const disposers: Array<() => Promise<void>> = [];
    try {
      for (const manifest of manifests) disposers.push(await this.load(manifest, baseDir));
    } catch (error) {
      for (const dispose of [...disposers].reverse()) await dispose();
      throw error;
    }
    return async () => {
      for (const dispose of [...disposers].reverse()) await dispose();
    };
  }
}

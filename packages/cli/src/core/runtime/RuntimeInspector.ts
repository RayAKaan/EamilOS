import type { PluginRuntime } from './PluginRuntime.js';
import type { ProfileRuntime } from './ProfileRuntime.js';
import type { BundleRuntime } from './BundleRuntime.js';

export class RuntimeInspector {
  constructor(
    private readonly runtime: PluginRuntime,
    private readonly profiles: ProfileRuntime,
    private readonly bundles: BundleRuntime,
  ) {}

  inspect() {
    const graph = this.runtime.dependencyGraph();
    return {
      generatedAt: new Date().toISOString(),
      capabilities: this.runtime.listCapabilities(),
      dependencyGraph: graph,
      dependencyGraphMermaid: this.runtime.dependencyGraphMermaid(),
      profiles: this.profiles.catalog(),
      bundles: this.bundles.list(),
      installedPlugins: graph.nodes
        .filter(node => node.kind === 'plugin')
        .map(node => node.id.slice('plugin:'.length))
        .sort(),
    };
  }

  toJSON(): string {
    return JSON.stringify(this.inspect(), null, 2);
  }
}

export type DependencyNodeKind = 'plugin' | 'capability';

export interface DependencyNode {
  id: string;
  kind: DependencyNodeKind;
}

export interface DependencyEdge {
  from: string;
  to: string;
  kind: 'requires' | 'provides';
}

export interface DependencyGraphSnapshot {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  roots: string[];
  unresolved: string[];
  cycles: string[][];
}

export interface PluginDependencyDescriptor {
  name: string;
  inject?: readonly string[];
  provides?: readonly string[];
}

export class RuntimeDependencyGraph {
  private readonly nodes = new Map<string, DependencyNode>();
  private readonly edges: DependencyEdge[] = [];

  addPlugin(plugin: PluginDependencyDescriptor): void {
    this.addNode({ id: `plugin:${plugin.name}`, kind: 'plugin' });

    for (const dependency of plugin.inject ?? []) {
      this.addNode({ id: `capability:${dependency}`, kind: 'capability' });
      this.edges.push({ from: `plugin:${plugin.name}`, to: `capability:${dependency}`, kind: 'requires' });
    }

    for (const capability of plugin.provides ?? []) {
      this.addNode({ id: `capability:${capability}`, kind: 'capability' });
      this.edges.push({ from: `plugin:${plugin.name}`, to: `capability:${capability}`, kind: 'provides' });
    }
  }

  snapshot(availableCapabilities: Iterable<string> = []): DependencyGraphSnapshot {
    const available = new Set(availableCapabilities);
    const unresolved = [...new Set(this.edges
      .filter(edge => edge.kind === 'requires' && !available.has(edge.to.slice('capability:'.length)) && !this.nodes.has(`provider:${edge.to}`))
      .map(edge => edge.to))];

    const adjacency = new Map<string, string[]>();
    for (const edge of this.edges) {
      if (edge.kind !== 'requires') continue;
      const provider = this.edges.find(candidate => candidate.kind === 'provides' && candidate.to === edge.to);
      if (provider) {
        const list = adjacency.get(edge.from) ?? [];
        list.push(provider.from);
        adjacency.set(edge.from, list);
      }
    }

    const cycles: string[][] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const path: string[] = [];

    const visit = (node: string) => {
      if (visiting.has(node)) {
        const index = path.indexOf(node);
        cycles.push(path.slice(index).concat(node));
        return;
      }
      if (visited.has(node)) return;
      visiting.add(node);
      path.push(node);
      for (const next of adjacency.get(node) ?? []) visit(next);
      path.pop();
      visiting.delete(node);
      visited.add(node);
    };

    for (const node of this.nodes.values()) {
      if (node.kind === 'plugin') visit(node.id);
    }

    const incoming = new Set(this.edges.filter(e => e.kind === 'requires').map(e => e.to));
    const roots = [...this.nodes.values()]
      .filter(node => node.kind === 'plugin' && !this.edges.some(e => e.kind === 'requires' && e.from === node.id))
      .map(node => node.id)
      .sort();

    return {
      nodes: [...this.nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
      edges: [...this.edges].sort((a, b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`)),
      roots,
      unresolved,
      cycles,
    };
  }

  toMermaid(availableCapabilities: Iterable<string> = []): string {
    const snapshot = this.snapshot(availableCapabilities);
    const lines = ['graph TD'];
    for (const node of snapshot.nodes) {
      const label = node.kind === 'plugin' ? node.id.slice('plugin:'.length) : node.id.slice('capability:'.length);
      lines.push(`  "${node.id}"["${label}"]`);
    }
    for (const edge of snapshot.edges) {
      const arrow = edge.kind === 'requires' ? '-- requires -->' : '-- provides -->';
      lines.push(`  "${edge.from}" ${arrow} "${edge.to}"`);
    }
    return lines.join('\\n');
  }

  private addNode(node: DependencyNode): void {
    if (!this.nodes.has(node.id)) this.nodes.set(node.id, node);
  }
}

export type CognitiveNodeKind = 'mission' | 'task' | 'decision' | 'execution' | 'artifact' | 'evidence' | 'harness';

export interface CognitiveNode {
  id: string;
  kind: CognitiveNodeKind;
  label: string;
  metadata?: Record<string, unknown>;
}

export interface CognitiveEdge {
  from: string;
  to: string;
  relation: 'decomposes' | 'depends-on' | 'decided-by' | 'executed-by' | 'produced' | 'proves' | 'recovered-by';
}

export class CognitiveGraph {
  private readonly nodes = new Map<string, CognitiveNode>();
  private readonly edges: CognitiveEdge[] = [];

  addNode(node: CognitiveNode): void { this.nodes.set(node.id, { ...node }); }

  addEdge(edge: CognitiveEdge): void {
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) throw new Error('Cognitive edge references an unknown node');
    if (!this.edges.some(e => e.from === edge.from && e.to === edge.to && e.relation === edge.relation)) this.edges.push({ ...edge });
  }

  snapshot(): { nodes: CognitiveNode[]; edges: CognitiveEdge[] } {
    return {
      nodes: [...this.nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
      edges: [...this.edges].sort((a, b) => `${a.from}:${a.to}:${a.relation}`.localeCompare(`${b.from}:${b.to}:${b.relation}`)),
    };
  }

  neighbors(id: string): CognitiveNode[] {
    const ids = new Set(this.edges.filter(e => e.from === id || e.to === id).map(e => e.from === id ? e.to : e.from));
    return [...ids].map(nodeId => this.nodes.get(nodeId)).filter((n): n is CognitiveNode => Boolean(n));
  }

  toMermaid(): string {
    const lines = ['graph LR'];
    for (const node of this.nodes.values()) lines.push(`  "${node.id}"["${node.label}"]`);
    for (const edge of this.edges) lines.push(`  "${edge.from}" -->|${edge.relation}| "${edge.to}"`);
    return lines.join('\n');
  }
}

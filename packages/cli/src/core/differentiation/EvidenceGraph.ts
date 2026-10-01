export interface EvidenceNode {
  id: string;
  type: 'requirement' | 'task' | 'execution' | 'artifact' | 'test' | 'validation' | 'decision';
  label: string;
  passed?: boolean;
  metadata?: Record<string, unknown>;
}

export interface EvidenceEdge {
  from: string;
  to: string;
  relation: 'satisfies' | 'produced' | 'validated-by' | 'supports' | 'derived-from';
}

export class EvidenceGraph {
  private readonly nodes = new Map<string, EvidenceNode>();
  private readonly edges: EvidenceEdge[] = [];

  addNode(node: EvidenceNode): void { this.nodes.set(node.id, { ...node }); }

  addEdge(edge: EvidenceEdge): void {
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) throw new Error('Evidence edge references an unknown node');
    if (!this.edges.some(e => e.from === edge.from && e.to === edge.to && e.relation === edge.relation)) this.edges.push({ ...edge });
  }

  verifyRequirement(requirementId: string): boolean {
    const supported = this.edges
      .filter(e => e.from === requirementId && (e.relation === 'satisfies' || e.relation === 'supports'))
      .map(e => this.nodes.get(e.to))
      .filter((n): n is EvidenceNode => Boolean(n));
    return supported.length > 0 && supported.every(node => node.passed !== false);
  }

  snapshot(): { nodes: EvidenceNode[]; edges: EvidenceEdge[] } {
    return { nodes: [...this.nodes.values()], edges: [...this.edges] };
  }
}

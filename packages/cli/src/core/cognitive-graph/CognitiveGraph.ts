import { createHash, randomUUID } from 'node:crypto';
import { GraphEdgeSchema, GraphNodeSchema, type GraphEdge, type GraphNode, type GraphSnapshot, type GraphSource, type GraphEdgeType, type GraphNodeType } from './types.js';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, canonicalize(v)]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function graphStateHash(nodes: GraphNode[], edges: GraphEdge[]): string {
  return createHash('sha256').update(canonicalJson({ nodes, edges })).digest('hex');
}

export class CognitiveGraph {
  private readonly nodeMap = new Map<string, GraphNode>();
  private readonly edgeMap = new Map<string, GraphEdge>();
  private version = 0;

  constructor(private readonly missionId: string, snapshot?: GraphSnapshot) {
    if (snapshot) {
      if (snapshot.missionId !== missionId) throw new Error('Graph mission mismatch');
      this.version = snapshot.version;
      for (const node of snapshot.nodes) this.nodeMap.set(node.id, GraphNodeSchema.parse(node));
      for (const edge of snapshot.edges) this.edgeMap.set(edge.id, GraphEdgeSchema.parse(edge));
    }
  }

  get mission(): string { return this.missionId; }
  get currentVersion(): number { return this.version; }

  nodes(): GraphNode[] { return [...this.nodeMap.values()].sort((a,b) => a.id.localeCompare(b.id)); }
  edges(): GraphEdge[] { return [...this.edgeMap.values()].sort((a,b) => a.id.localeCompare(b.id)); }
  getNode(id: string): GraphNode | undefined { return this.nodeMap.get(id); }
  getEdge(id: string): GraphEdge | undefined { return this.edgeMap.get(id); }

  addNode(input: {
    id?: string; type: GraphNodeType; source: GraphSource; attributes?: Record<string, unknown>;
  }): GraphNode {
    const id = input.id ?? `node_${randomUUID()}`;
    if (this.nodeMap.has(id)) throw new Error(`Graph node already exists: ${id}`);
    const now = new Date().toISOString();
    const node = GraphNodeSchema.parse({
      id, type: input.type, missionId: this.missionId, version: this.version + 1,
      createdAt: now, updatedAt: now, source: input.source, attributes: input.attributes ?? {},
    });
    this.nodeMap.set(id, node);
    return node;
  }

  updateNode(id: string, attributes: Record<string, unknown>): GraphNode {
    const node = this.requireNode(id);
    const updated = GraphNodeSchema.parse({
      ...node, version: this.version + 1, updatedAt: new Date().toISOString(),
      attributes: { ...node.attributes, ...attributes },
    });
    this.nodeMap.set(id, updated);
    return updated;
  }

  addEdge(input: {
    id?: string; type: GraphEdgeType; from: string; to: string; source: GraphSource; attributes?: Record<string, unknown>;
  }): GraphEdge {
    if (!this.nodeMap.has(input.from) || !this.nodeMap.has(input.to)) throw new Error('Graph edge references a missing node');
    const id = input.id ?? `edge_${randomUUID()}`;
    if (this.edgeMap.has(id)) throw new Error(`Graph edge already exists: ${id}`);
    const edge = GraphEdgeSchema.parse({
      id, type: input.type, from: input.from, to: input.to, missionId: this.missionId,
      version: this.version + 1, createdAt: new Date().toISOString(), source: input.source, attributes: input.attributes ?? {},
    });
    this.edgeMap.set(id, edge);
    return edge;
  }

  updateEdge(id: string, attributes: Record<string, unknown>): GraphEdge {
    const edge = this.requireEdge(id);
    const updated = GraphEdgeSchema.parse({ ...edge, version: this.version + 1, attributes: { ...edge.attributes, ...attributes } });
    this.edgeMap.set(id, updated);
    return updated;
  }

  removeEdge(id: string): void {
    this.requireEdge(id);
    this.edgeMap.delete(id);
  }

  commitVersion(): GraphSnapshot {
    this.version += 1;
    const nodes = this.nodes().map(node => ({ ...node, version: this.version }));
    const edges = this.edges().map(edge => ({ ...edge, version: this.version }));
    this.nodeMap.clear(); nodes.forEach(node => this.nodeMap.set(node.id, node));
    this.edgeMap.clear(); edges.forEach(edge => this.edgeMap.set(edge.id, edge));
    return {
      missionId: this.missionId, version: this.version, nodes, edges,
      stateHash: graphStateHash(nodes, edges), createdAt: new Date().toISOString(),
    };
  }

  snapshot(): GraphSnapshot {
    const nodes = this.nodes(); const edges = this.edges();
    return { missionId: this.missionId, version: this.version, nodes, edges, stateHash: graphStateHash(nodes, edges), createdAt: new Date().toISOString() };
  }

  private requireNode(id: string): GraphNode { const node = this.getNode(id); if (!node) throw new Error(`Graph node not found: ${id}`); return node; }
  private requireEdge(id: string): GraphEdge { const edge = this.getEdge(id); if (!edge) throw new Error(`Graph edge not found: ${id}`); return edge; }
}

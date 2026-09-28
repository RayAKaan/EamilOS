import type { GraphEdge, GraphEdgeType, GraphNode, GraphNodeType, GraphSnapshot } from './types.js';

export class GraphQueryEngine {
  constructor(private readonly graph: GraphSnapshot) {}

  getNode(id: string): GraphNode | undefined { return this.graph.nodes.find(node => node.id === id); }
  getNodesByType(type: GraphNodeType): GraphNode[] { return this.graph.nodes.filter(node => node.type === type); }
  outgoing(id: string, type?: GraphEdgeType): GraphEdge[] { return this.graph.edges.filter(edge => edge.from === id && (!type || edge.type === type)); }
  incoming(id: string, type?: GraphEdgeType): GraphEdge[] { return this.graph.edges.filter(edge => edge.to === id && (!type || edge.type === type)); }
  neighbors(id: string): GraphNode[] {
    const ids = new Set([...this.outgoing(id).map(e => e.to), ...this.incoming(id).map(e => e.from)]);
    return [...ids].map(nodeId => this.getNode(nodeId)).filter((node): node is GraphNode => Boolean(node));
  }
  findDependencies(taskId: string): GraphNode[] {
    return this.incoming(taskId, 'DEPENDS_ON').map(edge => this.getNode(edge.from)).filter((n): n is GraphNode => Boolean(n));
  }
  findDependents(taskId: string): GraphNode[] {
    return this.outgoing(taskId, 'DEPENDS_ON').map(edge => this.getNode(edge.to)).filter((n): n is GraphNode => Boolean(n));
  }
  findBlockers(taskId: string): GraphNode[] {
    return this.findDependencies(taskId).filter(node => ['FAILED','BLOCKED','RECOVERABLE','ESCALATED'].includes(String(node.attributes.state)));
  }
  findFailures(taskId: string): GraphNode[] {
    return this.incoming(taskId, 'INVALIDATED_BY').map(edge => this.getNode(edge.from)).filter((n): n is GraphNode => Boolean(n));
  }
  findPath(from: string, to: string): string[] | undefined {
    const queue: Array<{ id: string; path: string[] }> = [{ id: from, path: [from] }];
    const visited = new Set([from]);
    while (queue.length) {
      const current = queue.shift()!;
      if (current.id === to) return current.path;
      for (const edge of this.outgoing(current.id)) {
        if (!visited.has(edge.to)) { visited.add(edge.to); queue.push({ id: edge.to, path: [...current.path, edge.to] }); }
      }
    }
    return undefined;
  }
}

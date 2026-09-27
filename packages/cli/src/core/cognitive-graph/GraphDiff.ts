import type { GraphDiff as GraphDiffResult, GraphSnapshot } from './types.js';

export function diffGraphs(from: GraphSnapshot, to: GraphSnapshot): GraphDiffResult {
  const aNodes = new Map(from.nodes.map(n => [n.id, n]));
  const bNodes = new Map(to.nodes.map(n => [n.id, n]));
  const aEdges = new Map(from.edges.map(e => [e.id, e]));
  const bEdges = new Map(to.edges.map(e => [e.id, e]));
  return {
    fromVersion: from.version, toVersion: to.version,
    addedNodes: [...bNodes.keys()].filter(id => !aNodes.has(id)),
    removedNodes: [...aNodes.keys()].filter(id => !bNodes.has(id)),
    changedNodes: [...bNodes.keys()].filter(id => aNodes.has(id) && JSON.stringify(aNodes.get(id)?.attributes) !== JSON.stringify(bNodes.get(id)?.attributes)),
    addedEdges: [...bEdges.keys()].filter(id => !aEdges.has(id)),
    removedEdges: [...aEdges.keys()].filter(id => !bEdges.has(id)),
  };
}

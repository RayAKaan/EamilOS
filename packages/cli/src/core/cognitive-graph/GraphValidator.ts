import { createHash } from 'node:crypto';
import type { GraphHealth, GraphSnapshot } from './types.js';
import { graphStateHash } from './CognitiveGraph.js';

export class GraphValidator {
  validate(snapshot: GraphSnapshot): GraphHealth {
    const nodeIds = new Set(snapshot.nodes.map(node => node.id));
    const duplicateNodes = snapshot.nodes.length !== nodeIds.size;
    const duplicateEdges = snapshot.edges.length !== new Set(snapshot.edges.map(edge => edge.id)).size;
    const orphanEdges = snapshot.edges.filter(edge => !nodeIds.has(edge.from) || !nodeIds.has(edge.to)).length;
    const invalidMission = snapshot.nodes.filter(node => node.missionId !== snapshot.missionId).length
      + snapshot.edges.filter(edge => edge.missionId !== snapshot.missionId).length;
    const calculated = graphStateHash(snapshot.nodes, snapshot.edges);
    const consistent = !duplicateNodes && !duplicateEdges && orphanEdges === 0 && invalidMission === 0 && calculated === snapshot.stateHash;
    return {
      consistent,
      nodeCount: snapshot.nodes.length,
      edgeCount: snapshot.edges.length,
      orphanNodes: 0,
      orphanEdges,
      invalidReferences: invalidMission + (duplicateNodes ? 1 : 0) + (duplicateEdges ? 1 : 0),
      version: snapshot.version,
      stateHash: snapshot.stateHash,
    };
  }

  assertValid(snapshot: GraphSnapshot): void {
    const health = this.validate(snapshot);
    if (!health.consistent) throw new Error(`Cognitive graph validation failed: ${JSON.stringify(health)}`);
  }
}

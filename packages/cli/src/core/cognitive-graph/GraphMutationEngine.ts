import { randomUUID } from 'node:crypto';
import { GraphMutationSchema, type GraphMutation, type GraphSnapshot } from './types.js';
import { CognitiveGraph } from './CognitiveGraph.js';
import { GraphValidator } from './GraphValidator.js';

export class GraphMutationEngine {
  constructor(private readonly validator = new GraphValidator()) {}

  propose(input: Omit<GraphMutation, 'mutationId' | 'createdAt'>): GraphMutation {
    return GraphMutationSchema.parse({ ...input, mutationId: `mutation_${randomUUID()}`, createdAt: new Date().toISOString() });
  }

  apply(snapshot: GraphSnapshot, mutation: GraphMutation): GraphSnapshot {
    if (mutation.missionId !== snapshot.missionId) throw new Error('Mutation mission mismatch');
    if (mutation.baseVersion !== snapshot.version) throw new Error(`Stale graph mutation: expected v${snapshot.version}, received v${mutation.baseVersion}`);
    const graph = new CognitiveGraph(snapshot.missionId, snapshot);
    switch (mutation.type) {
      case 'ADD_NODE': {
        graph.addNode({ id: String(mutation.payload.id ?? mutation.targetIds[0]), type: mutation.payload.type as never, source: mutation.payload.source as never, attributes: mutation.payload.attributes as Record<string, unknown> | undefined });
        break;
      }
      case 'UPDATE_NODE': {
        const id = mutation.targetIds[0]; if (!id) throw new Error('UPDATE_NODE requires a target');
        graph.updateNode(id, mutation.payload.attributes as Record<string, unknown> ?? {});
        break;
      }
      case 'ADD_EDGE': {
        graph.addEdge({ id: String(mutation.payload.id ?? mutation.targetIds[0]), type: mutation.payload.type as never, from: String(mutation.payload.from), to: String(mutation.payload.to), source: mutation.payload.source as never, attributes: mutation.payload.attributes as Record<string, unknown> | undefined });
        break;
      }
      case 'UPDATE_EDGE': {
        const id = mutation.targetIds[0]; if (!id) throw new Error('UPDATE_EDGE requires a target');
        graph.updateEdge(id, mutation.payload.attributes as Record<string, unknown> ?? {});
        break;
      }
      case 'REMOVE_EDGE': {
        const id = mutation.targetIds[0]; if (!id) throw new Error('REMOVE_EDGE requires a target');
        graph.removeEdge(id);
        break;
      }
    }
    const next = graph.commitVersion();
    this.validator.assertValid(next);
    return next;
  }
}

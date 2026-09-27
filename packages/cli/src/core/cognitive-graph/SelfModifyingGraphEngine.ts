import type { MissionEngine } from '../mission/MissionEngine.js';
import type { LoopObservation, LoopMeasurement, LoopValidation } from '../loop/types.js';
import type { RuntimeExecutionResult } from '../runtime/types.js';
import { GraphBuilder } from './GraphBuilder.js';
import { FilesystemGraphStore, type GraphStore } from './GraphStore.js';
import { GraphValidator } from './GraphValidator.js';
import { GraphAdaptationEngine, type GraphAdaptationPolicy, type GraphAdaptationResult } from './GraphAdaptationEngine.js';
import { graphStateHash } from './CognitiveGraph.js';
import type { GraphSnapshot } from './types.js';

export interface SelfModifyingGraphPolicy extends GraphAdaptationPolicy {
  maxAdaptationsPerMission: number;
}

export interface SelfModifyingGraphState {
  missionId: string;
  adaptations: number;
  lastGraphVersion: number;
  lastMutationId?: string;
}

export class SelfModifyingGraphEngine {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly missions: MissionEngine,
    private readonly policy: SelfModifyingGraphPolicy,
    private readonly adaptation = new GraphAdaptationEngine(missions, policy),
    private readonly store: GraphStore = new FilesystemGraphStore(),
  ) {}

  async observe(missionId: string): Promise<GraphSnapshot> {
    const rebuilt = new GraphBuilder().build(this.missions.snapshot(missionId));
    const persisted = await this.store.load(missionId);

    if (!persisted) {
      await this.store.save(rebuilt);
      return rebuilt;
    }

    if (this.semanticHash(persisted) !== this.semanticHash(rebuilt)) {
      const nextVersion = Math.max(persisted.version + 1, rebuilt.version);
      const next = {
        ...rebuilt,
        version: nextVersion,
        nodes: rebuilt.nodes.map(node => ({ ...node, version: nextVersion })),
        edges: rebuilt.edges.map(edge => ({ ...edge, version: nextVersion })),
      };
      const normalized = {
        ...next,
        stateHash: graphStateHash(next.nodes, next.edges),
      };
      new GraphValidator().assertValid(normalized);
      await this.store.save(normalized);
      return normalized;
    }

    return persisted;
  }

  async adapt(
    observation: LoopObservation,
    measurement: LoopMeasurement,
    validation: LoopValidation,
    execution?: RuntimeExecutionResult,
  ): Promise<GraphAdaptationResult> {
    const used = this.counts.get(observation.missionId) ?? 0;

    if (used >= this.policy.maxAdaptationsPerMission) {
      const graph = await this.observe(observation.missionId);
      return {
        changed: false,
        graph,
        rejectedReason: 'Mission graph adaptation budget exhausted.',
        messages: ['Self-modification budget exhausted; no graph mutation was applied.'],
      };
    }

    const current = await this.observe(observation.missionId);

    if (current.version !== observation.graph.version || current.stateHash !== observation.graph.stateHash) {
      return {
        changed: false,
        graph: current,
        rejectedReason: 'Observation graph is stale.',
        messages: ['Self-modification rejected because the mission graph changed after observation.'],
      };
    }

    const result = this.adaptation.apply(
      { ...observation, graph: current },
      measurement,
      validation,
      execution,
    );

    if (result.changed) {
      this.counts.set(observation.missionId, used + 1);
      await this.store.save(result.graph);
    }

    return result;
  }

  private semanticHash(snapshot: GraphSnapshot): string {
    const nodes = snapshot.nodes.map(node => ({ ...node, version: 0 }));
    const edges = snapshot.edges.map(edge => ({ ...edge, version: 0 }));
    return graphStateHash(nodes, edges);
  }

  async state(missionId: string): Promise<SelfModifyingGraphState> {
    const graph = await this.observe(missionId);
    return {
      missionId,
      adaptations: this.counts.get(missionId) ?? 0,
      lastGraphVersion: graph.version,
    };
  }
}

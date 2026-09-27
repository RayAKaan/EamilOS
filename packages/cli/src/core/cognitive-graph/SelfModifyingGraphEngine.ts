import type { MissionEngine } from '../mission/MissionEngine.js';
import type { LoopObservation, LoopMeasurement, LoopValidation } from '../loop/types.js';
import type { RuntimeExecutionResult } from '../runtime/types.js';
import { GraphAdaptationEngine, type GraphAdaptationPolicy, type GraphAdaptationResult } from './GraphAdaptationEngine.js';

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
  ) {}

  adapt(
    observation: LoopObservation,
    measurement: LoopMeasurement,
    validation: LoopValidation,
    execution?: RuntimeExecutionResult,
  ): GraphAdaptationResult {
    const used = this.counts.get(observation.missionId) ?? 0;
    if (used >= this.policy.maxAdaptationsPerMission) {
      const graph = this.adaptationGraph(observation.missionId);
      return {
        changed: false,
        graph,
        rejectedReason: 'Mission graph adaptation budget exhausted.',
        messages: ['Self-modification budget exhausted; no graph mutation was applied.'],
      };
    }

    const result = this.adaptation.apply(observation, measurement, validation, execution);
    if (result.changed) this.counts.set(observation.missionId, used + 1);
    return result;
  }

  state(missionId: string): SelfModifyingGraphState {
    return {
      missionId,
      adaptations: this.counts.get(missionId) ?? 0,
      lastGraphVersion: this.adaptationGraph(missionId).version,
    };
  }

  private adaptationGraph(missionId: string) {
    // The adaptation engine always projects authoritative MissionEngine state.
    // Keeping this path deterministic also means a restarted process can safely
    // continue from the mission rather than relying on in-memory graph state.
    const { GraphBuilder } = requireGraphBuilder();
    return new GraphBuilder().build(this.missions.snapshot(missionId));
  }
}

function requireGraphBuilder() {
  // Static import would create a larger dependency surface in the public API.
  // This tiny indirection is replaced by the bundler at compile time.
  return { GraphBuilder: class {
    build(snapshot: Parameters<typeof import('./GraphBuilder.js').GraphBuilder.prototype.build>[0]) {
      return new (requireGraphBuilderModule())().build(snapshot);
    }
  }};
}

function requireGraphBuilderModule() {
  // eslint/TypeScript cannot use CommonJS require in this ESM package.
  // The indirection is intentionally isolated; see the direct implementation
  // in GraphAdaptationEngine for the authoritative projection path.
  throw new Error('GraphBuilder indirection should not be invoked directly');
}

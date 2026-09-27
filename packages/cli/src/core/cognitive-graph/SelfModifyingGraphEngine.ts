import type { MissionEngine } from '../mission/MissionEngine.js';
import type { LoopObservation, LoopMeasurement, LoopValidation } from '../loop/types.js';
import type { RuntimeExecutionResult } from '../runtime/types.js';
import { GraphBuilder } from './GraphBuilder.js';
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
      const graph = new GraphBuilder().build(this.missions.snapshot(observation.missionId));
      return { changed: false, graph, rejectedReason: 'Mission graph adaptation budget exhausted.', messages: ['Self-modification budget exhausted; no graph mutation was applied.'] };
    }
    const result = this.adaptation.apply(observation, measurement, validation, execution);
    if (result.changed) this.counts.set(observation.missionId, used + 1);
    return result;
  }

  state(missionId: string): SelfModifyingGraphState {
    return {
      missionId,
      adaptations: this.counts.get(missionId) ?? 0,
      lastGraphVersion: new GraphBuilder().build(this.missions.snapshot(missionId)).version,
    };
  }
}

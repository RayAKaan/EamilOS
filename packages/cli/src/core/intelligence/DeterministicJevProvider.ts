import type { DecisionContext, DecisionTrigger, JevDecision, JevProvider, JevProviderResponse } from './types.js';
import { DeterministicStrategicEngine } from './DeterministicStrategicEngine.js';

export class DeterministicJevProvider implements JevProvider {
  readonly id = 'deterministic';
  constructor(private readonly engine = new DeterministicStrategicEngine()) {}

  async decide(context: DecisionContext): Promise<JevProviderResponse> {
    const started = Date.now();
    const trigger = this.trigger(context);
    const decision = this.engine.decide(context, trigger);
    return { decision, provider: this.id, latencyMs: Date.now() - started };
  }

  async health(): Promise<{ healthy: boolean; error?: string }> {
    return { healthy: true };
  }

  private trigger(context: DecisionContext): DecisionTrigger {
    if (context.failures.length > 0) return 'EXECUTION_FAILED';
    if (context.progress.completedTasks === context.progress.totalTasks && context.progress.totalTasks > 0) return 'MISSION_NEAR_COMPLETION';
    if (context.progress.blockedTasks > 0) return 'MISSION_BLOCKED';
    return 'PERIODIC_REVIEW';
  }
}

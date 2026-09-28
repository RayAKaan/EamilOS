import type { DecisionContext, JevProvider, JevProviderResponse } from '../types.js';

export class MockJevProvider implements JevProvider {
  readonly id = 'mock-jev';
  constructor(private readonly decideFn?: (context: DecisionContext) => JevProviderResponse['decision']) {}
  async decide(context: DecisionContext): Promise<JevProviderResponse> {
    const started = Date.now();
    const decision = this.decideFn
      ? this.decideFn(context)
      : {
          decisionId: `mock-${Date.now()}`,
          missionId: context.mission.id,
          action: context.taskGraph.readyTasks.length > 0 ? 'CONTINUE' as const : 'VERIFY' as const,
          reasoning: 'Deterministic mock decision for tests.',
          targets: context.taskGraph.readyTasks.slice(0, 1).map(taskId => ({ taskId })),
          contextVersion: context.taskGraph.version,
        };
    return { decision, provider: this.id, latencyMs: Date.now() - started };
  }
  async health() { return { healthy: true }; }
}

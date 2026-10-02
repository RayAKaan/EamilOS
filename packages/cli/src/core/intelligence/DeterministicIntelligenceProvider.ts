import type {
  IntelligenceCapabilities,
  IntelligenceHealth,
  IntelligenceProvider,
  IntelligenceRequest,
  IntelligenceResponse,
} from './IntelligenceRuntimeTypes.js';
import type { DecisionContext, JevDecision, LayaPlan } from './types.js';
import { DeterministicPlanner } from './DeterministicPlanner.js';
import { DeterministicStrategicEngine } from './DeterministicStrategicEngine.js';
import { DeterministicAgentSelector } from './DeterministicAgentSelector.js';
import { DeterministicRecoveryEngine } from './DeterministicRecoveryEngine.js';
import { DeterministicParallelizationEngine } from './DeterministicParallelizationEngine.js';

export class DeterministicIntelligenceProvider implements IntelligenceProvider {
  readonly id = 'deterministic';

  constructor(
    private readonly strategic = new DeterministicStrategicEngine(),
    private readonly planner = new DeterministicPlanner(),
    private readonly selector = new DeterministicAgentSelector(),
    private readonly recovery = new DeterministicRecoveryEngine(),
    private readonly parallelization = new DeterministicParallelizationEngine(),
  ) {}

  capabilities(): IntelligenceCapabilities {
    return {
      strategicDecision: true,
      taskDecision: true,
      recoveryDecision: true,
      planning: true,
      validationAssessment: true,
      agentSelection: true,
      parallelization: true,
      local: true,
      remote: false,
      streaming: false,
    };
  }

  async initialize(): Promise<void> {}

  async health(): Promise<IntelligenceHealth> {
    return {
      providerId: this.id,
      status: 'READY',
      checkedAt: new Date().toISOString(),
      capabilities: this.capabilities(),
    };
  }

  async evaluate(request: IntelligenceRequest): Promise<IntelligenceResponse> {
    const context = request.context as DecisionContext;
    const started = Date.now();

    try {
      if (request.type === 'PLANNING') {
        const result = this.planner.plan(
          context,
          String((context as unknown as { objective?: string }).objective ?? context.mission.goal),
          (context as unknown as { parentTaskId?: string }).parentTaskId,
          (context as unknown as { planningPolicy?: Record<string, number> }).planningPolicy,
        );
        return this.success(request, result, started);
      }

      let decision: JevDecision;
      switch (request.type) {
        case 'RECOVERY_DECISION':
          decision = this.recovery.decide(context);
          break;
        case 'PARALLELIZATION':
          decision = this.parallelization.decide(context);
          break;
        case 'AGENT_SELECTION': {
          const task = context.taskGraph.tasks.find(item => request.metadata?.taskId === item.id) ?? context.taskGraph.tasks.find(item => item.state === 'READY');
          const selection = this.selector.select(context, task);
          decision = {
            decisionId: `det-agent-${context.mission.id}-${context.taskGraph.version}`,
            missionId: context.mission.id,
            action: 'EXECUTE',
            reasoning: selection.reasons.join('; '),
            targets: task ? [{ taskId: task.id, agentId: selection.agentId, harnessId: selection.harnessId }] : [],
            confidence: selection.score / 100,
            expectedOutcome: selection.agentId ? `Route task to ${selection.agentId}.` : 'No compatible agent available.',
            contextVersion: context.taskGraph.version,
          };
          break;
        }
        case 'VALIDATION':
          decision = {
            decisionId: `det-verify-${context.mission.id}-${context.taskGraph.version}`,
            missionId: context.mission.id,
            action: 'VERIFY',
            reasoning: 'Validation is governed by recorded execution validation and mission evidence.',
            targets: context.taskGraph.tasks.filter(task => task.state === 'VALIDATING' || task.state === 'COMPLETED').map(task => ({ taskId: task.id })),
            confidence: 0.99,
            expectedOutcome: 'Verify execution results and evidence before completion.',
            contextVersion: context.taskGraph.version,
          };
          break;
        default:
          decision = this.strategic.decide(context, 'PERIODIC_REVIEW');
      }

      return this.success(request, decision, started);
    } catch (error) {
      return {
        requestId: request.requestId,
        providerId: this.id,
        status: 'FAILED',
        latencyMs: Date.now() - started,
        contextVersion: request.contextVersion,
        contextHash: request.contextHash,
        error: {
          code: 'DETERMINISTIC_ENGINE_ERROR',
          message: error instanceof Error ? error.message : String(error),
          retryable: false,
        },
      };
    }
  }

  async shutdown(): Promise<void> {}

  private success<T>(request: IntelligenceRequest, result: T, started: number): IntelligenceResponse<T> {
    return {
      requestId: request.requestId,
      providerId: this.id,
      status: 'SUCCESS',
      result,
      confidence: 0.99,
      latencyMs: Date.now() - started,
      contextVersion: request.contextVersion,
      contextHash: request.contextHash,
    };
  }
}

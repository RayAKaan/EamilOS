import type { MissionEngine } from '../mission/MissionEngine.js';
import { ExecutionStore } from '../execution/ExecutionStore.js';
import { HarnessRegistry } from '../execution/HarnessRegistry.js';
import { createIntelligenceFoundation, type IntelligenceFoundation } from './IntelligenceFoundation.js';
import type { CoordinationEngine } from '../coordination/CoordinationEngine.js';
import type { HarnessScheduler } from '../execution/HarnessScheduler.js';
import { DecisionContextBuilder } from './DecisionContextBuilder.js';
import { DecisionRuntime } from './DecisionRuntime.js';
import { DecisionStore } from './DecisionStore.js';
import { DecisionApplier } from './DecisionApplier.js';
import { StrategicLoop, type StrategicLoopResult } from './StrategicLoop.js';
import type { IntelligenceConfig, JevProvider, LayaModelAdapter } from './types.js';
import type { FleetIntelligenceProvider } from './FleetIntelligence.js';
import { DeterministicJevProvider } from './DeterministicJevProvider.js';

export class IntelligenceEngine {
  readonly context: DecisionContextBuilder;
  readonly decisions: DecisionStore;
  readonly runtime: DecisionRuntime;
  readonly applier: DecisionApplier;
  readonly loop: StrategicLoop;
  readonly foundation: IntelligenceFoundation;

  constructor(
    missions: MissionEngine,
    coordination: CoordinationEngine,
    scheduler: HarnessScheduler,
    jev: JevProvider,
    laya: LayaModelAdapter,
    config: IntelligenceConfig,
    decisions = new DecisionStore(),
    fleet?: FleetIntelligenceProvider,
    executions = new ExecutionStore(),
    registry = new HarnessRegistry(),
    foundation = createIntelligenceFoundation({ jev, laya }),
  ) {
    this.foundation = foundation;
    this.context = new DecisionContextBuilder(missions, coordination, executions, decisions, registry, fleet);
    this.decisions = decisions;
    this.runtime = new DecisionRuntime(jev, undefined, config.jev.maxRetries, new DeterministicJevProvider());
    this.applier = new DecisionApplier(missions, coordination, scheduler, laya, executions);
    this.loop = new StrategicLoop(this.context, this.runtime, this.applier, decisions, config);
  }

  async run(missionId: string): Promise<StrategicLoopResult> {
    return this.loop.run(missionId);
  }

  async decide(missionId: string) {
    const context = this.context.build(missionId);
    return this.runtime.evaluate(context, 'USER_REQUESTED');
  }
}

export function defaultIntelligenceConfig(): IntelligenceConfig {
  return {
    mode: 'AUTONOMOUS',
    jev: { enabled: true, provider: 'jev-http', timeoutMs: 60_000, maxRetries: 2 },
    laya: { enabled: true, runtime: 'local-process', model: 'configured', timeoutMs: 120_000 },
    policies: {
      allowAutonomousExecution: true,
      allowReplanning: true,
      allowParallelization: true,
      allowTaskCreation: true,
      allowTaskCancellation: true,
      requireApprovalFor: [],
      maxRetriesPerTask: 3,
      maxReplansPerTask: 5,
      maxStrategicEscalationsPerTask: 3,
    },
    planning: { maxDepth: 3, maxTasksPerPlan: 20, maxTotalTasks: 100, maxDependencyEdges: 100, maxPlanRevisions: 10 },
    budgets: {
      jev: { maxDecisions: 50, decisionsUsed: 0, estimatedCostUsd: 0, tokensUsed: 0 },
      laya: { maxPlanningTimeMs: 120_000, maxPlanDepth: 3, maxTasksPerPlan: 20, maxRevisions: 10 },
    },
    loop: { maxIterations: 100, maxReplans: 10, stagnationThreshold: 5 },
  };
}
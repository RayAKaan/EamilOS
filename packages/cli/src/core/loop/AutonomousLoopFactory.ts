import { GraphBuilder, GraphValidator } from '../cognitive-graph/index.js';
import { MissionEngine } from '../mission/MissionEngine.js';
import { CoordinationEngine } from '../coordination/CoordinationEngine.js';
import { HarnessRegistry } from '../execution/HarnessRegistry.js';
import { HarnessScheduler } from '../execution/HarnessScheduler.js';
import { ExecutionStore } from '../execution/ExecutionStore.js';
import { DecisionContextBuilder } from '../intelligence/DecisionContextBuilder.js';
import { DecisionStore } from '../intelligence/DecisionStore.js';
import { createIntelligenceRuntime } from '../intelligence/IntelligenceFactory.js';
import type { IntelligenceConfig, DecisionTrigger, JevDecision } from '../intelligence/types.js';
import type { RuntimeExecutionResult, RuntimeValidationResult } from '../runtime/types.js';
import { AutonomousLoopEngine } from './AutonomousLoopEngine.js';
import type { AutonomousLoopComponents, AutonomousLoopPolicy, LoopAdaptation, LoopInterpretation, LoopObservation, LoopPlanResult, LoopValidation } from './types.js';

export interface AutonomousLoopRuntimeOptions {
  missions?: MissionEngine;
  coordination?: CoordinationEngine;
  registry?: HarnessRegistry;
  decisions?: DecisionStore;
  intelligence?: ReturnType<typeof createIntelligenceRuntime>;
  config?: IntelligenceConfig;
  policy?: Partial<AutonomousLoopPolicy>;
}

export function createAutonomousLoopRuntime(options: AutonomousLoopRuntimeOptions = {}): AutonomousLoopEngine {
  const missions = options.missions ?? new MissionEngine();
  const coordination = options.coordination ?? new CoordinationEngine(missions);
  const registry = options.registry ?? new HarnessRegistry();
  const scheduler = new HarnessScheduler(missions, coordination, registry);
  const decisions = options.decisions ?? new DecisionStore();
  const config = options.config ?? defaultConfig();
  const intelligence = options.intelligence ?? createIntelligenceRuntime({ missions, coordination, registry, config });
  const contextBuilder = new DecisionContextBuilder(missions, coordination, new ExecutionStore(), decisions, registry);
  // Phase 10 owns the loop lifecycle while reusing the existing validated Jev/Laya
  // runtime and deterministic decision applier.
  const components: AutonomousLoopComponents = {
    observe: async (missionId, iteration) => {
      const context = contextBuilder.build(missionId);
      const graph = new GraphBuilder().build(missions.snapshot(missionId));
      const graphHealth = new GraphValidator().validate(graph);
      return {
        missionId, iteration, observedAt: new Date().toISOString(), graph, graphHealth, context,
        readyTasks: context.taskGraph.readyTasks, runningTasks: context.taskGraph.runningTasks,
        blockedTasks: context.taskGraph.blockedTasks, failedTasks: context.taskGraph.failedTasks,
        completionRatio: context.progress.completionRatio, progressMetric: context.progress.completionRatio,
      };
    },
    interpret: async (observation) => {
      if (observation.context.mission.status === 'completed') return interpretation('COMPLETE', 'MISSION_NEAR_COMPLETION', 'Mission is already complete.', []);
      const evaluation = await intelligence.runtime.evaluate(observation.context, observation.context.progress.blockedTasks > 0 ? 'MISSION_BLOCKED' : 'PERIODIC_REVIEW');
      if (!evaluation.evaluation.accepted || !evaluation.evaluation.decision) {
        return interpretation('ESCALATE', 'PLAN_REJECTED', evaluation.evaluation.reasons.join('; '), []);
      }
      const decision = evaluation.evaluation.decision;
      decisions.saveDecision(evaluation.record);
      return interpretation(
        decision.action === 'DECOMPOSE' ? 'PLAN' : decision.action as LoopInterpretation['action'],
        evaluation.record.trigger,
        decision.reasoning,
        decision.targets.flatMap(target => target.taskId ? [target.taskId] : []),
        decision,
      );
    },
    plan: async (missionId, observation, interpretation) => {
      if (!interpretation.decision) {
        return { planned: false, action: interpretation.action, message: 'No validated strategic decision was available for this planning phase.' };
      }
      const applied = await intelligence.applier.apply(observation.context, interpretation.decision);
      return { planned: applied.changed || applied.progress, action: interpretation.action, message: applied.messages.join('; '), decision: interpretation.decision };
    },
    execute: async (missionId, taskId, interpretation) => {
      const target = interpretation.decision?.targets.find(item => item.taskId === taskId);
      const result = await scheduler.execute(missionId, taskId, { preferredHarnessId: target?.harnessId });
      return {
        executionId: result.executions.at(-1)?.executionId ?? `execution_unknown_${Date.now()}`,
        taskId,
        status: result.finalResult.status === 'COMPLETED' ? 'COMPLETED'
          : result.finalResult.status === 'QUOTA_EXHAUSTED' ? 'QUOTA_EXHAUSTED'
          : result.finalResult.status === 'TIMED_OUT' ? 'RECOVERABLE'
          : result.finalResult.status === 'AUTH_FAILED' ? 'RECOVERABLE'
          : 'FAILED',
        checkpointId: result.executions.at(-1)?.checkpointId,
        costUsd: result.finalResult.metrics?.costUsd,
        retryable: result.finalResult.status !== 'COMPLETED',
      };
    },
    measure: async (missionId, before, execution) => {
      const after = contextBuilder.build(missionId);
      return {
        measuredAt: new Date().toISOString(),
        progressMetric: after.progress.completionRatio,
        progressDelta: after.progress.completionRatio - before.completionRatio,
        taskStateChanges: before.context.taskGraph.tasks.reduce((count, task) => {
          const next = after.taskGraph.tasks.find(item => item.id === task.id);
          return count + (next?.state !== task.state ? 1 : 0);
        }, 0),
        graphVersion: new GraphBuilder().build(missions.snapshot(missionId)).version,
        execution,
      };
    },
    validate: async (missionId, taskId, execution) => {
      const context = contextBuilder.build(missionId);
      const applied = await intelligence.applier.apply(context, {
        decisionId: `loop_verify_${Date.now()}`,
        missionId,
        action: 'VERIFY',
        reasoning: 'Autonomous loop validation phase.',
        targets: [{ taskId }],
      });
      const after = contextBuilder.build(missionId);
      const executionResult = execution ? {
        passed: after.taskGraph.tasks.find(task => task.id === taskId)?.state === 'COMPLETED',
        checks: [{ name: 'task-completion', passed: after.taskGraph.tasks.find(task => task.id === taskId)?.state === 'COMPLETED' }],
      } : undefined;
      return {
        passed: executionResult?.passed ?? applied.progress,
        result: executionResult,
        reasons: applied.messages,
      };
    },
    adapt: async (missionId, observation, measurement, validation, interpretation) => {
      if (validation.passed && measurement.progressDelta > 0) return { action: 'CONTINUE', trigger: 'TASK_COMPLETED', progress: true, message: 'Validated progress; continuing the mission loop.' };
      if (measurement.execution?.status === 'QUOTA_EXHAUSTED' || measurement.execution?.status === 'WORKER_LOST') {
        return { action: 'RECOVER', trigger: measurement.execution.status === 'QUOTA_EXHAUSTED' ? 'QUOTA_EXHAUSTED' : 'WORKER_LOST', progress: false, message: 'Execution resource failed; next iteration will observe and recover.' };
      }
      if (!validation.passed) return { action: 'REPLAN', trigger: 'VALIDATION_FAILED', progress: false, message: 'Validation failed; next iteration will replan.' };
      if (observation.readyTasks.length === 0) {
        const complete = missions.evaluateCompletion(missionId);
        return complete.complete
          ? { action: 'COMPLETE', trigger: 'MISSION_NEAR_COMPLETION', progress: true, message: 'Mission completion criteria are satisfied.' }
          : { action: 'WAIT', trigger: 'PERIODIC_REVIEW', progress: false, message: 'No ready work is available yet.' };
      }
      return { action: 'CONTINUE', trigger: 'PERIODIC_REVIEW', progress: measurement.progressDelta > 0, message: 'Loop will continue observation.' };
    },
  };
  return new AutonomousLoopEngine(components, {
    maxIterations: config.loop.maxIterations,
    maxDecisions: config.budgets.jev.maxDecisions ?? 50,
    maxPlans: config.budgets.laya.maxRevisions ?? 10,
    maxExecutions: config.policies.maxRetriesPerTask * 100,
    maxValidations: config.loop.maxIterations,
    maxRecoveries: 10,
    maxReplans: config.loop.maxReplans,
    maxStagnantIterations: config.loop.stagnationThreshold,
    requireGraphConsistency: true,
    allowAutonomousExecution: config.policies.allowAutonomousExecution,
    ...options.policy,
  });
}

function interpretation(action: LoopInterpretation['action'], trigger: DecisionTrigger, reason: string, taskIds: string[], decision?: JevDecision): LoopInterpretation {
  return { action, trigger, reason, taskIds, decision, requiresPlanning: ['PLAN','REPLAN','RECOVER'].includes(action) };
}

function defaultConfig(): IntelligenceConfig {
  return {
    mode: 'AUTONOMOUS',
    jev: { enabled: true, provider: 'jev-http', timeoutMs: 60_000, maxRetries: 2 },
    laya: { enabled: true, runtime: 'local-process', model: 'configured', timeoutMs: 120_000 },
    policies: { allowAutonomousExecution: true, allowReplanning: true, allowParallelization: true, allowTaskCreation: true, allowTaskCancellation: true, requireApprovalFor: [], maxRetriesPerTask: 3, maxReplansPerTask: 5, maxStrategicEscalationsPerTask: 3 },
    planning: { maxDepth: 3, maxTasksPerPlan: 20, maxTotalTasks: 100, maxDependencyEdges: 100, maxPlanRevisions: 10 },
    budgets: { jev: { maxDecisions: 50, decisionsUsed: 0, estimatedCostUsd: 0, tokensUsed: 0 }, laya: { maxPlanningTimeMs: 120000, maxPlanDepth: 3, maxTasksPerPlan: 20, maxRevisions: 10 } },
    loop: { maxIterations: 100, maxReplans: 10, stagnationThreshold: 5 },
  };
}

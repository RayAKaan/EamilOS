import type { DecisionTrigger } from '../intelligence/types.js';
import { LoopEventLog } from './LoopEventLog.js';
import { LoopStateStore } from './LoopStateStore.js';
import type {
  AutonomousLoopComponents,
  AutonomousLoopPolicy,
  AutonomousLoopResult,
  AutonomousLoopState,
  LoopAdaptation,
  LoopInterpretation,
  LoopMeasurement,
  LoopObservation,
  LoopPhase,
  LoopValidation,
} from './types.js';

const TERMINAL: ReadonlySet<AutonomousLoopState['status']> = new Set([
  'COMPLETED', 'ESCALATED', 'FAILED', 'ABORTED',
]);

export class AutonomousLoopEngine {
  constructor(
    private readonly components: AutonomousLoopComponents,
    private readonly policy: AutonomousLoopPolicy,
    private readonly states = new LoopStateStore(),
    private readonly eventLog = new LoopEventLog(),
  ) {}

  async run(missionId: string, initialTrigger: DecisionTrigger = 'USER_REQUESTED'): Promise<AutonomousLoopResult> {
    let state = await this.states.load(missionId);
    if (!state) {
      const now = new Date().toISOString();
      state = {
        missionId,
        status: 'RUNNING',
        phase: 'OBSERVE',
        iteration: 0,
        graphVersion: 0,
        lastProgressMetric: 0,
        counters: {
          iterations: 0, decisions: 0, plans: 0, executions: 0,
          validations: 0, recoveries: 0, replans: 0, stagnantIterations: 0,
        },
        lastTrigger: initialTrigger,
        startedAt: now,
        updatedAt: now,
      };
      await this.states.save(state);
      await this.event(state, 'loop.started');
    } else if (TERMINAL.has(state.status)) {
      return this.result(state);
    } else {
      state.status = 'RUNNING';
      await this.states.save(state);
      await this.event(state, 'loop.resumed');
    }

    const started = Date.now();

    while (state.counters.iterations < this.policy.maxIterations) {
      if (this.policy.maxWallTimeMs !== undefined && Date.now() - started >= this.policy.maxWallTimeMs) {
        return this.terminate(state, 'ESCALATED', 'Maximum loop wall time reached');
      }

      const budget = this.budgetExceeded(state);
      if (budget) return this.terminate(state, 'ESCALATED', budget);

      state.counters.iterations += 1;
      state.iteration = state.counters.iterations;
      state.phase = 'OBSERVE';
      state.updatedAt = new Date().toISOString();
      await this.states.save(state);
      await this.event(state, 'phase.started');

      let observation: LoopObservation;
      try {
        observation = await this.components.observe(missionId, state.iteration);
        state.graphVersion = observation.graph.version;
        await this.event(state, 'observe.completed', {
          graphVersion: observation.graph.version,
          progressMetric: observation.progressMetric,
          completionRatio: observation.completionRatio,
        });

        if (this.policy.requireGraphConsistency && !observation.graphHealth.consistent) {
          return this.terminate(state, 'ESCALATED', 'Cognitive graph consistency check failed');
        }

        if (observation.context.mission.status === 'completed') {
          return this.terminate(state, 'COMPLETED', 'Mission completion criteria satisfied');
        }
        if (observation.context.mission.status === 'cancelled') {
          return this.terminate(state, 'ABORTED', 'Mission was cancelled');
        }

        state.phase = 'INTERPRET';
        await this.states.save(state);
        const interpretation = await this.components.interpret(observation);
        state.lastAction = interpretation.action;
        state.lastTrigger = interpretation.trigger;
        state.lastTaskId = interpretation.taskIds[0];
        if (interpretation.decision) {
          state.lastDecisionId = interpretation.decision.decisionId;
          state.counters.decisions += 1;
        }
        await this.event(state, 'interpret.completed', {
          action: interpretation.action,
          trigger: interpretation.trigger,
          taskIds: interpretation.taskIds,
          reason: interpretation.reason,
        });

        if (interpretation.action === 'COMPLETE') {
          return this.terminate(state, 'COMPLETED', interpretation.reason);
        }
        if (interpretation.action === 'ABORT') {
          return this.terminate(state, 'ABORTED', interpretation.reason);
        }
        if (interpretation.action === 'ESCALATE') {
          return this.terminate(state, 'ESCALATED', interpretation.reason);
        }

        let planResult: Awaited<ReturnType<AutonomousLoopComponents['plan']>> | undefined;
        if (interpretation.requiresPlanning || ['PLAN', 'REPLAN', 'RECOVER'].includes(interpretation.action)) {
          state.phase = 'PLAN';
          state.counters.plans += 1;
          if (interpretation.action === 'REPLAN') state.counters.replans += 1;
          await this.states.save(state);
          planResult = await this.components.plan(missionId, observation, interpretation);
          await this.event(state, 'plan.completed', {
            planned: planResult.planned,
            action: planResult.action,
            message: planResult.message,
          });
          if (!planResult.planned && interpretation.action !== 'WAIT') {
            state.counters.stagnantIterations += 1;
            await this.states.save(state);
            continue;
          }
        }

        let execution;
        if (['EXECUTE', 'RETRY', 'REASSIGN'].includes(interpretation.action)) {
          if (!this.policy.allowAutonomousExecution) {
            return this.terminate(state, 'ESCALATED', 'Autonomous execution is disabled by policy');
          }
          const taskId = interpretation.taskIds[0];
          if (!taskId) {
            state.counters.stagnantIterations += 1;
            await this.states.save(state);
            continue;
          }
          state.phase = 'EXECUTE';
          state.counters.executions += 1;
          await this.states.save(state);
          execution = await this.components.execute(missionId, taskId, interpretation);
          state.lastExecutionId = execution.executionId;
          state.lastCheckpointId = execution.checkpointId;
          await this.event(state, 'execute.completed', {
            executionId: execution.executionId,
            taskId: execution.taskId,
            status: execution.status,
            checkpointId: execution.checkpointId,
          });
        }

        state.phase = 'MEASURE';
        await this.states.save(state);
        const measurement = await this.components.measure(missionId, observation, execution);
        await this.event(state, 'measure.completed', {
          progressMetric: measurement.progressMetric,
          progressDelta: measurement.progressDelta,
          taskStateChanges: measurement.taskStateChanges,
          graphVersion: measurement.graphVersion,
        });

        state.phase = 'VALIDATE';
        state.counters.validations += 1;
        await this.states.save(state);
        const validationTask = interpretation.taskIds[0] ?? execution?.taskId;
        const validation: LoopValidation = validationTask
          ? await this.components.validate(missionId, validationTask, execution)
          : { passed: measurement.progressDelta >= 0, reasons: ['No task selected; validation was observational only.'] };
        await this.event(state, 'validate.completed', {
          passed: validation.passed,
          reasons: validation.reasons,
        });

        state.phase = 'ADAPT';
        await this.states.save(state);
        const adaptation = await this.components.adapt(
          missionId, observation, measurement, validation, interpretation,
        );
        await this.event(state, 'adapt.completed', {
          action: adaptation.action,
          trigger: adaptation.trigger,
          progress: adaptation.progress,
          message: adaptation.message,
        });

        if (adaptation.action === 'RECOVER') state.counters.recoveries += 1;

        if (adaptation.progress || measurement.progressDelta > 0) {
          state.counters.stagnantIterations = 0;
          state.lastProgressMetric = measurement.progressMetric;
        } else {
          state.counters.stagnantIterations += 1;
        }

        if (adaptation.action === 'COMPLETE') {
          return this.terminate(state, 'COMPLETED', adaptation.message);
        }
        if (adaptation.action === 'ABORT') {
          return this.terminate(state, 'ABORTED', adaptation.message);
        }
        if (adaptation.action === 'ESCALATE' || state.counters.stagnantIterations >= this.policy.maxStagnantIterations) {
          return this.terminate(
            state,
            'ESCALATED',
            adaptation.action === 'ESCALATE' ? adaptation.message : 'Loop stagnation threshold reached',
          );
        }

        state.phase = 'OBSERVE';
        state.updatedAt = new Date().toISOString();
        await this.states.save(state);
      } catch (error) {
        state.status = 'FAILED';
        state.terminationReason = error instanceof Error ? error.message : String(error);
        state.updatedAt = new Date().toISOString();
        await this.states.save(state);
        await this.event(state, 'loop.failed', { error: state.terminationReason });
        return this.result(state);
      }
    }

    return this.terminate(state, 'ESCALATED', 'Maximum loop iterations reached');
  }

  async pause(missionId: string): Promise<AutonomousLoopState> {
    const state = await this.states.load(missionId);
    if (!state || TERMINAL.has(state.status)) throw new Error('Loop is not active');
    state.status = 'PAUSED';
    state.updatedAt = new Date().toISOString();
    await this.states.save(state);
    await this.event(state, 'loop.paused');
    return state;
  }

  async status(missionId: string): Promise<AutonomousLoopState | undefined> {
    return this.states.load(missionId);
  }

  async events(missionId: string) {
    return this.eventLog.all(missionId);
  }

  private async terminate(state: AutonomousLoopState, status: AutonomousLoopState['status'], reason: string): Promise<AutonomousLoopResult> {
    state.status = status;
    state.terminationReason = reason;
    state.updatedAt = new Date().toISOString();
    state.phase = status === 'COMPLETED' ? 'ADAPT' : state.phase;
    await this.states.save(state);
    await this.event(state, `loop.${status.toLowerCase()}`, { reason });
    return this.result(state);
  }

  private async event(state: AutonomousLoopState, type: string, payload: Record<string, unknown> = {}) {
    await this.eventLog.append({
      missionId: state.missionId,
      iteration: state.iteration,
      phase: state.phase,
      type,
      payload,
    });
  }

  private budgetExceeded(state: AutonomousLoopState): string | undefined {
    const checks: Array<[number, number, string]> = [
      [state.counters.decisions, this.policy.maxDecisions, 'Maximum decision budget reached'],
      [state.counters.plans, this.policy.maxPlans, 'Maximum planning budget reached'],
      [state.counters.executions, this.policy.maxExecutions, 'Maximum execution budget reached'],
      [state.counters.validations, this.policy.maxValidations, 'Maximum validation budget reached'],
      [state.counters.recoveries, this.policy.maxRecoveries, 'Maximum recovery budget reached'],
      [state.counters.replans, this.policy.maxReplans, 'Maximum replan budget reached'],
    ];
    const hit = checks.find(([used, max]) => used >= max);
    return hit?.[2];
  }

  private result(state: AutonomousLoopState): AutonomousLoopResult {
    return {
      status: state.status,
      missionId: state.missionId,
      iterations: state.counters.iterations,
      decisions: state.counters.decisions,
      plans: state.counters.plans,
      executions: state.counters.executions,
      validations: state.counters.validations,
      recoveries: state.counters.recoveries,
      replans: state.counters.replans,
      stagnantIterations: state.counters.stagnantIterations,
      finalGraphVersion: state.graphVersion,
      terminationReason: state.terminationReason ?? state.status,
    };
  }
}

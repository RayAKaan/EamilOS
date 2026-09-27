import { randomUUID } from 'crypto';
import type { ResourceRef } from '../coordination/types.js';
import { CoordinationEngine } from '../coordination/CoordinationEngine.js';
import { MissionEngine } from '../mission/MissionEngine.js';
import { CandidateSelector } from './CandidateSelector.js';
import { ExecutionStore } from './ExecutionStore.js';
import { ExecutionSupervisor } from './ExecutionSupervisor.js';
import { HarnessRegistry } from './HarnessRegistry.js';
import {
  getFailureRecoveryDecision,
} from './FailurePolicy.js';
import type {
  ExecutionCheckpoint,
  ExecutionFailure,
  ExecutionRecord,
  HarnessExecutionRequest,
  HarnessExecutionResult,
} from './types.js';

export interface ScheduleExecutionOptions {
  prompt?: string;
  workingDir?: string;
  timeoutMs?: number;
  preferredHarnessId?: string;
  readSet?: ResourceRef[];
  writeSet?: ResourceRef[];
  environment?: Record<string, string>;
  policy?: Record<string, unknown>;
  onOutput?: (harnessId: string, chunk: string) => void;
}

export interface ScheduleExecutionResult {
  completed: boolean;
  validationRequired: boolean;
  attempts: number;
  finalResult: HarnessExecutionResult;
  executions: ExecutionRecord[];
}

export class HarnessScheduler {
  private readonly selector = new CandidateSelector();
  private readonly supervisor = new ExecutionSupervisor();

  constructor(
    private readonly missions: MissionEngine,
    private readonly coordination: CoordinationEngine,
    private readonly registry: HarnessRegistry,
    private readonly store: ExecutionStore = new ExecutionStore(),
  ) {}

  async execute(
    missionId: string,
    taskId: string,
    options: ScheduleExecutionOptions = {},
  ): Promise<ScheduleExecutionResult> {
    const mission = this.missions.snapshot(missionId).mission;
    const initialTask = this.missions.snapshot(missionId).tasks.find((task) => task.id === taskId);

    if (!initialTask) throw new Error(`Task not found: ${taskId}`);
    if (!['READY', 'RECOVERABLE'].includes(initialTask.state)) {
      throw new Error(`Task ${taskId} is not executable from ${initialTask.state}`);
    }

    await this.registry.refresh();

    const excludedHarnesses = new Set<string>();
    const executions: ExecutionRecord[] = [];
    let checkpoint: ExecutionCheckpoint | undefined;
    let lastResult: HarnessExecutionResult | undefined;
    let retrySameHarness = false;
    let preferredHarness = options.preferredHarnessId;

    const maxAttempts = Math.max(1, initialTask.maxAttempts);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const task = this.missions.snapshot(missionId).tasks.find((candidate) => candidate.id === taskId)!;

      const candidate = this.selector.select({
        task,
        harnesses: this.registry.available(),
        excludedHarnesses: retrySameHarness ? new Set<string>() : excludedHarnesses,
        preferredHarnessId: preferredHarness,
      });

      if (!candidate) {
        if (lastResult) {
          return {
            completed: false,
            validationRequired: false,
            attempts: executions.length,
            finalResult: lastResult,
            executions,
          };
        }
        throw new Error(`No compatible harness is available for task ${taskId}`);
      }

      const adapter = this.registry.get(candidate.harnessId);
      if (!adapter) throw new Error(`Harness '${candidate.harnessId}' is not registered`);

      const executionId = `execution_${randomUUID()}`;
      const owner = `execution:${executionId}`;
      const lease = this.missions.acquireLease(missionId, taskId, owner);
      let reservationId: string | undefined;

      try {
        const resources = [
          ...(options.readSet ?? []),
          ...(options.writeSet ?? []),
        ];
        if (resources.length > 0) {
          const reservation = this.coordination.reserveTaskResources(
            missionId,
            taskId,
            candidate.harnessId,
            resources.map((resource) => `${resource.kind}:${resource.id}`),
          );
          reservationId = reservation.id;
        }

        this.missions.transitionTask(missionId, taskId, 'RUNNING');

        const now = new Date().toISOString();
        const record: ExecutionRecord = {
          executionId,
          missionId,
          taskId,
          harnessId: candidate.harnessId,
          nodeId: candidate.workerId,
          state: 'RUNNING',
          attempts: attempt,
          startedAt: now,
          updatedAt: now,
        };
        this.store.saveExecution(record);

        const request: HarnessExecutionRequest = {
          executionId,
          missionId,
          taskId,
          harnessId: candidate.harnessId,
          nodeId: candidate.workerId,
          workingDir: options.workingDir ?? mission.workingDir,
          prompt: options.prompt ?? task.description,
          context: {
            missionGoal: mission.goal,
            taskObjective: task.description,
            acceptanceCriteria: task.acceptanceCriteria,
            relevantFiles: task.inputs.relevantFiles instanceof Array
              ? task.inputs.relevantFiles.filter((item): item is string => typeof item === 'string')
              : [],
            dependencies: task.dependencies,
            checkpoint,
          },
          resources: {
            readSet: options.readSet ?? [],
            writeSet: options.writeSet ?? [],
          },
          timeoutMs: options.timeoutMs ?? 300_000,
          environment: options.environment ?? {},
          policy: options.policy ?? {},
        };

        const result = await this.supervisor.run(
          adapter,
          request,
          (chunk) => options.onOutput?.(candidate.harnessId, chunk),
        );

        lastResult = result;

        const finalState = result.status === 'COMPLETED'
          ? 'VALIDATING'
          : result.status === 'TIMED_OUT'
            ? 'RECOVERABLE'
            : result.status === 'QUOTA_EXHAUSTED'
              ? 'RECOVERABLE'
              : result.status === 'AUTH_FAILED'
                ? 'RECOVERABLE'
                : result.status === 'RECOVERABLE'
                  ? 'RECOVERABLE'
                  : 'FAILED';

        if (result.status === 'COMPLETED') {
          this.missions.updateTask(missionId, taskId, {
            outputs: { output: result.output ?? '' },
            artifacts: result.artifacts.map((artifact) => artifact.path),
            error: undefined,
          });
        } else {
          this.missions.updateTask(missionId, taskId, {
            error: result.error?.message ?? 'Harness execution failed',
          });
        }

        const updatedRecord: ExecutionRecord = {
          ...record,
          state: finalState,
          completedAt: result.metrics.completedAt,
          checkpointId: result.checkpoint?.id,
          failure: result.error?.type,
          result,
          updatedAt: new Date().toISOString(),
        };
        this.store.saveExecution(updatedRecord);
        executions.push(updatedRecord);

        if (result.status === 'COMPLETED') {
          this.missions.transitionTask(missionId, taskId, 'VALIDATING');
          this.missions.releaseLease(missionId, lease.id);
          if (reservationId) {
            this.coordination.releaseReservation(missionId, reservationId);
            reservationId = undefined;
          }
          return {
            completed: false,
            validationRequired: true,
            attempts: executions.length,
            finalResult: result,
            executions,
          };
        }

        const failure = result.error?.type ?? this.failureFromResult(result);
        const recovery = getFailureRecoveryDecision(failure);

        if (recovery.checkpointBeforeRecovery) {
          checkpoint = this.syntheticCheckpoint(request, result, failure);
          this.store.saveCheckpoint(checkpoint);
        }

        if (recovery.requiresUser) {
          this.missions.transitionTask(missionId, taskId, 'ESCALATED');
          this.missions.releaseLease(missionId, lease.id);
          return {
            completed: false,
            validationRequired: false,
            attempts: executions.length,
            finalResult: result,
            executions,
          };
        }

        this.missions.transitionTask(missionId, taskId, 'RECOVERABLE');
        this.missions.releaseLease(missionId, lease.id);

        if (reservationId) {
          this.coordination.releaseReservation(missionId, reservationId);
          reservationId = undefined;
        }

        if (recovery.fallbackToAnotherHarness) {
          excludedHarnesses.add(candidate.harnessId);
        }

        retrySameHarness = recovery.retrySameHarness && !excludedHarnesses.has(candidate.harnessId);
        preferredHarness = retrySameHarness ? candidate.harnessId : undefined;
      } catch (error) {
        if (reservationId) {
          try { this.coordination.releaseReservation(missionId, reservationId); } catch { /* cleanup */ }
        }

        try {
          this.missions.releaseLease(missionId, lease.id);
        } catch {
          // The lease may already have expired or been released.
        }

        throw error;
      }
    }

    if (!lastResult) {
      throw new Error(`Task ${taskId} produced no execution result`);
    }

    return {
      completed: false,
      validationRequired: false,
      attempts: executions.length,
      finalResult: lastResult,
      executions,
    };
  }

  private syntheticCheckpoint(
    request: HarnessExecutionRequest,
    result: HarnessExecutionResult,
    failure: ExecutionFailure,
  ): ExecutionCheckpoint {
    return {
      id: `checkpoint_${randomUUID()}`,
      missionId: request.missionId,
      taskId: request.taskId,
      executionId: request.executionId,
      harnessId: request.harnessId,
      nodeId: request.nodeId,
      createdAt: new Date().toISOString(),
      progress: {
        completedSteps: [],
        remainingSteps: [request.context.taskObjective],
      },
      output: result.output ?? '',
      artifacts: result.artifacts,
      resumeContext: `Execution interrupted by ${failure}. Continue from the recorded output and artifacts without repeating completed work.`,
      metadata: {
        failure,
      },
    };
  }

  private failureFromResult(result: HarnessExecutionResult): ExecutionFailure {
    if (result.status === 'TIMED_OUT') return 'TIMEOUT';
    if (result.status === 'QUOTA_EXHAUSTED') return 'QUOTA_EXHAUSTED';
    if (result.status === 'AUTH_FAILED') return 'AUTH_FAILED';
    return 'UNKNOWN';
  }
}

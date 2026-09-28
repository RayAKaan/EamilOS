import { randomUUID } from 'node:crypto';
import type { MissionEngine } from '../mission/MissionEngine.js';
import type { LoopObservation, LoopMeasurement, LoopValidation } from '../loop/types.js';
import type { RuntimeExecutionResult } from '../runtime/types.js';
import { GraphBuilder } from './GraphBuilder.js';
import { GraphValidator } from './GraphValidator.js';
import { GraphEventLog } from './GraphEventLog.js';
import { graphStateHash } from './CognitiveGraph.js';
import type { GraphSnapshot } from './types.js';

export type GraphAdaptationKind =
  | 'ADD_RECOVERY_TASK'
  | 'ADD_DEPENDENCY'
  | 'UPDATE_TASK_INPUTS';

export interface GraphAdaptationPolicy {
  allowTaskCreation: boolean;
  allowDependencyChanges: boolean;
  allowTaskInputChanges: boolean;
  maxMutationsPerIteration: number;
  requireGraphConsistency: boolean;
}

export interface GraphAdaptationProposal {
  proposalId: string;
  missionId: string;
  baseGraphVersion: number;
  kind: GraphAdaptationKind;
  targetTaskId?: string;
  title: string;
  reason: string;
  dependencies?: string[];
  requiredCapabilities?: string[];
  acceptanceCriteria?: string[];
  inputs?: Record<string, unknown>;
  idempotencyKey: string;
}

export interface GraphAdaptationResult {
  changed: boolean;
  graph: GraphSnapshot;
  proposal?: GraphAdaptationProposal;
  messages: string[];
  rejectedReason?: string;
}

export class GraphAdaptationEngine {
  constructor(
    private readonly missions: MissionEngine,
    private readonly policy: GraphAdaptationPolicy,
    private readonly eventLog = new GraphEventLog(),
  ) {}

  propose(
    observation: LoopObservation,
    measurement: LoopMeasurement,
    validation: LoopValidation,
    execution?: RuntimeExecutionResult,
  ): GraphAdaptationProposal | undefined {
    const taskId = execution?.taskId ?? observation.failedTasks[0] ?? observation.blockedTasks[0];
    const task = taskId
      ? observation.context.taskGraph.tasks.find(candidate => candidate.id === taskId)
      : undefined;

    if (!task) return undefined;

    const failure = execution?.status === 'QUOTA_EXHAUSTED'
      ? 'harness quota exhaustion'
      : execution?.status === 'WORKER_LOST'
        ? 'worker loss'
        : execution?.status === 'RECOVERABLE'
          ? 'recoverable execution failure'
          : !validation.passed
            ? 'validation failure'
            : undefined;

    if (!failure) return undefined;

    const proposalId = `adapt_${randomUUID()}`;
    const idempotencyKey = `recovery:${observation.missionId}:${task.id}:${task.attempt}:${failure}`;

    return {
      proposalId,
      missionId: observation.missionId,
      baseGraphVersion: observation.graph.version,
      kind: 'ADD_RECOVERY_TASK',
      targetTaskId: task.id,
      title: `Recover: ${task.title}`,
      reason: `Create a deterministic recovery/diagnostic step before retrying ${task.id} after ${failure}.`,
      dependencies: [...task.dependencies],
      requiredCapabilities: [...task.requiredCapabilities],
      acceptanceCriteria: [
        'Identify or mitigate the cause of the preceding execution failure.',
        'Produce evidence sufficient for the original task to be retried.',
      ],
      inputs: {
        recoveryForTaskId: task.id,
        failure,
        previousAttempt: task.attempt,
        observedGraphVersion: observation.graph.version,
        progressDelta: measurement.progressDelta,
      },
      idempotencyKey,
    };
  }

  apply(
    observation: LoopObservation,
    measurement: LoopMeasurement,
    validation: LoopValidation,
    execution?: RuntimeExecutionResult,
  ): GraphAdaptationResult {
    const current = observation.graph;
    const validator = new GraphValidator();
    if (this.policy.requireGraphConsistency) validator.assertValid(current);

    const proposal = this.propose(observation, measurement, validation, execution);
    if (!proposal) {
      return { changed: false, graph: current, messages: ['No safe graph adaptation was identified.'] };
    }

    if (proposal.baseGraphVersion !== observation.graph.version) {
      return {
        changed: false,
        graph: current,
        proposal,
        rejectedReason: 'Observation graph version is stale.',
        messages: ['Graph adaptation rejected because its observation is stale.'],
      };
    }

    if (proposal.kind === 'ADD_RECOVERY_TASK' && !this.policy.allowTaskCreation) {
      return {
        changed: false,
        graph: current,
        proposal,
        rejectedReason: 'Task creation is disabled by graph adaptation policy.',
        messages: ['Graph adaptation rejected by task-creation policy.'],
      };
    }

    const existing = this.missions.snapshot(observation.missionId).tasks.find(
      task => task.idempotencyKey === proposal.idempotencyKey,
    );
    if (existing) {
      return {
        changed: false,
        graph: current,
        proposal,
        messages: [`Recovery task already exists: ${existing.id}.`],
      };
    }

    if (this.policy.maxMutationsPerIteration < 1) {
      return {
        changed: false,
        graph: current,
        proposal,
        rejectedReason: 'Mutation budget exhausted.',
        messages: ['Graph adaptation rejected because the mutation budget is zero.'],
      };
    }

    if (proposal.kind !== 'ADD_RECOVERY_TASK') {
      return { changed: false, graph: current, proposal, messages: ['No applicable mutation handler exists for this proposal.'] };
    }

    const target = this.missions.snapshot(observation.missionId).tasks.find(task => task.id === proposal.targetTaskId);
    if (!target) {
      return {
        changed: false,
        graph: current,
        proposal,
        rejectedReason: 'Target task no longer exists.',
        messages: ['Graph adaptation rejected because the target task disappeared.'],
      };
    }

    const recovery = this.missions.addTask(observation.missionId, {
      title: proposal.title,
      description: proposal.reason,
      dependencies: proposal.dependencies,
      priority: target.priority,
      requiredCapabilities: proposal.requiredCapabilities,
      acceptanceCriteria: proposal.acceptanceCriteria,
      inputs: proposal.inputs,
      maxAttempts: target.maxAttempts,
      idempotencyKey: proposal.idempotencyKey,
    });

    this.missions.updateTask(observation.missionId, target.id, {
      dependencies: [...new Set([...target.dependencies, recovery.id])],
    });

    const rebuilt = new GraphBuilder().build(this.missions.snapshot(observation.missionId));
    const next = this.withMonotonicVersion(rebuilt, current.version + 1);
    if (this.policy.requireGraphConsistency) validator.assertValid(next);

    this.eventLog.append({
      missionId: observation.missionId,
      version: next.version,
      type: 'graph.adaptation.applied',
      timestamp: new Date().toISOString(),
      actor: 'phase-11-adaptation-engine',
      mutationId: proposal.proposalId,
      payload: {
        kind: proposal.kind,
        targetTaskId: target.id,
        recoveryTaskId: recovery.id,
        reason: proposal.reason,
        baseGraphVersion: proposal.baseGraphVersion,
      },
    });

    return {
      changed: true,
      graph: next,
      proposal,
      messages: [
        `Created recovery task ${recovery.id}.`,
        `Added recovery task as a prerequisite of ${target.id}.`,
      ],
    };
  }

  events(missionId: string) {
    return this.eventLog.all(missionId);
  }

  private withMonotonicVersion(snapshot: GraphSnapshot, version: number): GraphSnapshot {
    const nodes = snapshot.nodes.map(node => ({ ...node, version }));
    const edges = snapshot.edges.map(edge => ({ ...edge, version }));
    return {
      ...snapshot,
      version,
      nodes,
      edges,
      stateHash: graphStateHash(nodes, edges),
    };
  }
}

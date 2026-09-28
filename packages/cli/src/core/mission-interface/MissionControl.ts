import { GraphBuilder, GraphQueryEngine, GraphValidator } from '../cognitive-graph/index.js';
import { MissionEngine } from '../mission/MissionEngine.js';
import { createAutonomousLoopRuntime } from '../loop/AutonomousLoopFactory.js';
import type { AutonomousLoopEngine, LoopInterpretation } from '../loop/index.js';
import { LoopStateStore } from '../loop/LoopStateStore.js';
import { LoopEventLog } from '../loop/LoopEventLog.js';
import { defaultIntelligenceConfig } from '../intelligence/IntelligenceEngine.js';
import type { IntelligenceConfig } from '../intelligence/types.js';
import { ApprovalStore } from './ApprovalStore.js';
import { MissionPolicyStore } from './MissionPolicyStore.js';
import { buildMissionReport, type MissionReport } from './MissionReport.js';
import {
  MissionPolicySchema,
  type ApprovalRequest,
  type MissionAskResult,
  type MissionControlAction,
  type MissionPolicy,
  type MissionRunResult,
  type MissionStartResult,
  type MissionStatusView,
} from './types.js';

const LOOP_ACTION_TO_CONTROL: Partial<Record<LoopInterpretation['action'], MissionControlAction>> = {
  PLAN: 'PLAN',
  EXECUTE: 'EXECUTE',
  RETRY: 'RETRY',
  REASSIGN: 'REASSIGN',
  REPLAN: 'REPLAN',
  VERIFY: 'VERIFY',
  COMPLETE: 'COMPLETE',
  ESCALATE: 'ESCALATE',
  ABORT: 'ABORT',
  RECOVER: 'RETRY',
};

export class MissionControl {
  readonly missions: MissionEngine;
  readonly policies: MissionPolicyStore;
  readonly approvals: ApprovalStore;

  constructor(
    missions = new MissionEngine(),
    policies = new MissionPolicyStore(),
    approvals = new ApprovalStore(),
  ) {
    this.missions = missions;
    this.policies = policies;
    this.approvals = approvals;
  }

  async create(input: {
    goal: string;
    workingDir?: string;
    autonomy?: MissionPolicy['autonomy'];
    requireApprovalFor?: MissionPolicy['requireApprovalFor'];
    constraints?: Parameters<MissionEngine['createMission']>[0]['constraints'];
    requirements?: Parameters<MissionEngine['createMission']>[0]['requirements'];
    metadata?: Record<string, unknown>;
  }) {
    if (!input.goal.trim()) throw new Error('Mission goal cannot be empty.');
    const policy = this.resolvePolicy({
      autonomy: input.autonomy,
      requireApprovalFor: input.requireApprovalFor,
    });
    const mission = this.missions.createMission({
      goal: input.goal.trim(),
      workingDir: input.workingDir ?? process.cwd(),
      constraints: input.constraints,
      requirements: input.requirements,
      metadata: {
        ...input.metadata,
        eamilos: {
          interfaceVersion: 1,
          autonomy: policy.autonomy,
        },
      },
    });
    await this.policies.save(mission.id, policy);
    return mission;
  }

  async getPolicy(missionId: string): Promise<MissionPolicy> {
    const stored = await this.policies.load(missionId);
    return stored ?? MissionPolicySchema.parse({});
  }

  async setPolicy(missionId: string, updates: Partial<MissionPolicy>): Promise<MissionPolicy> {
    const current = await this.getPolicy(missionId);
    const next = MissionPolicySchema.parse({ ...current, ...updates });
    const status = this.missions.snapshot(missionId).mission.status;
    if (status === 'active') throw new Error('Pause the mission before changing its control policy.');
    await this.policies.save(missionId, next);
    return next;
  }

  async start(missionId: string): Promise<MissionStartResult> {
    const policy = await this.getPolicy(missionId);
    const approval = await this.ensureControlApproval(missionId, policy, 'START', undefined, 'Start autonomous execution of this mission.');
    if (approval) return { started: false, missionId, approval };

    const mission = this.missions.snapshot(missionId).mission;
    if (mission.status === 'created') this.missions.start(missionId);
    else if (mission.status === 'paused') this.missions.resume(missionId);
    else if (mission.status !== 'active') throw new Error(`Mission ${missionId} cannot start from ${mission.status}`);

    const loop = this.runtimeFor(missionId, policy);
    const loopResult = await loop.run(missionId, 'USER_REQUESTED');
    const final = this.missions.snapshot(missionId).mission;
    return {
      started: true,
      missionId,
      result: { missionId, status: final.status, loop: loopResult },
    };
  }

  async pause(missionId: string) {
    const stateStore = new LoopStateStore();
    const state = await stateStore.load(missionId);
    if (state && !['PAUSED', 'COMPLETED', 'ABORTED', 'FAILED', 'ESCALATED'].includes(state.status)) {
      state.status = 'PAUSED';
      state.terminationReason = 'Mission paused by user.';
      state.updatedAt = new Date().toISOString();
      await stateStore.save(state);
      await new LoopEventLog().append({
        missionId,
        iteration: state.iteration,
        phase: state.phase,
        type: 'loop.paused',
        payload: { reason: state.terminationReason },
      });
    }
    const mission = this.missions.snapshot(missionId).mission;
    if (mission.status === 'active') this.missions.pause(missionId);
    return this.status(missionId);
  }

  async resume(missionId: string): Promise<MissionStartResult> {
    const policy = await this.getPolicy(missionId);
    const approval = await this.ensureControlApproval(missionId, policy, 'START', undefined, 'Resume autonomous execution of this mission.');
    if (approval) return { started: false, missionId, approval };

    const mission = this.missions.snapshot(missionId).mission;
    if (mission.status === 'paused') this.missions.resume(missionId);
    else if (mission.status !== 'active') throw new Error(`Mission ${missionId} cannot resume from ${mission.status}`);
    const result = await this.runtimeFor(missionId, policy).run(missionId, 'USER_REQUESTED');
    return {
      started: true,
      missionId,
      result: { missionId, status: this.missions.snapshot(missionId).mission.status, loop: result },
    };
  }

  async cancel(missionId: string): Promise<MissionStatusView> {
    const policy = await this.getPolicy(missionId);
    const approval = await this.ensureControlApproval(missionId, policy, 'ABORT', undefined, 'Cancel and abort this mission.');
    if (approval) throw new Error(`Approval required: ${approval.id}`);
    const stateStore = new LoopStateStore();
    const loopState = await stateStore.load(missionId);
    if (loopState && !['COMPLETED', 'ABORTED', 'FAILED', 'ESCALATED'].includes(loopState.status)) {
      loopState.status = 'ABORTED';
      loopState.terminationReason = 'Mission cancelled by user.';
      loopState.updatedAt = new Date().toISOString();
      await stateStore.save(loopState);
      await new LoopEventLog().append({
        missionId,
        iteration: loopState.iteration,
        phase: loopState.phase,
        type: 'loop.aborted',
        payload: { reason: loopState.terminationReason },
      });
    }
    this.missions.cancel(missionId);
    return this.status(missionId);
  }

  async replan(missionId: string): Promise<MissionStartResult> {
    const policy = await this.getPolicy(missionId);
    const approval = await this.ensureControlApproval(missionId, policy, 'REPLAN', undefined, 'Request a new strategic plan for the mission.');
    if (approval) return { started: false, missionId, approval };
    if (!policy.allowReplanning) throw new Error('Replanning is disabled by the mission policy.');
    const mission = this.missions.snapshot(missionId).mission;
    if (mission.status === 'paused') this.missions.resume(missionId);
    if (this.missions.snapshot(missionId).mission.status === 'created') this.missions.start(missionId);
    const loop = this.runtimeFor(missionId, policy);
    const result = await loop.run(missionId, 'USER_REQUESTED');
    return {
      started: true,
      missionId,
      result: { missionId, status: this.missions.snapshot(missionId).mission.status, loop: result },
    };
  }

  async status(missionId: string): Promise<MissionStatusView> {
    const snapshot = this.missions.snapshot(missionId);
    const policy = await this.getPolicy(missionId);
    const graph = new GraphBuilder().build(snapshot);
    const health = new GraphValidator().validate(graph);
    const loop = await new LoopStateStore().load(missionId);
    const approvals = await this.approvals.list(missionId);
    const completed = snapshot.tasks.filter(task => task.state === 'COMPLETED').length;
    return {
      missionId,
      goal: snapshot.mission.goal,
      status: snapshot.mission.status,
      autonomy: policy.autonomy,
      progress: {
        totalTasks: snapshot.tasks.length,
        completedTasks: completed,
        runningTasks: snapshot.tasks.filter(task => task.state === 'RUNNING').length,
        readyTasks: snapshot.tasks.filter(task => task.state === 'READY').length,
        blockedTasks: snapshot.tasks.filter(task => task.state === 'BLOCKED').length,
        failedTasks: snapshot.tasks.filter(task => task.state === 'FAILED').length,
        completionRatio: snapshot.tasks.length ? completed / snapshot.tasks.length : 0,
      },
      loop,
      graph: {
        version: graph.version,
        stateHash: graph.stateHash,
        consistent: health.consistent,
        nodes: graph.nodes.length,
        edges: graph.edges.length,
      },
      approvals,
    };
  }

  async report(missionId: string): Promise<MissionReport> {
    const snapshot = this.missions.snapshot(missionId);
    const decisions = snapshot.events.filter(event =>
      event.type === 'TASK_REASSIGNED' || event.data?.source === 'intelligence',
    ).length;
    return buildMissionReport(snapshot, decisions);
  }

  async approve(missionId: string, approvalId: string, resolvedBy = 'user'): Promise<ApprovalRequest> {
    return this.approvals.resolve(missionId, approvalId, true, resolvedBy);
  }

  async deny(missionId: string, approvalId: string, resolvedBy = 'user'): Promise<ApprovalRequest> {
    return this.approvals.resolve(missionId, approvalId, false, resolvedBy);
  }

  async blockers(missionId: string) {
    const graph = new GraphBuilder().build(this.missions.snapshot(missionId));
    const query = new GraphQueryEngine(graph);
    return graph.nodes
      .filter(node => node.type === 'TASK')
      .filter(node => query.findBlockers(node.id).length > 0)
      .map(node => ({
        taskId: node.id,
        title: String(node.attributes.title ?? node.id),
        blockers: query.findBlockers(node.id).map(blocker => blocker.id),
      }));
  }

  async ask(missionId: string, text: string): Promise<MissionAskResult> {
    const input = text.trim().toLowerCase();
    if (!input) return { intent: 'HELP', message: this.helpText() };

    if (input === 'status' || input.includes('what is the status')) {
      return { intent: 'STATUS', message: 'Mission status retrieved.', data: await this.status(missionId) };
    }
    if (input === 'pause' || input.includes('pause the mission')) {
      return { intent: 'PAUSE', message: 'Mission paused.', data: await this.pause(missionId) };
    }
    if (input === 'resume' || input.includes('resume the mission') || input.includes('continue')) {
      return { intent: 'RESUME', message: 'Mission resumed.', data: await this.resume(missionId) };
    }
    if (input === 'cancel' || input === 'stop' || input.includes('cancel the mission')) {
      return { intent: 'CANCEL', message: 'Mission cancelled.', data: await this.cancel(missionId) };
    }
    if (input === 'replan' || input.includes('replan')) {
      return { intent: 'REPLAN', message: 'Mission replanned.', data: await this.replan(missionId) };
    }
    if (input === 'blockers' || input.includes('what is blocking')) {
      const data = await this.blockers(missionId);
      return { intent: 'BLOCKERS', message: data.length ? 'Blocking tasks found.' : 'No graph blockers found.', data };
    }
    if (input === 'help' || input.includes('what can i do')) {
      return { intent: 'HELP', message: this.helpText() };
    }

    const approve = input.match(/^(?:approve|allow)\s+([a-z0-9_-]+)$/i);
    if (approve) {
      const data = await this.approve(missionId, approve[1]);
      return { intent: 'APPROVE', message: `Approval ${data.id} granted.`, data };
    }
    const deny = input.match(/^(?:deny|reject)\s+([a-z0-9_-]+)$/i);
    if (deny) {
      const data = await this.deny(missionId, deny[1]);
      return { intent: 'DENY', message: `Approval ${data.id} denied.`, data };
    }

    return {
      intent: 'UNKNOWN',
      message: 'I could not map that request to a safe mission control action. Use status, pause, resume, replan, blockers, approve <approvalId>, deny <approvalId>, or help.',
    };
  }

  private runtimeFor(missionId: string, policy: MissionPolicy): AutonomousLoopEngine {
    const config = defaultIntelligenceConfig();
    const intelligenceConfig: IntelligenceConfig = {
      ...config,
      policies: {
        ...config.policies,
        allowAutonomousExecution: true,
        allowReplanning: policy.allowReplanning,
        allowTaskCreation: policy.allowTaskCreation,
        allowTaskCancellation: policy.allowTaskCancellation,
      },
      loop: {
        ...config.loop,
        maxIterations: policy.maxIterations,
        maxReplans: policy.maxReplans,
        stagnationThreshold: policy.stagnationThreshold,
      },
    };
    return createAutonomousLoopRuntime({
      config: intelligenceConfig,
      authorize: async (id, interpretation) => {
        const action = LOOP_ACTION_TO_CONTROL[interpretation.action];
        if (!action) return { allowed: true, reason: 'No human approval is required for this action.' };
        const currentPolicy = await this.getPolicy(id);
        if (['EXECUTE', 'RETRY', 'REASSIGN'].includes(action) && !currentPolicy.allowExecution) {
          const approved = await this.approvals.consumeApproved(id, action, interpretation.taskIds[0]);
          if (!approved) {
            const request = await this.approvals.request({
              missionId: id,
              action,
              taskId: interpretation.taskIds[0],
              reason: 'Mission policy does not allow autonomous execution without human approval.',
            });
            return { allowed: false, reason: `Human approval required for ${action}.`, approvalId: request.id };
          }
        }
        if (currentPolicy.requireApprovalFor.includes(action)) {
          const approved = await this.approvals.consumeApproved(id, action, interpretation.taskIds[0]);
          if (!approved) {
            const request = await this.approvals.request({
              missionId: id,
              action,
              taskId: interpretation.taskIds[0],
              reason: `Human approval required before ${action}.`,
            });
            return { allowed: false, reason: `Human approval required for ${action}.`, approvalId: request.id };
          }
        }
        return { allowed: true, reason: 'Action authorized by mission policy.' };
      },
    });
  }

  private async ensureControlApproval(
    missionId: string,
    policy: MissionPolicy,
    action: MissionControlAction,
    taskId: string | undefined,
    reason: string,
  ): Promise<ApprovalRequest | undefined> {
    if (!policy.requireApprovalFor.includes(action)) return undefined;
    const approved = await this.approvals.consumeApproved(missionId, action, taskId);
    if (approved) return undefined;
    return this.approvals.request({ missionId, action, taskId, reason });
  }

  private resolvePolicy(input: Partial<Pick<MissionPolicy, 'autonomy' | 'requireApprovalFor'>>): MissionPolicy {
    const autonomy = input.autonomy ?? 'AUTONOMOUS';
    const defaults: Record<MissionPolicy['autonomy'], MissionPolicy['requireApprovalFor']> = {
      ASSISTED: ['EXECUTE', 'RETRY', 'REASSIGN', 'REPLAN'],
      PLANNED: ['EXECUTE', 'RETRY', 'REASSIGN'],
      AUTONOMOUS: [],
    };
    return MissionPolicySchema.parse({
      autonomy,
      requireApprovalFor: input.requireApprovalFor ?? defaults[autonomy],
      allowExecution: true,
      allowReplanning: true,
      allowTaskCreation: true,
      allowTaskCancellation: true,
      maxIterations: 100,
      maxReplans: 10,
      stagnationThreshold: 5,
    });
  }

  private helpText(): string {
    return 'Available controls: status, pause, resume, replan, blockers, approve <approvalId>, deny <approvalId>, cancel, help.';
  }
}

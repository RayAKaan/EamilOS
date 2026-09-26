import { randomUUID } from 'crypto';
import { MissionEngine } from '../mission/MissionEngine.js';
import type { TaskNode } from '../mission/types.js';
import { CoordinationStore } from './CoordinationStore.js';
import { LocalPlanBuilder } from './LocalPlanBuilder.js';
import { ProposalReconciler } from './ProposalReconciler.js';
import {
  TaskProposalSchema,
  type CoordinationSnapshot,
  type LocalPlan,
  type PlanRevision,
  type TaskProposal,
  type ReconciliationResult,
  type ResourceLease,
  type TaskReservation,
} from './types.js';

export class CoordinationEngine {
  readonly store: CoordinationStore;
  private readonly reconciler = new ProposalReconciler();
  private readonly localPlans = new LocalPlanBuilder();

  constructor(
    private readonly missions: MissionEngine,
    store?: CoordinationStore,
  ) {
    this.store = store ?? new CoordinationStore();
  }

  snapshot(missionId: string): CoordinationSnapshot {
    const existing = this.store.get(missionId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const snapshot: CoordinationSnapshot = {
      version: { missionId, version: 0, graphVersion: 0, updatedAt: now },
      proposals: [],
      localPlans: [],
      revisions: [],
      conflicts: [],
      resourceLeases: [],
      reservations: [],
    };
    this.store.save(snapshot);
    return snapshot;
  }

  submitProposals(missionId: string, proposals: TaskProposal[]): {
    accepted: TaskProposal[];
    merged: string[];
    rescheduled: string[];
    escalations: string[];
    results: ReconciliationResult[];
  } {
    const mission = this.missions.snapshot(missionId).mission;
    const coordination = this.snapshot(missionId);
    const graph = this.missions.snapshot(missionId).tasks;
    const accepted: TaskProposal[] = [];
    const merged: string[] = [];
    const rescheduled: string[] = [];
    const escalations: string[] = [];
    const results: ReconciliationResult[] = [];

    const parsed = proposals.map((p) => TaskProposalSchema.parse(p));
    const ordered = this.orderProposals(parsed);

    for (const proposal of ordered) {
      if (proposal.missionId !== missionId) throw new Error(`Proposal ${proposal.proposalId} belongs to another mission`);
      const result = this.reconciler.reconcile(proposal, [...coordination.proposals, ...accepted], graph);
      results.push(result);
      coordination.conflicts.push(...result.conflicts);

      if (result.action === 'MERGE') {
        merged.push(proposal.proposalId);
        coordination.proposals.push(proposal);
        continue;
      }

      if (result.action === 'ESCALATE') {
        escalations.push(proposal.proposalId);
        continue;
      }

      const existingTask = proposal.globalTaskId ? graph.find((task) => task.id === proposal.globalTaskId) : undefined;
      if (!existingTask) {
        const task = this.missions.addTask(missionId, {
          id: proposal.globalTaskId,
          title: proposal.title,
          description: proposal.objective,
          dependencies: proposal.dependencies,
          priority: proposal.priority,
          requiredCapabilities: proposal.requiredCapabilities,
          acceptanceCriteria: proposal.acceptanceCriteria,
          idempotencyKey: proposal.idempotencyKey,
        });
        coordination.version.graphVersion += 1;
        proposal.globalTaskId = task.id;
      }

      coordination.proposals.push(proposal);
      accepted.push(proposal);
      if (result.action === 'RESCHEDULE') rescheduled.push(proposal.proposalId);
    }

    coordination.version.version += 1;
    coordination.version.updatedAt = new Date().toISOString();
    this.store.save(coordination);
    return { accepted, merged, rescheduled, escalations, results };
  }

  private orderProposals(proposals: TaskProposal[]): TaskProposal[] {
    const byTask = new Map<string, TaskProposal>();
    for (const proposal of proposals) {
      if (proposal.globalTaskId) byTask.set(proposal.globalTaskId, proposal);
    }

    const indegree = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    for (const proposal of proposals) {
      indegree.set(proposal.proposalId, 0);
      outgoing.set(proposal.proposalId, []);
    }

    for (const proposal of proposals) {
      for (const dependency of proposal.dependencies) {
        const dependencyProposal = byTask.get(dependency);
        if (!dependencyProposal) continue;
        indegree.set(proposal.proposalId, (indegree.get(proposal.proposalId) ?? 0) + 1);
        outgoing.get(dependencyProposal.proposalId)?.push(proposal.proposalId);
      }
    }

    const queue = proposals
      .filter((proposal) => indegree.get(proposal.proposalId) === 0)
      .sort((a, b) => a.proposalId.localeCompare(b.proposalId));
    const ordered: TaskProposal[] = [];

    while (queue.length > 0) {
      const next = queue.shift()!;
      ordered.push(next);
      for (const dependentId of outgoing.get(next.proposalId) ?? []) {
        const degree = (indegree.get(dependentId) ?? 0) - 1;
        indegree.set(dependentId, degree);
        if (degree === 0) {
          const dependent = proposals.find((proposal) => proposal.proposalId === dependentId)!;
          queue.push(dependent);
          queue.sort((a, b) => a.proposalId.localeCompare(b.proposalId));
        }
      }
    }

    if (ordered.length !== proposals.length) {
      return [...proposals].sort((a, b) => a.proposalId.localeCompare(b.proposalId));
    }
    return ordered;
  }

  buildLocalPlan(
    missionId: string,
    agentId: string,
    taskIds?: string[],
  ): LocalPlan {
    const missionSnapshot = this.missions.snapshot(missionId);
    const coordination = this.snapshot(missionId);
    const selected = taskIds
      ? missionSnapshot.tasks.filter((task) => taskIds.includes(task.id))
      : missionSnapshot.tasks.filter((task) => task.owner === agentId);

    if (selected.some((task) => task.owner && task.owner !== agentId)) {
      throw new Error(`Agent ${agentId} cannot build a local plan for another agent's leased task`);
    }

    const proposals = coordination.proposals.filter((proposal) =>
      proposal.agentId === agentId && selected.some((task) => task.id === proposal.globalTaskId),
    );
    const plan = this.localPlans.build({
      missionId,
      agentId,
      graphVersion: coordination.version.graphVersion,
      tasks: selected,
      proposals,
    });

    coordination.localPlans = [
      ...coordination.localPlans.filter((existing) => existing.agentId !== agentId),
      plan,
    ];
    coordination.version.version += 1;
    coordination.version.updatedAt = new Date().toISOString();
    this.store.save(coordination);
    return plan;
  }

  reconcileLocalPlan(missionId: string, plan: LocalPlan): ReconciliationResult[] {
    const coordination = this.snapshot(missionId);
    const proposals = coordination.proposals.filter((p) => p.agentId === plan.agentId);
    const graph = this.missions.snapshot(missionId).tasks;
    const results: ReconciliationResult[] = [];

    if (plan.baseGraphVersion !== coordination.version.graphVersion) {
      const conflict = {
        id: `conflict_${randomUUID()}`,
        missionId,
        type: 'STALE_PLAN' as const,
        action: 'RESCHEDULE' as const,
        proposalIds: proposals.map((p) => p.proposalId),
        taskIds: plan.todos.map((todo) => todo.taskId),
        resourceIds: [],
        reason: 'Local plan was generated from an older authoritative graph version.',
        resolved: true,
        escalatedToJev: false,
        createdAt: new Date().toISOString(),
      };
      coordination.conflicts.push(conflict);
      for (const todo of plan.todos) {
        todo.state = 'RESCHEDULED';
        todo.reconciliationAction = 'RESCHEDULE';
        todo.reason = conflict.reason;
      }
      const revision: PlanRevision = {
        id: `revision_${randomUUID()}`,
        planId: plan.planId,
        missionId,
        fromRevision: plan.revision,
        toRevision: plan.revision + 1,
        reason: conflict.reason,
        changedTodoIds: plan.todos.map((todo) => todo.id),
        createdAt: new Date().toISOString(),
      };
      coordination.revisions.push(revision);
      plan.revision += 1;
      plan.updatedAt = new Date().toISOString();
      coordination.localPlans = coordination.localPlans.map((item) => item.planId === plan.planId ? plan : item);
      coordination.version.version += 1;
      coordination.version.updatedAt = new Date().toISOString();
      this.store.save(coordination);
      return [{ action: 'RESCHEDULE', proposalId: proposals[0]?.proposalId ?? plan.planId, conflicts: [conflict], sequencedAfter: [], rescheduled: true, escalateToJev: false, reason: conflict.reason }];
    }

    for (const proposal of proposals) {
      const result = this.reconciler.reconcile(proposal, coordination.proposals.filter((p) => p.proposalId !== proposal.proposalId), graph);
      results.push(result);
      coordination.conflicts.push(...result.conflicts);
      const todos = plan.todos.filter((todo) => todo.taskId === proposal.globalTaskId);
      for (const todo of todos) {
        todo.reconciliationAction = result.action;
        todo.state = result.action === 'RESCHEDULE' ? 'RESCHEDULED' :
          result.action === 'ESCALATE' ? 'CONFLICT' : todo.state;
        todo.reason = result.reason;
        if (result.action === 'SEQUENCE') todo.dependencies = [...new Set([...todo.dependencies, ...result.sequencedAfter])];
      }
    }

    plan.revision += 1;
    plan.updatedAt = new Date().toISOString();
    coordination.localPlans = coordination.localPlans.map((item) => item.planId === plan.planId ? plan : item);
    coordination.version.version += 1;
    coordination.version.updatedAt = new Date().toISOString();
    this.store.save(coordination);
    return results;
  }

  reserveTaskResources(
    missionId: string,
    taskId: string,
    agentId: string,
    resourceIds: string[],
  ): TaskReservation {
    const coordination = this.snapshot(missionId);
    const active = coordination.reservations.filter((r) => r.status === 'ACTIVE');
    const conflicting = active.find((reservation) =>
      reservation.resourceIds.some((id) => resourceIds.includes(id)) &&
      reservation.taskId !== taskId,
    );
    if (conflicting) {
      throw new Error(`Resource reservation conflict: ${conflicting.id}`);
    }
    const reservation: TaskReservation = {
      id: `reservation_${randomUUID()}`,
      missionId,
      taskId,
      agentId,
      resourceIds: [...new Set(resourceIds)].sort(),
      createdAt: new Date().toISOString(),
      status: 'ACTIVE',
    };
    coordination.reservations.push(reservation);
    coordination.version.version += 1;
    coordination.version.updatedAt = new Date().toISOString();
    this.store.save(coordination);
    return reservation;
  }

  releaseReservation(missionId: string, reservationId: string): void {
    const coordination = this.snapshot(missionId);
    const reservation = coordination.reservations.find((item) => item.id === reservationId);
    if (!reservation) throw new Error(`Reservation not found: ${reservationId}`);
    reservation.status = 'RELEASED';
    coordination.version.version += 1;
    coordination.version.updatedAt = new Date().toISOString();
    this.store.save(coordination);
  }

  leaseResource(
    missionId: string,
    taskId: string,
    agentId: string,
    resourceId: string,
    mode: 'read' | 'write',
    ttlMs = 120_000,
  ): ResourceLease {
    if (ttlMs <= 0) throw new Error('Resource lease TTL must be positive');
    const coordination = this.snapshot(missionId);
    const now = Date.now();
    const active = coordination.resourceLeases.filter((lease) =>
      lease.status === 'ACTIVE' && Date.parse(lease.expiresAt) > now && lease.resourceId === resourceId,
    );
    const incompatible = active.find((lease) =>
      lease.taskId !== taskId && (lease.mode === 'write' || mode === 'write'),
    );
    if (incompatible) throw new Error(`Resource lease conflict: ${incompatible.id}`);

    const lease: ResourceLease = {
      id: `resource_lease_${randomUUID()}`,
      missionId,
      resourceId,
      taskId,
      agentId,
      mode,
      acquiredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
      status: 'ACTIVE',
    };
    coordination.resourceLeases.push(lease);
    coordination.version.version += 1;
    coordination.version.updatedAt = new Date().toISOString();
    this.store.save(coordination);
    return lease;
  }

  releaseResourceLease(missionId: string, leaseId: string): void {
    const coordination = this.snapshot(missionId);
    const lease = coordination.resourceLeases.find((item) => item.id === leaseId);
    if (!lease) throw new Error(`Resource lease not found: ${leaseId}`);
    lease.status = 'RELEASED';
    coordination.version.version += 1;
    coordination.version.updatedAt = new Date().toISOString();
    this.store.save(coordination);
  }

  activeAgentPlans(missionId: string): LocalPlan[] {
    return this.snapshot(missionId).localPlans;
  }

  getTask(missionId: string, taskId: string): TaskNode {
    const task = this.missions.snapshot(missionId).tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }
}

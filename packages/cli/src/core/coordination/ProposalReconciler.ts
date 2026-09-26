import { randomUUID } from 'crypto';
import type { TaskNode } from '../mission/types.js';
import {
  type CoordinationConflict,
  type ReconciliationResult,
  type TaskProposal,
  type ResourceRef,
} from './types.js';

function resourceId(ref: ResourceRef): string {
  return `${ref.kind}:${ref.id}:${ref.scope ?? '*'}`;
}

function resources(proposal: TaskProposal): ResourceRef[] {
  return [...proposal.readSet, ...proposal.writeSet];
}

function overlaps(a: ResourceRef, b: ResourceRef): boolean {
  return a.id === b.id && a.kind === b.kind && (a.scope ?? '*') === (b.scope ?? '*');
}

function hasWriteConflict(a: TaskProposal, b: TaskProposal): boolean {
  return a.writeSet.some((wa) => b.writeSet.some((wb) => overlaps(wa, wb))) ||
    a.writeSet.some((wa) => b.readSet.some((rb) => overlaps(wa, rb))) ||
    a.readSet.some((ra) => b.writeSet.some((wb) => overlaps(ra, wb)));
}

function conflictType(a: TaskProposal, b: TaskProposal): 'RESOURCE_WRITE_WRITE' | 'RESOURCE_READ_WRITE' {
  return a.writeSet.some((wa) => b.writeSet.some((wb) => overlaps(wa, wb)))
    ? 'RESOURCE_WRITE_WRITE'
    : 'RESOURCE_READ_WRITE';
}

export class ProposalReconciler {
  reconcile(
    proposal: TaskProposal,
    existing: TaskProposal[],
    graphTasks: TaskNode[],
  ): ReconciliationResult {
    const conflicts: CoordinationConflict[] = [];
    const sameKey = existing.find((candidate) => candidate.idempotencyKey === proposal.idempotencyKey);
    if (sameKey) {
      conflicts.push({
        id: `conflict_${randomUUID()}`,
        missionId: proposal.missionId,
        type: 'DUPLICATE_TASK',
        action: 'MERGE',
        proposalIds: [sameKey.proposalId, proposal.proposalId],
        taskIds: [sameKey.globalTaskId, proposal.globalTaskId].filter((x): x is string => Boolean(x)),
        resourceIds: [],
        reason: `Proposal ${proposal.proposalId} duplicates ${sameKey.proposalId} by idempotency key.`,
        resolved: true,
        escalatedToJev: false,
        createdAt: new Date().toISOString(),
      });
      return {
        action: 'MERGE',
        proposalId: proposal.proposalId,
        conflicts,
        sequencedAfter: [],
        rescheduled: false,
        mergedInto: sameKey.proposalId,
        escalateToJev: false,
        reason: 'Duplicate proposal merged deterministically.',
      };
    }

    const unknownDependency = proposal.dependencies.find((id) => !graphTasks.some((task) => task.id === id));
    if (unknownDependency) {
      conflicts.push({
        id: `conflict_${randomUUID()}`,
        missionId: proposal.missionId,
        type: 'DEPENDENCY',
        action: 'ESCALATE',
        proposalIds: [proposal.proposalId],
        taskIds: [unknownDependency],
        resourceIds: [],
        reason: `Proposal references unknown dependency ${unknownDependency}.`,
        resolved: false,
        escalatedToJev: true,
        createdAt: new Date().toISOString(),
      });
      return {
        action: 'ESCALATE',
        proposalId: proposal.proposalId,
        conflicts,
        sequencedAfter: [],
        rescheduled: false,
        escalateToJev: true,
        reason: 'Unknown dependency requires strategic replanning.',
      };
    }

    const related = existing.filter((candidate) => candidate.proposalId !== proposal.proposalId && hasWriteConflict(candidate, proposal));
    if (related.length === 0) {
      return {
        action: 'ACCEPT',
        proposalId: proposal.proposalId,
        conflicts: [],
        sequencedAfter: [],
        rescheduled: false,
        escalateToJev: false,
        reason: 'No conflicting resource access detected.',
      };
    }

    const dependencyRelated = related.find((candidate) =>
      proposal.dependencies.includes(candidate.globalTaskId ?? '') ||
      candidate.dependencies.includes(proposal.globalTaskId ?? '') ||
      proposal.orderingAfter.includes(candidate.globalTaskId ?? candidate.proposalId) ||
      candidate.orderingAfter.includes(proposal.globalTaskId ?? proposal.proposalId),
    );

    if (dependencyRelated) {
      const after = dependencyRelated.globalTaskId ?? dependencyRelated.proposalId;
      conflicts.push({
        id: `conflict_${randomUUID()}`,
        missionId: proposal.missionId,
        type: conflictType(proposal, dependencyRelated),
        action: 'SEQUENCE',
        proposalIds: [dependencyRelated.proposalId, proposal.proposalId],
        taskIds: [dependencyRelated.globalTaskId, proposal.globalTaskId].filter((x): x is string => Boolean(x)),
        resourceIds: resources(proposal)
          .filter((r) => resources(dependencyRelated).some((other) => overlaps(r, other)))
          .map(resourceId),
        reason: `Resource overlap is ordered by an existing dependency/ordering constraint after ${after}.`,
        resolved: true,
        escalatedToJev: false,
        createdAt: new Date().toISOString(),
      });
      return {
        action: 'SEQUENCE',
        proposalId: proposal.proposalId,
        conflicts,
        sequencedAfter: [after],
        rescheduled: false,
        escalateToJev: false,
        reason: 'Conflicting resource access has an explicit dependency/order.',
      };
    }

    const canReschedule = related.every((candidate) =>
      candidate.globalTaskId !== proposal.globalTaskId &&
      !candidate.writeSet.some((w) => proposal.writeSet.some((p) => overlaps(w, p))),
    );

    if (canReschedule) {
      conflicts.push({
        id: `conflict_${randomUUID()}`,
        missionId: proposal.missionId,
        type: conflictType(proposal, related[0]),
        action: 'RESCHEDULE',
        proposalIds: [related[0].proposalId, proposal.proposalId],
        taskIds: [related[0].globalTaskId, proposal.globalTaskId].filter((x): x is string),
        resourceIds: resources(proposal)
          .filter((r) => resources(related[0]).some((other) => overlaps(r, other)))
          .map(resourceId),
        reason: 'Read/write overlap has no declared ordering; defer the new work until the current reservation is released.',
        resolved: true,
        escalatedToJev: false,
        createdAt: new Date().toISOString(),
      });
      return {
        action: 'RESCHEDULE',
        proposalId: proposal.proposalId,
        conflicts,
        sequencedAfter: [],
        rescheduled: true,
        escalateToJev: false,
        reason: 'Resource contention can be resolved by deterministic rescheduling.',
      };
    }

    conflicts.push({
      id: `conflict_${randomUUID()}`,
      missionId: proposal.missionId,
      type: 'STRATEGIC',
      action: 'ESCALATE',
      proposalIds: [related[0].proposalId, proposal.proposalId],
      taskIds: [related[0].globalTaskId, proposal.globalTaskId].filter((x): x is string),
      resourceIds: resources(proposal)
        .filter((r) => resources(related[0]).some((other) => overlaps(r, other)))
        .map(resourceId),
      reason: 'Independent write/write contention has no safe deterministic ordering; strategic arbitration is required.',
      resolved: false,
      escalatedToJev: true,
      createdAt: new Date().toISOString(),
    });
    return {
      action: 'ESCALATE',
      proposalId: proposal.proposalId,
      conflicts,
      sequencedAfter: [],
      rescheduled: false,
      escalateToJev: true,
      reason: 'Independent conflicting writes require Jev strategic arbitration.',
    };
  }
}

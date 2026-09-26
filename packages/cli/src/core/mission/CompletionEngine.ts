import type { Mission, MissionEvidence, TaskNode } from './types.js';

export interface CompletionResult {
  complete: boolean;
  blocked: boolean;
  reasons: string[];
  passedCriteria: string[];
  failedCriteria: string[];
}

export class CompletionEngine {
  evaluate(mission: Mission, tasks: TaskNode[], evidence: MissionEvidence[]): CompletionResult {
    const reasons: string[] = [];
    const passedCriteria: string[] = [];
    const failedCriteria: string[] = [];

    for (const criterion of mission.requirements.completionCriteria) {
      const matching = evidence.filter((item) =>
        item.passed &&
        (criterion.evidenceTypes.length === 0 || criterion.evidenceTypes.includes(item.type))
      );
      const passed = matching.length > 0;
      if (passed) passedCriteria.push(criterion.id);
      else if (criterion.required) {
        failedCriteria.push(criterion.id);
        reasons.push(`Required completion criterion not satisfied: ${criterion.description}`);
      }
    }

    for (const artifact of mission.requirements.requiredArtifacts) {
      const exists = tasks.some((task) => task.artifacts.includes(artifact));
      if (!exists) {
        reasons.push(`Required artifact missing: ${artifact}`);
      }
    }

    const active = tasks.filter((task) => !['COMPLETED', 'CANCELLED'].includes(task.state));
    const failed = tasks.filter((task) => ['FAILED', 'BLOCKED', 'ESCALATED'].includes(task.state));

    if (active.length > 0) {
      reasons.push(`${active.length} task(s) are not terminal`);
    }
    if (failed.length > 0) {
      reasons.push(`${failed.length} task(s) are failed, blocked, or escalated`);
    }

    const requiredEvidenceSatisfied =
      !mission.constraints.requireEvidence ||
      mission.requirements.completionCriteria.every((criterion) =>
        !criterion.required || passedCriteria.includes(criterion.id)
      );

    const complete =
      tasks.length > 0 &&
      active.length === 0 &&
      failed.length === 0 &&
      failedCriteria.length === 0 &&
      requiredEvidenceSatisfied &&
      reasons.length === 0;

    const blocked =
      !complete &&
      tasks.length > 0 &&
      active.length === 0 &&
      failed.length > 0;

    return { complete, blocked, reasons, passedCriteria, failedCriteria };
  }
}

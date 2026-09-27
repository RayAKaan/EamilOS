import type { TaskNode } from '../mission/types.js';
import type { HarnessDescriptor } from './types.js';

export interface ExecutionCandidate {
  harnessId: string;
  workerId: string;
  score: number;
  compatible: boolean;
  reasons: string[];
}

export interface CandidateSelectionInput {
  task: TaskNode;
  harnesses: HarnessDescriptor[];
  excludedHarnesses?: Set<string>;
  preferredHarnessId?: string;
}

const CAPABILITY_ALIASES: Record<string, keyof HarnessDescriptor['capabilities']> = {
  code: 'codeGeneration',
  codeGeneration: 'codeGeneration',
  file: 'fileEditing',
  fileEditing: 'fileEditing',
  shell: 'commandExecution',
  commandExecution: 'commandExecution',
  research: 'webResearch',
  webResearch: 'webResearch',
  communication: 'communication',
  execution: 'execution',
  streaming: 'streaming',
  cancellation: 'cancellation',
  checkpointResume: 'checkpointResume',
  workspaceIsolation: 'workspaceIsolation',
  multimodal: 'multimodal',
  longContext: 'longContext',
};

export class CandidateSelector {
  select(input: CandidateSelectionInput): ExecutionCandidate | null {
    const candidates = this.rank(input);
    return candidates.find((candidate) => candidate.compatible) ?? null;
  }

  rank(input: CandidateSelectionInput): ExecutionCandidate[] {
    const excluded = input.excludedHarnesses ?? new Set<string>();

    return input.harnesses
      .map((harness) => this.evaluate(harness, input.task, excluded, input.preferredHarnessId))
      .sort((a, b) => {
        if (a.compatible !== b.compatible) return a.compatible ? -1 : 1;
        if (b.score !== a.score) return b.score - a.score;
        return a.harnessId.localeCompare(b.harnessId);
      });
  }

  private evaluate(
    harness: HarnessDescriptor,
    task: TaskNode,
    excluded: Set<string>,
    preferredHarnessId?: string,
  ): ExecutionCandidate {
    const reasons: string[] = [];
    let score = 0;
    let compatible = true;

    if (excluded.has(harness.id)) {
      compatible = false;
      reasons.push('harness explicitly excluded');
    }

    if (harness.status !== 'AVAILABLE') {
      compatible = false;
      reasons.push(`harness status is ${harness.status}`);
    }

    const missing = task.requiredCapabilities.filter((required) => {
      const capability = CAPABILITY_ALIASES[required] ?? required as keyof HarnessDescriptor['capabilities'];
      return harness.capabilities[capability] !== true;
    });

    if (missing.length > 0) {
      compatible = false;
      reasons.push(`missing capabilities: ${missing.join(', ')}`);
    } else if (task.requiredCapabilities.length > 0) {
      score += task.requiredCapabilities.length * 20;
      reasons.push('all required capabilities satisfied');
    }

    if (harness.capabilities.execution) score += 10;
    if (harness.capabilities.workspaceIsolation) score += 10;
    if (harness.capabilities.cancellation) score += 5;

    if (preferredHarnessId === harness.id) {
      score += 25;
      reasons.push('preferred harness');
    }

    if (harness.limits?.maxConcurrentTasks === 1) {
      score -= 1;
    }

    if (compatible) reasons.push('compatible execution candidate');

    return {
      harnessId: harness.id,
      workerId: harness.capabilities.local ? 'local' : 'unassigned',
      score,
      compatible,
      reasons,
    };
  }
}

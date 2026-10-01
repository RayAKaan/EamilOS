import type { HarnessDescriptor } from '../execution/types.js';

export interface HarnessScore {
  harnessId: string;
  score: number;
  reasons: string[];
}

export interface HarnessCompetitionRequest {
  requiredCapabilities: string[];
  preferredHarnesses?: string[];
  excludedHarnesses?: string[];
  estimatedTokens?: number;
  estimatedRuntimeMs?: number;
  localOnly?: boolean;
  remoteAllowed?: boolean;
}

export class HarnessCompetition {
  rank(harnesses: readonly HarnessDescriptor[], request: HarnessCompetitionRequest): HarnessScore[] {
    const required = new Set(request.requiredCapabilities);
    const preferred = new Set(request.preferredHarnesses ?? []);
    const excluded = new Set(request.excludedHarnesses ?? []);

    return harnesses
      .filter(h => !excluded.has(h.id))
      .filter(h => h.status === 'AVAILABLE')
      .filter(h => !request.localOnly || h.capabilities.local)
      .filter(h => request.remoteAllowed !== false || h.capabilities.local)
      .filter(h => this.supports(h, required))
      .map(h => {
        let score = 0;
        const reasons: string[] = [];
        if (preferred.has(h.id)) { score += 30; reasons.push('preferred'); }
        if (h.capabilities.streaming) { score += 5; reasons.push('streaming'); }
        if (h.capabilities.cancellation) { score += 5; reasons.push('cancellable'); }
        if (h.capabilities.checkpointResume) { score += 8; reasons.push('checkpoint-resume'); }
        if (h.capabilities.workspaceIsolation) { score += 4; reasons.push('workspace-isolation'); }
        if (request.estimatedTokens && h.limits?.maxContextTokens && request.estimatedTokens <= h.limits.maxContextTokens) {
          score += 8; reasons.push('context-fit');
        }
        if (request.estimatedRuntimeMs && h.limits?.maxRuntimeMs && request.estimatedRuntimeMs <= h.limits.maxRuntimeMs) {
          score += 5; reasons.push('runtime-fit');
        }
        return { harnessId: h.id, score, reasons };
      })
      .sort((a, b) => b.score - a.score || a.harnessId.localeCompare(b.harnessId));
  }

  private supports(harness: HarnessDescriptor, required: Set<string>): boolean {
    return [...required].every(capability => {
      const value = (harness.capabilities as Record<string, unknown>)[capability];
      return value === true;
    });
  }
}

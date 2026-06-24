import { createHash } from 'crypto';
import { getProviderManager } from '../provider-manager.js';

export interface ArtifactCandidate {
  callsign: string;
  path: string;
  hash: string;
  content: string;
}

export interface ArtifactResolution {
  winner: ArtifactCandidate;
  method: 'sole' | 'identical' | 'auto-merge' | 'vote';
  reason?: string;
}

export class ConflictArbiter {
  static computeHash(callsign: string, filePath: string, content: string): string {
    return createHash('sha256').update(`${callsign}:${filePath}:${content}`, 'utf-8').digest('hex');
  }

  async arbitrate(candidates: ArtifactCandidate[]): Promise<ArtifactResolution> {
    if (candidates.length === 0) {
      throw new Error('No candidates provided for conflict resolution');
    }
    if (candidates.length === 1) {
      return { winner: candidates[0]!, method: 'sole' };
    }

    const [a, b] = candidates;
    if (a!.hash === b!.hash) {
      return { winner: a!, method: 'identical' };
    }

    const merged = await this.tryAutoMerge(a!, b!);
    if (merged.clean && merged.candidate) {
      return { winner: merged.candidate, method: 'auto-merge' };
    }

    const vote = await this.qualityVote(a!, b!);
    return { winner: vote.winner, method: 'vote', reason: vote.reason };
  }

  private async tryAutoMerge(
    a: ArtifactCandidate,
    b: ArtifactCandidate
  ): Promise<{ clean: boolean; candidate?: ArtifactCandidate }> {
    const aLines = a.content.split('\n');
    const bLines = b.content.split('\n');
    if (aLines.length === bLines.length && a.content.trim() === b.content.trim()) {
      return { clean: true, candidate: a };
    }
    return { clean: false };
  }

  private async qualityVote(
    a: ArtifactCandidate,
    b: ArtifactCandidate
  ): Promise<{ winner: ArtifactCandidate; reason: string }> {
    try {
      const provider = getProviderManager();
      const res = await provider.chat([{
        role: 'user',
        content: `Two agents wrote different implementations of ${a.path}.\n\nVersion A (${a.callsign}):\n${a.content}\n\nVersion B (${b.callsign}):\n${b.content}\n\nRespond with ONLY valid JSON: { "winner": "A" or "B", "reason": "one sentence" }`
      }]);

      const parsed = JSON.parse(res.content.match(/\{[\s\S]*\}/)?.[0] || '{}');
      if (parsed.winner === 'B') {
        return { winner: b, reason: parsed.reason || 'Judge selected candidate B' };
      }
      return { winner: a, reason: parsed.reason || 'Judge selected candidate A' };
    } catch {
      const winner = a.content.length >= b.content.length ? a : b;
      return { winner, reason: 'Deterministic fallback: higher completeness density' };
    }
  }
}

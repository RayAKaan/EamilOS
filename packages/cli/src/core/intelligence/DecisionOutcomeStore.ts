import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { DecisionAction } from './types.js';
import type { FusionSource, HistoricalOutcome } from './DecisionFusionTypes.js';

const OutcomeSchema = z.object({
  source: z.enum(['deterministic','jev','laya','historical']).optional(),
  action: z.string().min(1),
  success: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
  timestamp: z.string().datetime(),
});

export class DecisionOutcomeStore {
  constructor(private readonly baseDir = join(process.cwd(), '.eamilos', 'intelligence')) {
    mkdirSync(this.baseDir, { recursive: true });
  }

  private file(missionId: string): string { return join(this.baseDir, missionId + '.outcomes.json'); }

  list(missionId: string): HistoricalOutcome[] {
    const path = this.file(missionId);
    if (!existsSync(path)) return [];
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8'));
      return z.array(OutcomeSchema).parse(raw) as HistoricalOutcome[];
    } catch {
      return [];
    }
  }

  record(missionId: string, outcome: HistoricalOutcome): void {
    const current = this.list(missionId);
    current.push(outcome);
    const trimmed = current.slice(-500);
    const target = this.file(missionId);
    const temp = target + '.tmp.' + process.pid + '.' + Date.now();
    writeFileSync(temp, JSON.stringify(trimmed, null, 2), 'utf8');
    renameSync(temp, target);
  }

  recordDecisionResult(missionId: string, action: DecisionAction, success: boolean, source: FusionSource, confidence?: number): void {
    this.record(missionId, { action, success, source, confidence, timestamp: new Date().toISOString() });
  }
}

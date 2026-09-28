import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { DecisionRecord, StrategicLoopState } from './types.js';

const SnapshotSchema = z.object({
  missionId: z.string().min(1),
  decisions: z.array(z.unknown()).default([]),
  loop: z.object({
    iterations: z.number().int().nonnegative(),
    decisions: z.number().int().nonnegative(),
    replans: z.number().int().nonnegative(),
    consecutiveNoProgress: z.number().int().nonnegative(),
  }),
  updatedAt: z.string().datetime(),
});

interface Snapshot {
  missionId: string;
  decisions: DecisionRecord[];
  loop: StrategicLoopState;
  updatedAt: string;
}

export class DecisionStore {
  constructor(private readonly baseDir = join(process.cwd(), '.eamilos', 'intelligence')) {
    mkdirSync(this.baseDir, { recursive: true });
  }

  private file(missionId: string): string {
    return join(this.baseDir, `${missionId}.json`);
  }

  get(missionId: string): Snapshot | null {
    const path = this.file(missionId);
    if (!existsSync(path)) return null;
    const parsed = SnapshotSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    return parsed as Snapshot;
  }

  getOrCreate(missionId: string): Snapshot {
    return this.get(missionId) ?? {
      missionId,
      decisions: [],
      loop: { iterations: 0, decisions: 0, replans: 0, consecutiveNoProgress: 0 },
      updatedAt: new Date().toISOString(),
    };
  }

  saveDecision(record: DecisionRecord): void {
    const snapshot = this.getOrCreate(record.missionId);
    const index = snapshot.decisions.findIndex((item) => item.decisionId === record.decisionId);
    if (index >= 0) snapshot.decisions[index] = record;
    else snapshot.decisions.push(record);
    this.save(snapshot);
  }

  updateLoop(missionId: string, loop: StrategicLoopState): void {
    const snapshot = this.getOrCreate(missionId);
    snapshot.loop = loop;
    this.save(snapshot);
  }

  getDecisions(missionId: string): DecisionRecord[] {
    return [...(this.get(missionId)?.decisions ?? [])];
  }

  getLoop(missionId: string): StrategicLoopState {
    return this.get(missionId)?.loop ?? {
      iterations: 0, decisions: 0, replans: 0, consecutiveNoProgress: 0,
    };
  }

  private save(snapshot: Snapshot): void {
    const value = SnapshotSchema.parse({
      ...snapshot,
      updatedAt: new Date().toISOString(),
    });
    const target = this.file(value.missionId);
    const temp = `${target}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
    renameSync(temp, target);
  }
}

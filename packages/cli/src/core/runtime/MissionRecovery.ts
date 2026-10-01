import type { RuntimeEvent } from './types.js';
import { MissionEventStore } from './MissionEventStore.js';
import { MissionReplay } from './MissionReplay.js';

export interface RecoveryReport {
  missionId: string;
  valid: boolean;
  eventCount: number;
  lastEventId?: string;
  reconstructed: boolean;
  state?: unknown;
  error?: string;
}

export class MissionRecovery {
  private readonly replay: MissionReplay;

  constructor(private readonly store: MissionEventStore) {
    this.replay = new MissionReplay(store);
  }

  async inspect(missionId: string): Promise<RecoveryReport> {
    try {
      const verification = await this.store.verify(missionId);
      const snapshot = await this.replay.reconstructSnapshot(missionId);
      return {
        missionId,
        valid: verification.valid,
        eventCount: verification.count,
        lastEventId: (await this.store.load(missionId)).at(-1)?.eventId,
        reconstructed: Boolean(snapshot),
        state: snapshot,
      };
    } catch (error) {
      return {
        missionId,
        valid: false,
        eventCount: 0,
        reconstructed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async recover(missionId: string): Promise<RecoveryReport> {
    const report = await this.inspect(missionId);
    if (!report.valid) throw new Error(`Cannot recover mission ${missionId}: event log integrity check failed`);
    return report;
  }
}

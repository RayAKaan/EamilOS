import { join } from 'node:path';
import { TaskGraph } from '../mission/TaskGraph.js';
import type { MissionSnapshot } from '../mission/types.js';
import {
  DistributedMissionLedger,
} from '../distributed-mission/DistributedMissionLedger.js';
import {
  SqliteDistributedMissionStateStore,
} from '../distributed-mission/DistributedMissionStateStore.js';

export interface DistributedMissionAuthorityOptions {
  readonly root?: string;
  readonly filename?: string;
  readonly busyTimeoutMs?: number;
}

export interface DistributedMissionAuthorityStatus {
  missionId: string;
  graphVersion: number;
  eventCount: number;
  valid: boolean;
}

export class DistributedMissionAuthority {
  readonly store: SqliteDistributedMissionStateStore;
  private readonly ledgers = new Map<string, DistributedMissionLedger>();
  private disposed = false;

  constructor(options: DistributedMissionAuthorityOptions = {}) {
    const filename =
      options.filename ??
      join(options.root ?? join(process.cwd(), '.eamilos', 'distributed'), 'missions.sqlite');
    this.store = new SqliteDistributedMissionStateStore({
      filename,
      busyTimeoutMs: options.busyTimeoutMs,
    });
  }

  open(missionId: string, snapshot?: MissionSnapshot): DistributedMissionLedger {
    this.assertOpen();

    const existing = this.ledgers.get(missionId);
    if (existing) return existing;

    const persisted = this.store.load(missionId);
    if (persisted) {
      const ledger = DistributedMissionLedger.restore(missionId, this.store);
      this.ledgers.set(missionId, ledger);
      return ledger;
    }

    if (!snapshot) {
      throw new Error('DISTRIBUTED_MISSION_NOT_FOUND:' + missionId);
    }

    if (snapshot.mission.id !== missionId) {
      throw new Error('DISTRIBUTED_MISSION_ID_MISMATCH:' + missionId);
    }

    const ledger = new DistributedMissionLedger(
      missionId,
      new TaskGraph(snapshot.tasks),
      this.store,
    );
    ledger.sync();
    this.ledgers.set(missionId, ledger);
    return ledger;
  }

  restore(missionId: string): DistributedMissionLedger {
    this.assertOpen();

    const existing = this.ledgers.get(missionId);
    if (existing) return existing;

    const ledger = DistributedMissionLedger.restore(missionId, this.store);
    this.ledgers.set(missionId, ledger);
    return ledger;
  }

  verify(missionId: string): DistributedMissionAuthorityStatus {
    this.assertOpen();
    const verification = this.store.verify(missionId);
    const ledger = this.ledgers.get(missionId);
    const restored = ledger ?? DistributedMissionLedger.restore(missionId, this.store);
    return {
      missionId,
      graphVersion: restored.graphVersion,
      eventCount: verification.count,
      valid: verification.valid,
    };
  }

  listMissionIds(): string[] {
    this.assertOpen();
    const rows = this.store.listMissionIds();
    return rows;
  }

  status(missionId: string): DistributedMissionAuthorityStatus | undefined {
    this.assertOpen();
    if (!this.store.has(missionId)) return undefined;
    return this.verify(missionId);
  }

  close(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ledgers.clear();
    this.store.close();
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('Distributed mission authority has been disposed');
  }
}

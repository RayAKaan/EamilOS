import { randomUUID } from 'node:crypto';

export type ScheduleState = 'scheduled' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ScheduleSpec {
  readonly id?: string;
  readonly name: string;
  readonly runAt?: Date;
  readonly intervalMs?: number;
  readonly maxRuns?: number;
  readonly task: (ctx: { id: string; signal: AbortSignal; runNumber: number }) => Promise<void>;
}

export interface ScheduleSnapshot {
  readonly id: string;
  readonly name: string;
  readonly state: ScheduleState;
  readonly runCount: number;
  readonly nextRunAt?: number;
  readonly lastRunAt?: number;
  readonly error?: string;
}

interface ScheduleRecord {
  readonly spec: ScheduleSpec;
  readonly id: string;
  readonly controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  state: ScheduleState;
  runCount: number;
  nextRunAt?: number;
  lastRunAt?: number;
  error?: string;
}

export class SchedulerRuntime {
  private readonly schedules = new Map<string, ScheduleRecord>();

  schedule(spec: ScheduleSpec): string {
    if (spec.intervalMs !== undefined && spec.intervalMs < 1_000) {
      throw new Error('Scheduler interval must be at least 1000ms');
    }
    if (!spec.runAt && spec.intervalMs === undefined) throw new Error('Schedule requires runAt or intervalMs');
    const id = spec.id ?? randomUUID();
    if (this.schedules.has(id)) throw new Error(`Schedule already exists: ${id}`);
    const record: ScheduleRecord = {
      spec, id, controller: new AbortController(), state: 'scheduled', runCount: 0,
    };
    this.schedules.set(id, record);
    const delay = Math.max(0, (spec.runAt?.getTime() ?? Date.now() + spec.intervalMs!) - Date.now());
    this.arm(record, delay);
    return id;
  }

  cancel(id: string): boolean {
    const record = this.schedules.get(id);
    if (!record || record.state === 'cancelled' || record.state === 'completed') return false;
    if (record.timer) clearTimeout(record.timer);
    record.controller.abort('schedule cancelled');
    record.state = 'cancelled';
    record.nextRunAt = undefined;
    return true;
  }

  get(id: string): ScheduleSnapshot | undefined {
    const record = this.schedules.get(id);
    if (!record) return undefined;
    return this.snapshot(record);
  }

  list(): ScheduleSnapshot[] {
    return [...this.schedules.values()].sort((a, b) => a.id.localeCompare(b.id)).map(record => this.snapshot(record));
  }

  clearFinished(): void {
    for (const [id, record] of this.schedules) {
      if (record.state === 'completed' || record.state === 'cancelled' || record.state === 'failed') this.schedules.delete(id);
    }
  }

  dispose(): void {
    for (const id of this.schedules.keys()) this.cancel(id);
    this.schedules.clear();
  }

  private arm(record: ScheduleRecord, delay: number): void {
    record.nextRunAt = Date.now() + delay;
    record.timer = setTimeout(() => void this.run(record), delay);
  }

  private async run(record: ScheduleRecord): Promise<void> {
    if (record.controller.signal.aborted) return;
    record.state = 'running';
    record.lastRunAt = Date.now();
    record.nextRunAt = undefined;
    record.runCount += 1;
    try {
      await record.spec.task({ id: record.id, signal: record.controller.signal, runNumber: record.runCount });
      if (record.controller.signal.aborted) return;
      if (record.spec.intervalMs !== undefined && (!record.spec.maxRuns || record.runCount < record.spec.maxRuns)) {
        record.state = 'scheduled';
        this.arm(record, record.spec.intervalMs);
      } else {
        record.state = 'completed';
      }
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error);
      record.state = record.controller.signal.aborted ? 'cancelled' : 'failed';
    }
  }

  private snapshot(record: ScheduleRecord): ScheduleSnapshot {
    return {
      id: record.id, name: record.spec.name, state: record.state, runCount: record.runCount,
      nextRunAt: record.nextRunAt, lastRunAt: record.lastRunAt, error: record.error,
    };
  }
}

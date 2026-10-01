import { randomUUID } from 'node:crypto';

export type JobState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobSnapshot<T = unknown> {
  id: string;
  state: JobState;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  result?: T;
  error?: string;
}

export interface JobContext {
  readonly id: string;
  readonly signal: AbortSignal;
}

interface JobRecord<T> {
  snapshot: JobSnapshot<T>;
  controller: AbortController;
}

export class JobRuntime {
  private readonly jobs = new Map<string, JobRecord<unknown>>();

  start<T>(work: (ctx: JobContext) => Promise<T>, signal?: AbortSignal): string {
    const id = randomUUID();
    const controller = new AbortController();
    const snapshot: JobSnapshot<T> = { id, state: 'queued', createdAt: Date.now() };
    this.jobs.set(id, { snapshot, controller });

    const forwardAbort = () => controller.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener('abort', forwardAbort, { once: true });
    }

    void (async () => {
      snapshot.state = 'running';
      snapshot.startedAt = Date.now();
      try {
        if (controller.signal.aborted) throw new Error('Job cancelled');
        snapshot.result = await work({ id, signal: controller.signal });
        snapshot.state = controller.signal.aborted ? 'cancelled' : 'completed';
      } catch (error) {
        snapshot.state = controller.signal.aborted ? 'cancelled' : 'failed';
        snapshot.error = error instanceof Error ? error.message : String(error);
      } finally {
        snapshot.finishedAt = Date.now();
        signal?.removeEventListener('abort', forwardAbort);
      }
    })();

    return id;
  }

  cancel(id: string): boolean {
    const record = this.jobs.get(id);
    if (!record || ['completed', 'failed', 'cancelled'].includes(record.snapshot.state)) return false;
    record.controller.abort('job cancelled');
    return true;
  }

  get<T>(id: string): JobSnapshot<T> | undefined {
    return this.jobs.get(id)?.snapshot as JobSnapshot<T> | undefined;
  }

  list(): JobSnapshot[] {
    return [...this.jobs.values()].map(record => ({ ...record.snapshot })).sort((a, b) => a.createdAt - b.createdAt);
  }

  clearFinished(): void {
    for (const [id, record] of this.jobs) {
      if (['completed', 'failed', 'cancelled'].includes(record.snapshot.state)) this.jobs.delete(id);
    }
  }
}

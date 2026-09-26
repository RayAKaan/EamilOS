import { randomUUID } from 'crypto';
import type { TaskLease } from './types.js';
import { TaskGraph } from './TaskGraph.js';

export class LeaseManager {
  constructor(private readonly graph: TaskGraph) {}

  acquire(taskId: string, owner: string, ttlMs = 120_000): TaskLease {
    if (ttlMs <= 0) throw new Error('Lease TTL must be positive');
    const task = this.graph.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (!['READY', 'RECOVERABLE'].includes(task.state)) {
      throw new Error(`Task ${taskId} is not claimable from ${task.state}`);
    }
    if (task.leaseExpiresAt && Date.parse(task.leaseExpiresAt) > Date.now()) {
      throw new Error(`Task ${taskId} already has an active lease`);
    }

    const acquiredAt = new Date();
    const expiresAt = new Date(Date.now() + ttlMs);
    const lease: TaskLease = {
      id: `lease_${randomUUID()}`,
      taskId,
      owner,
      acquiredAt: acquiredAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    this.graph.setOwner(taskId, owner);
    task.leaseId = lease.id;
    task.leaseExpiresAt = lease.expiresAt;
    this.graph.transition(taskId, 'CLAIMED');
    return lease;
  }

  renew(leaseId: string, ttlMs = 120_000): TaskLease {
    const task = this.graph.all().find((candidate) => candidate.leaseId === leaseId);
    if (!task) throw new Error(`Lease not found: ${leaseId}`);
    if (!task.leaseExpiresAt || Date.parse(task.leaseExpiresAt) <= Date.now()) {
      throw new Error(`Lease expired: ${leaseId}`);
    }
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    task.leaseExpiresAt = expiresAt;
    task.updatedAt = new Date().toISOString();
    return {
      id: leaseId,
      taskId: task.id,
      owner: task.owner!,
      acquiredAt: new Date(Date.now()).toISOString(),
      expiresAt,
    };
  }

  release(leaseId: string): void {
    const task = this.graph.all().find((candidate) => candidate.leaseId === leaseId);
    if (!task) throw new Error(`Lease not found: ${leaseId}`);
    task.leaseId = undefined;
    task.leaseExpiresAt = undefined;
    this.graph.releaseOwner(task.id);
  }

  expire(now = Date.now()): string[] {
    const expired: string[] = [];
    for (const task of this.graph.all()) {
      if (!task.leaseId || !task.leaseExpiresAt) continue;
      if (Date.parse(task.leaseExpiresAt) > now) continue;
      expired.push(task.id);
      task.leaseId = undefined;
      task.leaseExpiresAt = undefined;
      task.owner = undefined;
      if (task.state === 'CLAIMED' || task.state === 'RUNNING') {
        task.state = 'RECOVERABLE';
      }
      task.updatedAt = new Date(now).toISOString();
    }
    this.graph.refreshReadiness();
    return expired;
  }
}

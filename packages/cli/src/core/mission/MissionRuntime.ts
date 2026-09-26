import { GraphScheduler, type SchedulePlan } from './GraphScheduler.js';
import { MissionEngine } from './MissionEngine.js';
import { TaskGraph } from './TaskGraph.js';
import type { TaskNode } from './types.js';

export class MissionRuntime {
  constructor(private readonly engine: MissionEngine) {}

  schedule(missionId: string): SchedulePlan {
    const snapshot = this.engine.snapshot(missionId);
    const scheduler = new GraphScheduler(snapshot.mission.constraints);
    return scheduler.plan(new TaskGraph(snapshot.tasks));
  }

  claimNext(missionId: string, owner: string, ttlMs?: number): { task: TaskNode; leaseId: string } | null {
    const plan = this.schedule(missionId);
    const next = plan.ready[0];
    if (!next) return null;
    const lease = this.engine.acquireLease(missionId, next.id, owner, ttlMs);
    const task = this.engine.snapshot(missionId).tasks.find((item) => item.id === next.id);
    if (!task) throw new Error(`Claimed task disappeared: ${next.id}`);
    return { task, leaseId: lease.id };
  }
}

import { GraphScheduler, type SchedulePlan } from './GraphScheduler.js';
import { MissionEngine } from './MissionEngine.js';
import type { TaskNode } from './types.js';

export class MissionRuntime {
  constructor(private readonly engine: MissionEngine) {}

  schedule(missionId: string): SchedulePlan {
    const snapshot = this.engine.snapshot(missionId);
    const scheduler = new GraphScheduler(snapshot.mission.constraints);
    return scheduler.plan(new (requireTaskGraph())(snapshot.tasks));
  }

  claimNext(missionId: string, owner: string, ttlMs?: number): { task: TaskNode; leaseId: string } | null {
    const plan = this.schedule(missionId);
    const next = plan.ready[0];
    if (!next) return null;
    const lease = this.engine.acquireLease(missionId, next.id, owner, ttlMs);
    return { task: this.engine.snapshot(missionId).tasks.find((task) => task.id === next.id)!, leaseId: lease.id };
  }
}

function requireTaskGraph() {
  // Kept as a tiny indirection to make this runtime tree-shakable and avoid
  // circular initialization between runtime and engine exports.
  return requireGraph;
}

import { TaskGraph as requireGraph } from './TaskGraph.js';

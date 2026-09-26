import type { AgentPlan, PlanReconciliation, ResourceClaim } from './AgentPlan.js';

function normalize(resource: string): string {
  return resource.replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase();
}

function overlaps(a: string, b: string): boolean {
  const x = normalize(a);
  const y = normalize(b);
  return x === y || x.startsWith(y.endsWith('/') ? y : `${y}/`) || y.startsWith(x.endsWith('/') ? x : `${x}/`);
}

function writes(claim: ResourceClaim): boolean {
  return claim.access === 'write' || claim.access === 'delete' || claim.access === 'execute';
}

export class PlanReconciler {
  reconcile(plans: AgentPlan[]): PlanReconciliation {
    const conflicts = new Map<string, { plans: Set<string>; accesses: Set<ResourceClaim['access']> }>();
    const sequenced: PlanReconciliation['sequenced'] = [];

    for (let i = 0; i < plans.length; i++) {
      for (let j = i + 1; j < plans.length; j++) {
        const a = plans[i];
        const b = plans[j];
        for (const ca of a.todos.flatMap((todo) => todo.resources)) {
          for (const cb of b.todos.flatMap((todo) => todo.resources)) {
            if (!overlaps(ca.resource, cb.resource)) continue;
            const conflict = writes(ca) || writes(cb) || ca.exclusive || cb.exclusive;
            if (!conflict) continue;

            const key = [normalize(ca.resource), normalize(cb.resource)].sort().join('|');
            const entry = conflicts.get(key) ?? { plans: new Set<string>(), accesses: new Set<ResourceClaim['access']>() };
            entry.plans.add(a.id);
            entry.plans.add(b.id);
            entry.accesses.add(ca.access);
            entry.accesses.add(cb.access);
            conflicts.set(key, entry);

            // Deterministic ordering is based on plan ID; this is a scheduling
            // decision, not a claim that one agent is "better".
            const [before, after] = a.id < b.id ? [a, b] : [b, a];
            sequenced.push({
              beforePlanId: before.id,
              afterPlanId: after.id,
              resources: [ca.resource, cb.resource],
            });
          }
        }
      }
    }

    const conflictList = [...conflicts.entries()].map(([resource, value]) => ({
      resource,
      plans: [...value.plans].sort(),
      accesses: [...value.accesses],
      reason: 'Overlapping write/exclusive resource claims require sequencing or replanning.',
    }));

    const conflictedIds = new Set(conflictList.flatMap((item) => item.plans));
    const accepted = plans.filter((plan) => !conflictedIds.has(plan.id));
    const rejected = plans.filter((plan) => conflictedIds.has(plan.id));

    return { accepted, rejected, conflicts: conflictList, sequenced };
  }
}

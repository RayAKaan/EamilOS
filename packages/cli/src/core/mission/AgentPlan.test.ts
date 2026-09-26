import { describe, expect, it } from 'vitest';
import { AgentPlanCoordinator } from './AgentPlanCoordinator.js';
import { AgentPlanStore } from './AgentPlanStore.js';
import { PlanReconciler } from './PlanReconciler.js';
import type { AgentPlan } from './AgentPlan.js';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const todo = (resource: string, access: 'read' | 'write' = 'write') => ({
  title: `work on ${resource}`,
  description: 'agent-local implementation step',
  order: 0,
  dependsOn: [],
  acceptanceCriteria: ['step passes validation'],
  resources: [{ resource, access, exclusive: false }],
  estimatedRisk: 'medium' as const,
});

describe('Phase 1.5 agent-local planning', () => {
  it('allows independent agents to maintain separate plans', () => {
    const coordinator = new AgentPlanCoordinator(new AgentPlanStore(mkdtempSync(join(tmpdir(), 'eamilos-plans-'))));
    const a = coordinator.submit({ missionId: 'm', taskId: 't', agentId: 'agent-a', objective: 'backend', todos: [todo('src/backend')] });
    const b = coordinator.submit({ missionId: 'm', taskId: 't', agentId: 'agent-b', objective: 'frontend', todos: [todo('src/frontend')] });
    expect(a.reconciliation.conflicts).toHaveLength(0);
    expect(b.reconciliation.accepted.map((p) => p.agentId)).toEqual(['agent-a', 'agent-b']);
  });

  it('detects overlapping writes and proposes deterministic sequencing', () => {
    const plans = (id: string, agent: string, resource: string): AgentPlan => ({
      id, missionId: 'm', taskId: 't', agentId: agent, revision: 1, objective: agent,
      todos: [todo(resource)],
      generatedAt: new Date().toISOString(), metadata: {},
    });
    const result = new PlanReconciler().reconcile([
      plans('plan-b', 'agent-b', 'src/shared'),
      plans('plan-a', 'agent-a', 'src/shared/file.ts'),
    ]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.rejected).toHaveLength(2);
    expect(result.sequenced[0].beforePlanId).toBe('plan-a');
    expect(result.sequenced[0].afterPlanId).toBe('plan-b');
  });

  it('allows concurrent read-only plans on the same resource', () => {
    const make = (id: string): AgentPlan => ({
      id, missionId: 'm', taskId: 't', agentId: id, revision: 1, objective: id,
      todos: [todo('src/shared/config.ts', 'read')],
      generatedAt: new Date().toISOString(), metadata: {},
    });
    const result = new PlanReconciler().reconcile([make('a'), make('b')]);
    expect(result.conflicts).toHaveLength(0);
    expect(result.accepted).toHaveLength(2);
  });
});

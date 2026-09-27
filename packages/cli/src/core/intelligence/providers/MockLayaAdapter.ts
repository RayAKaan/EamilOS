import { randomUUID } from 'node:crypto';
import type { LayaModelAdapter, LayaPlan, LayaRequest } from '../types.js';

export class MockLayaAdapter implements LayaModelAdapter {
  readonly id = 'mock-laya';
  async load(): Promise<void> {}
  async unload(): Promise<void> {}
  async generate(request: LayaRequest): Promise<LayaPlan> {
    const taskId = 'task_' + randomUUID();
    const proposalId = 'proposal_' + randomUUID();
    return {
      planId: 'plan_' + randomUUID(),
      missionId: request.missionId,
      parentTaskId: request.parentTaskId,
      objective: request.objective,
      tasks: [{
        proposalId, missionId: request.missionId, agentId: 'mock-laya', baseGraphVersion: request.context.existingTasks.length,
        globalTaskId: taskId, parentTaskId: request.parentTaskId, title: request.objective, objective: request.objective,
        dependencies: [], priority: 'MEDIUM', requiredCapabilities: [], acceptanceCriteria: request.context.acceptanceCriteria,
        readSet: [], writeSet: [], idempotencyKey: 'mock:' + request.missionId + ':' + request.objective, orderingAfter: [],
        createdAt: new Date().toISOString(), metadata: {},
      }],
      dependencies: [], assumptions: ['mock'], risks: [], createdAt: new Date().toISOString(),
    };
  }
  async health() { return { healthy: true }; }
}
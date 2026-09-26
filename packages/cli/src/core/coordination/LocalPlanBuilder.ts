import { randomUUID } from 'crypto';
import type { TaskNode } from '../mission/types.js';
import type { LocalPlan, LocalTodo, TaskProposal } from './types.js';

export class LocalPlanBuilder {
  build(input: {
    missionId: string;
    agentId: string;
    graphVersion: number;
    tasks: TaskNode[];
    proposals?: TaskProposal[];
  }): LocalPlan {
    const proposals = input.proposals ?? [];
    const proposalByTask = new Map(proposals.filter((p) => p.globalTaskId).map((p) => [p.globalTaskId!, p]));
    const now = new Date().toISOString();

    const todos: LocalTodo[] = input.tasks.map((task) => {
      const proposal = proposalByTask.get(task.id);
      return {
        id: `todo_${randomUUID()}`,
        taskId: task.id,
        agentId: input.agentId,
        title: proposal?.title ?? task.title,
        objective: proposal?.objective ?? task.description,
        dependencies: [...task.dependencies],
        readSet: proposal?.readSet ?? [],
        writeSet: proposal?.writeSet ?? [],
        state: task.state === 'COMPLETED' ? 'DONE' : 'TODO',
        reconciliationAction: 'ACCEPT',
      };
    });

    return {
      planId: `plan_${randomUUID()}`,
      missionId: input.missionId,
      agentId: input.agentId,
      baseGraphVersion: input.graphVersion,
      revision: 1,
      todos,
      createdAt: now,
      updatedAt: now,
      metadata: {},
    };
  }
}

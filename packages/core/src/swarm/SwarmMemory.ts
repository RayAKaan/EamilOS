import type {
  SpawnedAgent,
  Subtask,
  Decision,
  SwarmMessage,
  SwarmCheckpoint,
  TaskPlan,
} from './types.js';

export interface SwarmMemoryState {
  agents: Map<string, SpawnedAgent>;
  subtasks: Map<string, Subtask>;
  decisions: Map<string, Decision>;
  messages: SwarmMessage[];
  checkpoints: Map<string, SwarmCheckpoint>;
  taskBoards: Map<string, TaskPlan>;
  results: Map<string, unknown>;
}

export class SwarmMemory {
  private state: SwarmMemoryState;
  private maxMessages: number;
  private maxCheckpoints: number;

  constructor(maxMessages: number = 1000, maxCheckpoints: number = 10) {
    this.maxMessages = maxMessages;
    this.maxCheckpoints = maxCheckpoints;
    this.state = {
      agents: new Map(),
      subtasks: new Map(),
      decisions: new Map(),
      messages: [],
      checkpoints: new Map(),
      taskBoards: new Map(),
      results: new Map(),
    };
  }

  storeAgent(agent: SpawnedAgent): void {
    this.state.agents.set(agent.id, { ...agent });
  }

  getAgent(agentId: string): SpawnedAgent | undefined {
    return this.state.agents.get(agentId);
  }

  getAllAgents(): SpawnedAgent[] {
    return Array.from(this.state.agents.values());
  }

  removeAgent(agentId: string): void {
    this.state.agents.delete(agentId);
  }

  storeSubtask(subtask: Subtask): void {
    this.state.subtasks.set(subtask.id, { ...subtask });
  }

  getSubtask(subtaskId: string): Subtask | undefined {
    return this.state.subtasks.get(subtaskId);
  }

  getSubtasksByTask(taskId: string): Subtask[] {
    return Array.from(this.state.subtasks.values()).filter(
      (s) => s.parentTaskId === taskId
    );
  }

  getAllSubtasks(): Subtask[] {
    return Array.from(this.state.subtasks.values());
  }

  removeSubtask(subtaskId: string): void {
    this.state.subtasks.delete(subtaskId);
  }

  storeDecision(decision: Decision): void {
    this.state.decisions.set(decision.id, { ...decision });
  }

  getDecision(decisionId: string): Decision | undefined {
    return this.state.decisions.get(decisionId);
  }

  getUnresolvedDecisions(): Decision[] {
    return Array.from(this.state.decisions.values()).filter((d) => !d.resolved);
  }

  getAllDecisions(): Decision[] {
    return Array.from(this.state.decisions.values());
  }

  resolveDecision(decisionId: string, binding: boolean): void {
    const decision = this.state.decisions.get(decisionId);
    if (decision) {
      decision.resolved = true;
      decision.binding = binding;
      this.state.decisions.set(decisionId, decision);
    }
  }

  addMessage(message: SwarmMessage): void {
    this.state.messages.push(message);
    if (this.state.messages.length > this.maxMessages) {
      this.state.messages = this.state.messages.slice(-this.maxMessages);
    }
  }

  getMessages(limit?: number): SwarmMessage[] {
    if (limit) {
      return this.state.messages.slice(-limit);
    }
    return [...this.state.messages];
  }

  getMessagesByAgent(agentId: string): SwarmMessage[] {
    return this.state.messages.filter(
      (m) => m.from === agentId || m.to === agentId
    );
  }

  getMessagesByTopic(topic: string): SwarmMessage[] {
    return this.state.messages.filter((m) => m.topic === topic);
  }

  clearMessages(): void {
    this.state.messages = [];
  }

  createCheckpoint(
    tick: number,
    agents: SpawnedAgent[],
    strategy: unknown,
    pendingDecisions: Decision[]
  ): SwarmCheckpoint {
    const checkpoint: SwarmCheckpoint = {
      tick,
      timestamp: Date.now(),
      agents: agents.map((a) => ({ ...a })),
      memory: this.exportState(),
      strategy: strategy as SwarmCheckpoint['strategy'],
      pendingDecisions: pendingDecisions.map((d) => ({ ...d })),
    };

    this.state.checkpoints.set(`checkpoint-${tick}`, checkpoint);

    if (this.state.checkpoints.size > this.maxCheckpoints) {
      const oldest = Array.from(this.state.checkpoints.keys())[0];
      this.state.checkpoints.delete(oldest);
    }

    return checkpoint;
  }

  getCheckpoint(checkpointId: string): SwarmCheckpoint | undefined {
    return this.state.checkpoints.get(checkpointId);
  }

  listCheckpoints(): string[] {
    return Array.from(this.state.checkpoints.keys());
  }

  deleteCheckpoint(checkpointId: string): void {
    this.state.checkpoints.delete(checkpointId);
  }

  storeTaskBoard(taskPlan: TaskPlan): void {
    this.state.taskBoards.set(taskPlan.taskId, { ...taskPlan });
  }

  getTaskBoard(taskId: string): TaskPlan | undefined {
    return this.state.taskBoards.get(taskId);
  }

  getAllTaskBoards(): TaskPlan[] {
    return Array.from(this.state.taskBoards.values());
  }

  storeResult(subtaskId: string, result: unknown): void {
    this.state.results.set(subtaskId, result);
  }

  getResult(subtaskId: string): unknown | undefined {
    return this.state.results.get(subtaskId);
  }

  getAllResults(): Map<string, unknown> {
    return new Map(this.state.results);
  }

  exportState(): unknown {
    return {
      agents: Array.from(this.state.agents.entries()),
      subtasks: Array.from(this.state.subtasks.entries()),
      decisions: Array.from(this.state.decisions.entries()),
      messages: this.state.messages.slice(),
      results: Array.from(this.state.results.entries()),
    };
  }

  importState(snapshot: unknown): void {
    const data = snapshot as {
      agents?: Array<[string, SpawnedAgent]>;
      subtasks?: Array<[string, Subtask]>;
      decisions?: Array<[string, Decision]>;
      messages?: SwarmMessage[];
      results?: Array<[string, unknown]>;
    };

    if (data.agents) {
      this.state.agents = new Map(data.agents);
    }
    if (data.subtasks) {
      this.state.subtasks = new Map(data.subtasks);
    }
    if (data.decisions) {
      this.state.decisions = new Map(data.decisions);
    }
    if (data.messages) {
      this.state.messages = data.messages;
    }
    if (data.results) {
      this.state.results = new Map(data.results);
    }
  }

  reset(): void {
    this.state.agents.clear();
    this.state.subtasks.clear();
    this.state.decisions.clear();
    this.state.messages = [];
    this.state.checkpoints.clear();
    this.state.taskBoards.clear();
    this.state.results.clear();
  }

  getMemoryUsage(): { messageCount: number; checkpointCount: number; decisionCount: number } {
    return {
      messageCount: this.state.messages.length,
      checkpointCount: this.state.checkpoints.size,
      decisionCount: this.state.decisions.size,
    };
  }

  prune(olderThanMs?: number): number {
    let pruned = 0;
    const cutoff = olderThanMs ? Date.now() - olderThanMs : 0;

    if (cutoff > 0) {
      const before = this.state.messages.length;
      this.state.messages = this.state.messages.filter((m) => m.timestamp >= cutoff);
      pruned += before - this.state.messages.length;
    }

    return pruned;
  }
}

let globalMemory: SwarmMemory | null = null;

export function initSwarmMemory(maxMessages?: number, maxCheckpoints?: number): SwarmMemory {
  globalMemory = new SwarmMemory(maxMessages, maxCheckpoints);
  return globalMemory;
}

export function getSwarmMemory(): SwarmMemory | null {
  return globalMemory;
}

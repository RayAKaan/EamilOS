import { EventEmitter } from 'events';
import type {
  ControlCommand,
  ControlResult,
  ControlMode,
  SwarmConstraints,
  Decision,
  SwarmMessage,
  AuditEntry,
  SpawnedAgent,
} from '../swarm/types.js';

export class ControlManager extends EventEmitter {
  private state: {
    paused: boolean;
    mode: ControlMode;
    activeConstraints: SwarmConstraints;
    pausedAt?: number;
  };

  private auditLog: AuditEntry[] = [];
  private pendingDecisions: Map<string, Decision> = new Map();
  private agents: Map<string, SpawnedAgent> = new Map();

  constructor(constraints: SwarmConstraints, mode: ControlMode = 'guided') {
    super();
    this.state = {
      paused: false,
      mode,
      activeConstraints: constraints,
      pausedAt: undefined,
    };
  }

  async processCommand(cmd: ControlCommand): Promise<ControlResult> {
    this.logCommand(cmd);

    switch (cmd.type) {
      case 'pause':
        return this.pause();

      case 'resume':
        return this.resume();

      case 'stop':
        return this.stop(cmd.force ?? false);

      case 'emergency-stop':
        return this.emergencyStop();

      case 'add-agent':
        return this.addAgent(cmd.role);

      case 'remove-agent':
        return this.removeAgent(cmd.agentId);

      case 'change-model':
        return this.changeModel(cmd.agentId, cmd.model);

      case 'set-strategy':
        return this.setStrategy(cmd.strategy);

      case 'set-mode':
        return this.setMode(cmd.mode);

      case 'limit-cost':
        return this.limitCost(cmd.maxCost);

      case 'limit-agents':
        return this.limitAgents(cmd.maxAgents);

      case 'inject-message':
        return this.injectMessage(cmd.message);

      case 'prioritize':
        return this.prioritize(cmd.taskId, cmd.priority);

      case 'approve':
        return this.approveDecision(cmd.decisionId);

      case 'reject':
        return this.rejectDecision(cmd.decisionId, cmd.reason);

      case 'checkpoint':
        return this.createCheckpoint(cmd.checkpointId);

      case 'rollback':
        return this.rollback(cmd.checkpointId);

      case 'query-status':
        return this.queryStatus();

      case 'query-agents':
        return this.queryAgents();

      case 'query-cost':
        return this.queryCost();

      case 'query-decisions':
        return this.queryDecisions();

      case 'inject-goal':
        return this.injectGoal(cmd.goal, cmd.priority);

      case 'blacklist-model':
        return this.blacklistModel(cmd.model);

      case 'whitelist-model':
        return this.whitelistModel(cmd.model);

      case 'set-rate-limit':
        return this.setRateLimit(cmd.maxConcurrent);

      default:
        return { status: 'error', message: `Unknown command type` };
    }
  }

  private logCommand(cmd: ControlCommand): void {
    this.auditLog.push({
      timestamp: Date.now(),
      source: 'operator',
      type: cmd.type,
      details: cmd as unknown as Record<string, unknown>,
    });
  }

  private pause(): ControlResult {
    this.state.paused = true;
    this.state.pausedAt = Date.now();
    this.emit('swarm:pause');
    return { status: 'ok', message: 'Swarm paused. All agents holding.' };
  }

  private resume(): ControlResult {
    this.state.paused = false;
    this.state.pausedAt = undefined;
    this.emit('swarm:resume');
    return { status: 'ok', message: 'Swarm resumed. All agents continuing.' };
  }

  private stop(force: boolean): ControlResult {
    this.emit('swarm:stop', { force });
    return {
      status: 'ok',
      message: force
        ? 'Swarm force stopped immediately.'
        : 'Swarm stop requested. Agents will complete current work.',
    };
  }

  private emergencyStop(): ControlResult {
    this.state.paused = true;
    this.emit('swarm:emergency-stop');
    return { status: 'ok', message: 'EMERGENCY STOP executed. All agents terminated.' };
  }

  private addAgent(role: string): ControlResult {
    if (this.state.activeConstraints.maxAgents <= this.agents.size) {
      return {
        status: 'error',
        message: `Cannot add agent: max agents (${this.state.activeConstraints.maxAgents}) reached`,
      };
    }

    this.emit('agent:add', { role });
    return { status: 'ok', message: `Agent with role '${role}' will be spawned.` };
  }

  private removeAgent(agentId: string): ControlResult {
    if (!this.agents.has(agentId)) {
      return { status: 'error', message: `Agent '${agentId}' not found` };
    }

    this.emit('agent:remove', { agentId });
    return { status: 'ok', message: `Agent '${agentId}' removal initiated.` };
  }

  private changeModel(agentId: string, model: string): ControlResult {
    if (!this.state.activeConstraints.allowedModels.includes(model)) {
      return {
        status: 'error',
        message: `Model '${model}' not in allowed models list`,
      };
    }

    const agent = this.agents.get(agentId);
    if (agent) {
      agent.assignedModel = model;
    }

    this.emit('agent:model-change', { agentId, newModel: model });
    return { status: 'ok', message: `Model swap queued for '${agentId}' to '${model}'.` };
  }

  private setStrategy(strategy: string): ControlResult {
    this.emit('strategy:change', { strategy });
    return { status: 'ok', message: `Strategy changed to '${strategy}'.` };
  }

  private setMode(mode: ControlMode): ControlResult {
    const oldMode = this.state.mode;
    this.state.mode = mode;
    this.emit('mode:change', { from: oldMode, to: mode });
    return {
      status: 'ok',
      message: `Mode changed: ${oldMode} → ${mode}`,
    };
  }

  private limitCost(maxCost: number): ControlResult {
    this.state.activeConstraints.maxCostUSD = maxCost;
    this.emit('constraint:cost-limit', { maxCost });
    return { status: 'ok', message: `Cost limit set to $${maxCost}` };
  }

  private limitAgents(maxAgents: number): ControlResult {
    this.state.activeConstraints.maxAgents = maxAgents;
    this.emit('constraint:agent-limit', { maxAgents });
    return { status: 'ok', message: `Max agents set to ${maxAgents}` };
  }

  private injectMessage(message: Partial<SwarmMessage>): ControlResult {
    this.emit('message:inject', { message });
    return { status: 'ok', message: 'Message injected into swarm.' };
  }

  private prioritize(taskId: string, priority: number): ControlResult {
    this.emit('task:prioritize', { taskId, priority });
    return { status: 'ok', message: `Task '${taskId}' priority set to ${priority}` };
  }

  private approveDecision(decisionId: string): ControlResult {
    const decision = this.pendingDecisions.get(decisionId);
    if (!decision) {
      return { status: 'error', message: `Decision '${decisionId}' not found` };
    }

    decision.resolved = true;
    decision.binding = true;
    this.pendingDecisions.delete(decisionId);
    this.emit('decision:resolved', { decisionId, approved: true });
    return { status: 'ok', message: `Decision '${decisionId}' approved.` };
  }

  private rejectDecision(decisionId: string, reason: string): ControlResult {
    const decision = this.pendingDecisions.get(decisionId);
    if (!decision) {
      return { status: 'error', message: `Decision '${decisionId}' not found` };
    }

    decision.resolved = true;
    decision.binding = false;
    this.pendingDecisions.delete(decisionId);
    this.emit('decision:resolved', { decisionId, approved: false, reason });
    return { status: 'ok', message: `Decision '${decisionId}' rejected: ${reason}` };
  }

  private createCheckpoint(checkpointId?: string): ControlResult {
    const id = checkpointId ?? `checkpoint-${Date.now()}`;
    this.emit('checkpoint:create', { checkpointId: id });
    return { status: 'ok', message: `Checkpoint '${id}' created.`, data: { checkpointId: id } };
  }

  private rollback(checkpointId: string): ControlResult {
    this.emit('checkpoint:rollback', { checkpointId });
    return { status: 'ok', message: `Rollback to '${checkpointId}' initiated.` };
  }

  private queryStatus(): ControlResult {
    return {
      status: 'ok',
      data: {
        paused: this.state.paused,
        mode: this.state.mode,
        agentCount: this.agents.size,
        pendingDecisions: this.pendingDecisions.size,
      },
    };
  }

  private queryAgents(): ControlResult {
    return {
      status: 'ok',
      data: { agents: Array.from(this.agents.values()) },
    };
  }

  private queryCost(): ControlResult {
    const totalCost = Array.from(this.agents.values()).reduce((sum, a) => sum + a.costSoFar, 0);
    return {
      status: 'ok',
      data: {
        totalCost,
        budget: this.state.activeConstraints.maxCostUSD,
        remaining: this.state.activeConstraints.maxCostUSD - totalCost,
      },
    };
  }

  private queryDecisions(): ControlResult {
    return {
      status: 'ok',
      data: { decisions: Array.from(this.pendingDecisions.values()) },
    };
  }

  private injectGoal(goal: string, priority?: number): ControlResult {
    this.emit('goal:inject', { goal, priority });
    return { status: 'ok', message: `Goal '${goal}' injected into swarm.` };
  }

  private blacklistModel(model: string): ControlResult {
    if (!this.state.activeConstraints.forbiddenModels.includes(model)) {
      this.state.activeConstraints.forbiddenModels.push(model);
      this.state.activeConstraints.allowedModels = this.state.activeConstraints.allowedModels.filter(
        (m) => m !== model
      );
    }
    this.emit('model:blacklist', { model });
    return { status: 'ok', message: `Model '${model}' blacklisted.` };
  }

  private whitelistModel(model: string): ControlResult {
    if (!this.state.activeConstraints.allowedModels.includes(model)) {
      this.state.activeConstraints.allowedModels.push(model);
      this.state.activeConstraints.forbiddenModels = this.state.activeConstraints.forbiddenModels.filter(
        (m) => m !== model
      );
    }
    this.emit('model:whitelist', { model });
    return { status: 'ok', message: `Model '${model}' whitelisted.` };
  }

  private setRateLimit(maxConcurrent: number): ControlResult {
    this.state.activeConstraints.maxParallelInferences = maxConcurrent;
    this.emit('constraint:rate-limit', { maxConcurrent });
    return { status: 'ok', message: `Rate limit set to ${maxConcurrent} concurrent inferences.` };
  }

  registerAgent(agent: SpawnedAgent): void {
    this.agents.set(agent.id, agent);
  }

  unregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
  }

  addPendingDecision(decision: Decision): void {
    this.pendingDecisions.set(decision.id, decision);
    this.emit('decision:pending', decision);
  }

  isPaused(): boolean {
    return this.state.paused;
  }

  getMode(): ControlMode {
    return this.state.mode;
  }

  getConstraints(): SwarmConstraints {
    return { ...this.state.activeConstraints };
  }

  getAuditLog(): AuditEntry[] {
    return [...this.auditLog];
  }

  getPendingDecisions(): Decision[] {
    return Array.from(this.pendingDecisions.values());
  }

  getState(): { paused: boolean; mode: ControlMode; pendingDecisions: number; agentCount: number } {
    return {
      paused: this.state.paused,
      mode: this.state.mode,
      pendingDecisions: this.pendingDecisions.size,
      agentCount: this.agents.size,
    };
  }
}

let globalControlManager: ControlManager | null = null;

export function initControlManager(
  constraints: SwarmConstraints,
  mode?: ControlMode
): ControlManager {
  globalControlManager = new ControlManager(constraints, mode);
  return globalControlManager;
}

export function getControlManager(): ControlManager | null {
  return globalControlManager;
}

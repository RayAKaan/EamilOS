import { EventEmitter } from 'events';
import { getAgentRegistry } from '../agent-registry.js';
import { autoDiscovery } from '../auto-discovery.js';
import { getLogger, Logger } from '../logger.js';

export interface HealthCheckResult {
  healthy: boolean;
  score: number;
  latency?: number;
  error?: string;
  lastCheck: number;
}

export interface HealthMonitorConfig {
  checkInterval: number;
  failureThreshold: number;
  recoveryThreshold: number;
  failoverEnabled: boolean;
}

export interface AgentHealthState {
  agentId: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'offline' | 'unknown';
  score: number;
  consecutiveFailures: number;
  lastCheck: number;
  lastHealthy: number;
  latency?: number;
  error?: string;
}

export interface HealthReport {
  total: number;
  healthy: number;
  degraded: number;
  unhealthy: number;
  offline: number;
  unknown: number;
  averageScore: number;
  agents: AgentHealthState[];
  timestamp: number;
}

const DEFAULT_CONFIG: HealthMonitorConfig = {
  checkInterval: 30000,
  failureThreshold: 3,
  recoveryThreshold: 70,
  failoverEnabled: true,
};

export class HealthMonitor extends EventEmitter {
  private registry: ReturnType<typeof getAgentRegistry>;
  private config: HealthMonitorConfig;
  private logger: Logger;
  private checkInterval?: NodeJS.Timeout;
  private healthStates: Map<string, AgentHealthState> = new Map();
  private pendingTasks: Map<string, string[]> = new Map();

  constructor(config?: Partial<HealthMonitorConfig>) {
    super();
    this.registry = getAgentRegistry();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = getLogger();
  }

  start(): void {
    if (this.checkInterval) {
      this.logger.warn('Health monitor already started');
      return;
    }

    this.logger.info(`Starting health monitor (interval: ${this.config.checkInterval}ms)`);
    this.runInitialCheck();

    this.checkInterval = setInterval(() => {
      this.checkAllAgents().catch((err) => this.logger.error('Health check failed:', err));
    }, this.config.checkInterval);
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
      this.logger.info('Health monitor stopped');
    }
  }

  private async runInitialCheck(): Promise<void> {
    this.logger.info('Running initial health check...');
    await this.checkAllAgents();
  }

  private async checkAllAgents(): Promise<void> {
    const agents = this.registry.getAllAgents();
    const discovered = autoDiscovery.getAll();

    const allIds = new Set<string>();
    for (const agent of agents) allIds.add(agent.id);
    for (const d of discovered) allIds.add(d.id);

    for (const agentId of allIds) {
      try {
        const result = await this.checkAgent(agentId);
        this.updateHealthState(agentId, result);
      } catch (error) {
        this.updateHealthState(agentId, {
          healthy: false,
          score: 0,
          error: error instanceof Error ? error.message : String(error),
          lastCheck: Date.now(),
        });
      }
    }
  }

  private async checkAgent(agentId: string): Promise<HealthCheckResult> {
    const start = Date.now();

    const discovered = autoDiscovery.getById(agentId);
    if (!discovered) {
      const agent = this.registry.getAgent(agentId);
      if (!agent) {
        return { healthy: false, score: 0, error: 'Agent not found', lastCheck: Date.now() };
      }

      const health = await autoDiscovery.checkHealth(agentId);
      return {
        healthy: health,
        score: health ? 100 : 0,
        latency: Date.now() - start,
        lastCheck: Date.now(),
      };
    }

    const health = await autoDiscovery.checkHealth(agentId);
    const latency = Date.now() - start;

    return {
      healthy: health,
      score: health ? 100 : 0,
      latency,
      lastCheck: Date.now(),
    };
  }

  private updateHealthState(agentId: string, result: HealthCheckResult): void {
    const previous = this.healthStates.get(agentId);
    const consecutiveFailures = previous?.consecutiveFailures ?? 0;

    if (result.healthy) {
      const state: AgentHealthState = {
        agentId,
        status: 'healthy',
        score: result.score,
        consecutiveFailures: 0,
        lastCheck: result.lastCheck,
        lastHealthy: result.lastCheck,
        latency: result.latency,
      };

      this.healthStates.set(agentId, state);

      if (previous && previous.status !== 'healthy') {
        this.logger.info(`Agent ${agentId} recovered (score: ${result.score})`);
        this.emit('agent:recovered', { agentId, score: result.score, latency: result.latency });
      }
    } else {
      const newFailureCount = consecutiveFailures + 1;
      const score = Math.max(0, 100 - newFailureCount * 30);

      let status: AgentHealthState['status'];
      if (newFailureCount >= this.config.failureThreshold) {
        status = 'unhealthy';
      } else if (score < 50) {
        status = 'degraded';
      } else {
        status = 'degraded';
      }

      const state: AgentHealthState = {
        agentId,
        status,
        score,
        consecutiveFailures: newFailureCount,
        lastCheck: result.lastCheck,
        lastHealthy: previous?.lastHealthy ?? Date.now(),
        latency: result.latency,
        error: result.error,
      };

      this.healthStates.set(agentId, state);

      this.logger.warn(
        `Agent ${agentId} health degraded (failures: ${newFailureCount}, score: ${score}, status: ${status})`
      );

      this.emit('agent:health-degraded', {
        agentId,
        failures: newFailureCount,
        score,
        error: result.error,
      });

      if (
        newFailureCount >= this.config.failureThreshold &&
        this.config.failoverEnabled &&
        status === 'unhealthy'
      ) {
        this.handleFailover(agentId);
      }
    }
  }

  private handleFailover(agentId: string): void {
    this.logger.error(`Agent ${agentId} reached failure threshold, initiating failover`);

    const fallback = this.findFallbackAgent(agentId);

    if (fallback) {
      this.logger.info(`Failover target: ${fallback}`);

      const tasks = this.pendingTasks.get(agentId) || [];
      if (tasks.length > 0) {
        this.pendingTasks.delete(agentId);
        this.pendingTasks.set(fallback, [...(this.pendingTasks.get(fallback) || []), ...tasks]);
        this.logger.info(`Transferred ${tasks.length} pending tasks from ${agentId} to ${fallback}`);
      }

      const originalState = this.healthStates.get(agentId);
      if (originalState) {
        originalState.status = 'offline';
        this.healthStates.set(agentId, originalState);
      }

      this.emit('agent:failover', {
        from: agentId,
        to: fallback,
        tasksTransferred: tasks.length,
      });
    } else {
      this.logger.error(`No fallback agent available for ${agentId}`);
      this.emit('agent:failover-failed', { agentId });
    }
  }

  private findFallbackAgent(failedAgentId: string): string | null {
    const failedAgent = autoDiscovery.getById(failedAgentId) || this.registry.getAgent(failedAgentId);

    if (!failedAgent) return null;

    const failedCaps = 'capabilities' in failedAgent ? failedAgent.capabilities : [];

    const candidates = autoDiscovery
      .getByCapability('code')
      .filter((a: { id: string }) => {
        if (a.id === failedAgentId) return false;
        const state = this.healthStates.get(a.id);
        return !state || state.status === 'healthy';
      });

    if (candidates.length === 0) {
      return null;
    }

    const scored = candidates.map((agent) => ({
      id: agent.id,
      score: agent.capabilities.filter((c) => failedCaps.includes(c)).length,
      latency: agent.health?.latency ?? 0,
    }));

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.latency - b.latency;
    });

    return scored[0].id;
  }

  getHealthReport(): HealthReport {
    const allAgents = [
      ...this.registry.getAllAgents().map((a) => a.id),
      ...autoDiscovery.getAll().map((a) => a.id),
    ];
    const uniqueIds = [...new Set(allAgents)];

    const states: AgentHealthState[] = uniqueIds.map((id) => {
      const existing = this.healthStates.get(id);
      if (existing) return existing;

      const discovered = autoDiscovery.getById(id);
      return {
        agentId: id,
        status: discovered?.status === 'available' ? 'unknown' : 'unknown',
        score: 50,
        consecutiveFailures: 0,
        lastCheck: 0,
        lastHealthy: 0,
      };
    });

    for (const [id, state] of this.healthStates) {
      if (!uniqueIds.includes(id)) {
        states.push(state);
      }
    }

    const healthy = states.filter((s) => s.status === 'healthy').length;
    const degraded = states.filter((s) => s.status === 'degraded').length;
    const unhealthy = states.filter((s) => s.status === 'unhealthy').length;
    const offline = states.filter((s) => s.status === 'offline').length;
    const unknown = states.filter((s) => s.status === 'unknown').length;
    const total = states.length;
    const averageScore = total > 0 ? states.reduce((sum, s) => sum + s.score, 0) / total : 0;

    return {
      total,
      healthy,
      degraded,
      unhealthy,
      offline,
      unknown,
      averageScore,
      agents: states,
      timestamp: Date.now(),
    };
  }

  getAgentHealth(agentId: string): AgentHealthState | null {
    return this.healthStates.get(agentId) || null;
  }

  getAllHealthStates(): Map<string, AgentHealthState> {
    return new Map(this.healthStates);
  }

  markTaskPending(agentId: string, taskId: string): void {
    const tasks = this.pendingTasks.get(agentId) || [];
    tasks.push(taskId);
    this.pendingTasks.set(agentId, tasks);
  }

  removePendingTask(agentId: string, taskId: string): void {
    const tasks = this.pendingTasks.get(agentId);
    if (!tasks) return;
    const idx = tasks.indexOf(taskId);
    if (idx >= 0) tasks.splice(idx, 1);
    if (tasks.length === 0) this.pendingTasks.delete(agentId);
  }

  getPendingTasksForAgent(agentId: string): string[] {
    return this.pendingTasks.get(agentId) || [];
  }

  reassignPendingTasks(fromAgentId: string, toAgentId: string): number {
    const fromTasks = this.pendingTasks.get(fromAgentId) || [];
    if (fromTasks.length === 0) return 0;

    const toTasks = this.pendingTasks.get(toAgentId) || [];
    this.pendingTasks.set(toAgentId, [...toTasks, ...fromTasks]);
    this.pendingTasks.delete(fromAgentId);

    return fromTasks.length;
  }
}

let globalHealthMonitor: HealthMonitor | null = null;

export function initHealthMonitor(config?: Partial<HealthMonitorConfig>): HealthMonitor {
  globalHealthMonitor = new HealthMonitor(config);
  return globalHealthMonitor;
}

export function getHealthMonitor(): HealthMonitor {
  if (!globalHealthMonitor) {
    return initHealthMonitor();
  }
  return globalHealthMonitor;
}

import type {
  Task,
  TaskAnalysis,
  SpawnedAgent,
  SwarmConstraints,
  AgentConstraints,
  SwarmAgentRole,
  Lifecycle,
} from './types.js';

export interface SpawnerConfig {
  defaultMaxRetries: number;
  defaultTimeoutMs: number;
  defaultMaxTokens: number;
}

const DEFAULT_CONFIG: SpawnerConfig = {
  defaultMaxRetries: 3,
  defaultTimeoutMs: 60000,
  defaultMaxTokens: 8000,
};

const TEAM_SIZE_BY_COMPLEXITY: Record<string, { min: number; max: number }> = {
  low: { min: 2, max: 2 },
  medium: { min: 3, max: 5 },
  high: { min: 5, max: 8 },
  critical: { min: 6, max: 10 },
};

export class AgentSpawner {
  private config: SpawnerConfig;

  constructor(config?: Partial<SpawnerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  analyzeTask(task: Task): TaskAnalysis {
    const description = task.description.toLowerCase();
    const tokenEstimate = task.description.length / 4;

    let complexity: TaskAnalysis['complexity'] = 'low';
    if (tokenEstimate > 5000 || description.length > 20000) {
      complexity = 'critical';
    } else if (tokenEstimate > 2000 || description.length > 8000) {
      complexity = 'high';
    } else if (tokenEstimate > 500) {
      complexity = 'medium';
    }

    const domains: TaskAnalysis['domains'] = [];
    if (/\b(code|function|api|implement|build|create|file|class)\b/.test(description)) {
      domains.push('coding');
    }
    if (/\b(think|reason|analyze|evaluate|consider)\b/.test(description)) {
      domains.push('reasoning');
    }
    if (/\b(plan|strategy|architecture|design|decompose)\b/.test(description)) {
      domains.push('planning');
    }
    if (/\b(research|search|find|look up|investigate)\b/.test(description)) {
      domains.push('research');
    }
    if (/\b(review|check|validate|verify|test)\b/.test(description)) {
      domains.push('review');
    }
    if (/\b(data|database|query|analytics|metrics)\b/.test(description)) {
      domains.push('data-analysis');
    }

    const decomposable = /\b(split|divide|decompose|parallel|concurrent)\b/.test(description) ||
      (domains.length > 1 && complexity !== 'low');

    const requiresIteration = /\b(refine|iterate|improve|optimize|review|correct)\b/.test(description);

    let ambiguityLevel: TaskAnalysis['ambiguityLevel'] = 'clear';
    if (/\b(maybe|perhaps|possibly|unclear|vague|ambiguous)\b/.test(description)) {
      ambiguityLevel = 'high';
    } else if (/\b(should|may|might|consider|think about)\b/.test(description)) {
      ambiguityLevel = 'moderate';
    }

    const estimatedSteps = Math.ceil(tokenEstimate / 500) * Math.max(1, domains.length);

    return {
      complexity,
      domains,
      decomposable,
      estimatedSteps,
      requiresIteration,
      ambiguityLevel,
    };
  }

  spawnAgents(task: Task, constraints: SwarmConstraints): SpawnedAgent[] {
    const analysis = this.analyzeTask(task);
    const teamSize = this.determineTeamSize(analysis, constraints);
    const roles = this.determineRoles(analysis, teamSize);

    const agents: SpawnedAgent[] = [];

    for (const role of roles) {
      const agent = this.spawnAgent(role, task.id, constraints);
      agents.push(agent);
    }

    if (!agents.some(a => a.role === 'executor')) {
      const executor = this.spawnAgent('executor', task.id, constraints);
      agents.push(executor);
    }

    if (!agents.some(a => a.role === 'validator')) {
      const validator = this.spawnAgent('validator', task.id, constraints);
      agents.push(validator);
    }

    return agents;
  }

  spawnSingle(role: SwarmAgentRole, taskId: string, constraints: SwarmConstraints): SpawnedAgent {
    return this.spawnAgent(role, taskId, constraints);
  }

  private spawnAgent(
    role: SwarmAgentRole,
    taskId: string,
    constraints: SwarmConstraints
  ): SpawnedAgent {
    const id = this.generateAgentId(role);
    const lifecycle = this.determineLifecycle(role, constraints);

    return {
      id,
      role,
      assignedModel: this.selectModelForRole(role, constraints),
      priority: this.rolePriority(role),
      lifecycle,
      parentTask: taskId,
      constraints: this.deriveAgentConstraints(constraints),
      status: 'idle',
      costSoFar: 0,
      tokensIn: 0,
      tokensOut: 0,
      lastHeartbeat: Date.now(),
      failureCount: 0,
    };
  }

  private determineTeamSize(analysis: TaskAnalysis, constraints: SwarmConstraints): number {
    const { min, max } = TEAM_SIZE_BY_COMPLEXITY[analysis.complexity];
    return Math.min(max, Math.max(min, constraints.maxAgents));
  }

  private determineRoles(analysis: TaskAnalysis, teamSize: number): SwarmAgentRole[] {
    const roles: SwarmAgentRole[] = [];

    roles.push('planner');

    const executorCount = Math.max(1, Math.floor(teamSize / 2));
    for (let i = 0; i < executorCount; i++) {
      roles.push('executor');
    }

    if (analysis.ambiguityLevel === 'high') {
      roles.push('researcher');
    }

    if (analysis.complexity === 'critical') {
      roles.push('critic');
    }

    if (analysis.requiresIteration && roles.length < teamSize) {
      roles.push('optimizer');
    }

    return roles.slice(0, teamSize);
  }

  private determineLifecycle(role: SwarmAgentRole, constraints: SwarmConstraints): Lifecycle {
    if (role === 'researcher') {
      return 'ephemeral';
    }

    if (constraints.preferLocalModels) {
      const localModels = ['local', 'ollama', 'llama'];
      for (const model of constraints.allowedModels) {
        if (localModels.some(lm => model.toLowerCase().includes(lm))) {
          return 'ephemeral';
        }
      }
    }

    return 'persistent';
  }

  private selectModelForRole(role: SwarmAgentRole, constraints: SwarmConstraints): string {
    const affinityOrder: Record<SwarmAgentRole, string[]> = {
      planner: ['claude-3.5-sonnet', 'gpt-4o', 'deepseek-chat', 'local'],
      executor: ['deepseek-coder', 'codellama', 'gpt-4o-mini', 'local'],
      validator: ['phi3', 'qwen2.5', 'gpt-4o-mini', 'local'],
      optimizer: ['gpt-4o', 'claude-3.5-sonnet', 'deepseek-chat', 'local'],
      researcher: ['gpt-4o', 'claude-3.5-sonnet', 'perplexity-api', 'local'],
      critic: ['claude-3.5-sonnet', 'gpt-4o', 'local'],
    };

    const candidates = affinityOrder[role] || ['local'];

    for (const model of candidates) {
      if (constraints.allowedModels.includes(model)) {
        return model;
      }
    }

    if (constraints.allowedModels.length > 0) {
      return constraints.allowedModels[0];
    }

    return 'local';
  }

  private rolePriority(role: SwarmAgentRole): number {
    const priorities: Record<SwarmAgentRole, number> = {
      planner: 1,
      executor: 2,
      validator: 3,
      optimizer: 4,
      researcher: 5,
      critic: 6,
    };
    return priorities[role] || 10;
  }

  private deriveAgentConstraints(constraints: SwarmConstraints): AgentConstraints {
    return {
      maxRetries: Math.min(constraints.maxRetries, 3),
      perAgentTimeoutMs: constraints.perAgentTimeoutSeconds * 1000,
      maxTokensPerCall: constraints.sandboxExecution ? constraints.perAgentCostLimit : this.config.defaultMaxTokens,
    };
  }

  private generateAgentId(role: SwarmAgentRole): string {
    const random = Math.random().toString(36).slice(2, 6);
    return `${role}-${random}`;
  }
}

let globalSpawner: AgentSpawner | null = null;

export function initAgentSpawner(config?: SpawnerConfig): AgentSpawner {
  globalSpawner = new AgentSpawner(config);
  return globalSpawner;
}

export function getAgentSpawner(): AgentSpawner {
  if (!globalSpawner) {
    globalSpawner = new AgentSpawner();
  }
  return globalSpawner;
}

import {
  AgentRole,
  AgentDefinition,
  AgentTask,
  TaskDAG,
  MultiAgentConfig,
  DEFAULT_MULTI_AGENT_CONFIG,
  generateTaskId,
  generateDAGId,
  roleToContextKey,
} from './multi-agent-types.js';

export interface DecompositionResult {
  success: boolean;
  dag?: TaskDAG;
  error?: string;
}

export interface TaskCandidate {
  goal: string;
  role: AgentRole;
  dependsOn: string[];
}

export class TaskDecomposer {
  private config: MultiAgentConfig;
  private roleGoalKeywords: Map<AgentRole, RegExp[]>;

  constructor(config?: Partial<MultiAgentConfig>) {
    this.config = { ...DEFAULT_MULTI_AGENT_CONFIG, ...config };
    this.roleGoalKeywords = this.initializeRoleKeywords();
  }

  private initializeRoleKeywords(): Map<AgentRole, RegExp[]> {
    return new Map([
      ['architect', [/design/i, /architect/i, /schema/i, /structure/i, /plan/i]],
      ['builder', [/implement/i, /build/i, /create/i, /write/i, /code/i]],
      ['validator', [/validate/i, /check/i, /verify/i, /lint/i]],
      ['documenter', [/document/i, /readme/i, /docs/i, /comment/i]],
      ['tester', [/test/i, /spec/i, /unit/i, /integration/i]],
      ['reviewer', [/review/i, /refactor/i, /improve/i, /optimize/i]],
    ]);
  }

  async decompose(sessionId: string, rootGoal: string): Promise<DecompositionResult> {
    const candidates = this.generateTaskCandidates(rootGoal);

    if (candidates.length === 0) {
      return {
        success: false,
        error: 'Failed to decompose goal into tasks',
      };
    }

    const tasks: Record<string, AgentTask> = {};

    for (const candidate of candidates) {
      const taskId = generateTaskId();
      tasks[taskId] = {
        id: taskId,
        role: candidate.role,
        goal: candidate.goal,
        dependsOn: candidate.dependsOn,
        status: 'pending',
        outputContextKey: roleToContextKey(candidate.role),
      };
    }

    if (this.config.enableCycleDetection) {
      const cycleResult = this.detectCycles(tasks);
      if (cycleResult.hasCycle) {
        return {
          success: false,
          error: `Cycle detected in task dependencies: ${cycleResult.cyclePath?.join(' -> ')}`,
        };
      }
    }

    const dagId = generateDAGId();
    const dag: TaskDAG = {
      id: dagId,
      sessionId,
      rootGoal,
      tasks,
      status: 'ready',
      createdAt: Date.now(),
    };

    return { success: true, dag };
  }

  private generateTaskCandidates(goal: string): TaskCandidate[] {
    const normalizedGoal = goal.toLowerCase();
    const candidates: TaskCandidate[] = [];

    const hasArchitecture = /design|architect|plan|structure|schema/i.test(normalizedGoal);
    const hasImplementation = /implement|build|create|write|code/i.test(normalizedGoal);
    const hasTesting = /test|spec/i.test(normalizedGoal);
    const hasDocumentation = /document|readme|docs?/i.test(normalizedGoal);
    const hasValidation = /validate|verify|check|lint/i.test(normalizedGoal);
    const hasReview = /review|refactor|improve|optimize/i.test(normalizedGoal);

    if (hasArchitecture || hasImplementation) {
      candidates.push({
        role: 'architect',
        goal: this.extractSubGoal(goal, ['design', 'architect', 'plan', 'structure', 'schema']),
        dependsOn: [],
      });
    }

    if (hasImplementation) {
      const dependsOn = candidates.filter(c => c.role === 'architect').map(c => c.goal);
      candidates.push({
        role: 'builder',
        goal: this.extractSubGoal(goal, ['implement', 'build', 'create', 'write', 'code']),
        dependsOn: dependsOn.length > 0 ? ['_architect'] : [],
      });
    }

    if (hasTesting) {
      const architectGoal = candidates.find(c => c.role === 'architect');
      const builderGoal = candidates.find(c => c.role === 'builder');
      const dependsOn = [];
      if (architectGoal) dependsOn.push('_architect');
      if (builderGoal) dependsOn.push('_builder');
      candidates.push({
        role: 'tester',
        goal: this.extractSubGoal(goal, ['test', 'spec']),
        dependsOn: dependsOn.length > 0 ? dependsOn : [],
      });
    }

    if (hasDocumentation) {
      const builderGoal = candidates.find(c => c.role === 'builder');
      const dependsOn = builderGoal ? ['_builder'] : [];
      candidates.push({
        role: 'documenter',
        goal: this.extractSubGoal(goal, ['document', 'readme', 'docs']),
        dependsOn,
      });
    }

    if (hasValidation && !hasImplementation) {
      candidates.push({
        role: 'validator',
        goal: this.extractSubGoal(goal, ['validate', 'verify', 'check', 'lint']),
        dependsOn: [],
      });
    }

    if (hasReview) {
      const builderGoal = candidates.find(c => c.role === 'builder');
      candidates.push({
        role: 'reviewer',
        goal: this.extractSubGoal(goal, ['review', 'refactor', 'improve']),
        dependsOn: builderGoal ? ['_builder'] : [],
      });
    }

    if (candidates.length === 0) {
      candidates.push({
        role: 'builder',
        goal,
        dependsOn: [],
      });
    }

    return this.resolveDependencies(candidates);
  }

  private extractSubGoal(goal: string, keywords: string[]): string {
    const pattern = new RegExp(`(${keywords.join('|')})\\s*(.+?)(?:\\s+(?:and|then|also|,)|$)`, 'i');
    const match = goal.match(pattern);
    if (match) {
      return `${match[1]} ${match[2]}`.trim();
    }
    return goal;
  }

  private resolveDependencies(candidates: TaskCandidate[]): TaskCandidate[] {
    const resolved: TaskCandidate[] = [];

    for (const candidate of candidates) {
      const resolvedDeps: string[] = [];
      for (const dep of candidate.dependsOn) {
        if (dep === '_architect') {
          const architect = candidates.find(c => c.role === 'architect');
          if (architect) resolvedDeps.push(architect.goal);
        } else if (dep === '_builder') {
          const builder = candidates.find(c => c.role === 'builder');
          if (builder) resolvedDeps.push(builder.goal);
        }
      }
      resolved.push({
        ...candidate,
        dependsOn: resolvedDeps,
      });
    }

    return resolved;
  }

  detectCycles(tasks: Record<string, AgentTask>): { hasCycle: boolean; cyclePath?: string[] } {
    const taskList = Object.values(tasks);
    const goalToTaskId = new Map<string, string>();
    for (const task of taskList) {
      goalToTaskId.set(task.goal, task.id);
    }

    const resolvedDeps = new Map<string, string[]>();
    for (const task of taskList) {
      const deps = task.dependsOn
        .map(dep => goalToTaskId.get(dep))
        .filter((id): id is string => id !== undefined);
      resolvedDeps.set(task.id, deps);
    }

    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cyclePath: string[] = [];

    const dfs = (taskId: string): boolean => {
      visited.add(taskId);
      recursionStack.add(taskId);
      cyclePath.push(taskId);

      const deps = resolvedDeps.get(taskId) || [];
      for (const dep of deps) {
        if (!visited.has(dep)) {
          if (dfs(dep)) return true;
        } else if (recursionStack.has(dep)) {
          cyclePath.push(dep);
          return true;
        }
      }

      recursionStack.delete(taskId);
      cyclePath.pop();
      return false;
    };

    for (const task of taskList) {
      if (!visited.has(task.id)) {
        if (dfs(task.id)) {
          const cycleStart = cyclePath[cyclePath.length - 1];
          const cycleStartIndex = cyclePath.indexOf(cycleStart);
          return { hasCycle: true, cyclePath: cyclePath.slice(cycleStartIndex) };
        }
      }
    }

    return { hasCycle: false };
  }

  topologicalSort(tasks: Record<string, AgentTask>): string[] {
    const taskList = Object.values(tasks);
    const goalToTaskId = new Map<string, string>();
    for (const task of taskList) {
      goalToTaskId.set(task.goal, task.id);
    }

    const resolvedDeps = new Map<string, string[]>();
    for (const task of taskList) {
      const deps = task.dependsOn
        .map(dep => goalToTaskId.get(dep))
        .filter((id): id is string => id !== undefined);
      resolvedDeps.set(task.id, deps);
    }

    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();

    for (const task of taskList) {
      inDegree.set(task.id, 0);
      adjList.set(task.id, []);
    }

    for (const [taskId, deps] of resolvedDeps) {
      inDegree.set(taskId, deps.length);
      for (const dep of deps) {
        const existing = adjList.get(dep) || [];
        existing.push(taskId);
        adjList.set(dep, existing);
      }
    }

    const queue: string[] = [];
    for (const [taskId, degree] of inDegree) {
      if (degree === 0) queue.push(taskId);
    }

    const sorted: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(current);

      const neighbors = adjList.get(current) || [];
      for (const neighbor of neighbors) {
        const newDegree = inDegree.get(neighbor)! - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    return sorted;
  }

  getReadyTasks(tasks: Record<string, AgentTask>): AgentTask[] {
    const ready: AgentTask[] = [];
    for (const task of Object.values(tasks)) {
      if (task.status !== 'pending') continue;
      const depsMet = task.dependsOn.every(depGoal => {
        const depTask = Object.values(tasks).find(t => t.goal === depGoal);
        return depTask?.status === 'done';
      });
      if (depsMet) ready.push(task);
    }
    return ready;
  }

  getAgentDefinition(role: AgentRole): AgentDefinition | undefined {
    return this.config.agentDefinitions.find(d => d.role === role);
  }

  inferRoleFromGoal(goal: string): AgentRole {
    const normalized = goal.toLowerCase();

    for (const [role, patterns] of this.roleGoalKeywords) {
      for (const pattern of patterns) {
        if (pattern.test(normalized)) {
          return role;
        }
      }
    }

    return 'builder';
  }
}

let globalDecomposer: TaskDecomposer | null = null;

export function initTaskDecomposer(config?: Partial<MultiAgentConfig>): TaskDecomposer {
  if (globalDecomposer) return globalDecomposer;
  globalDecomposer = new TaskDecomposer(config);
  return globalDecomposer;
}

export function getTaskDecomposer(): TaskDecomposer {
  return globalDecomposer || initTaskDecomposer();
}

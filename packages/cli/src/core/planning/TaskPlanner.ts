import type { AgentCapabilities, ExecutionStrategy, AgentMode } from '../agents/types.js';
import type { RegisteredAgent } from '../agents/types.js';

export interface Subtask {
  id: string;
  title: string;
  description: string;
  requiredCapabilities: string[];
  suggestedRole:
    | 'planner'
    | 'researcher'
    | 'coder'
    | 'reviewer'
    | 'tester'
    | 'security'
    | 'debugger';
  dependencies: string[];
  canRunInParallel: boolean;
  modeRequired: 'communication' | 'execution';
}

export interface TaskPlan {
  summary: string;
  subtasks: Subtask[];
}

const ROLE_CAPABILITY_MAP: Record<string, string[]> = {
  planner: ['longContext'],
  researcher: ['webResearch', 'longContext'],
  coder: ['codeGeneration', 'fileEditing', 'commandExecution'],
  reviewer: ['codeGeneration', 'longContext'],
  tester: ['commandExecution', 'codeGeneration'],
  security: ['longContext', 'webResearch'],
  debugger: ['codeGeneration', 'commandExecution'],
};

const ROLE_MODE_MAP: Record<string, AgentMode> = {
  planner: 'communication',
  researcher: 'communication',
  coder: 'execution',
  reviewer: 'communication',
  tester: 'execution',
  security: 'communication',
  debugger: 'execution',
};

function detectRoles(goal: string): Array<{ role: string; priority: number }> {
  const lower = goal.toLowerCase();
  const roles: Array<{ role: string; priority: number }> = [];

  if (/\b(design|architect|plan|architecture|structure)\b/i.test(lower)) {
    roles.push({ role: 'planner', priority: 1 });
  }
  if (/\b(research|find|search|analyze|explain|compare|investigate|what is|how does)\b/i.test(lower)) {
    roles.push({ role: 'researcher', priority: 2 });
  }
  if (/\b(build|create|implement|write|code|program|develop|add|make|generate|construct)\b/i.test(lower)) {
    roles.push({ role: 'coder', priority: 1 });
  }
  if (/\b(review|audit|check|inspect|verify)\b/i.test(lower)) {
    roles.push({ role: 'reviewer', priority: 3 });
  }
  if (/\b(test|spec|coverage|assert|jest|vitest|pytest|unit.test|integration.test)\b/i.test(lower)) {
    roles.push({ role: 'tester', priority: 2 });
  }
  if (/\b(security|auth|permission|safe|vulnerability|exploit|encrypt|password|token)\b/i.test(lower)) {
    roles.push({ role: 'security', priority: 2 });
  }
  if (/\b(debug|fix|bug|error|issue|problem|crash|broken|fail)\b/i.test(lower)) {
    roles.push({ role: 'debugger', priority: 1 });
  }

  return roles;
}

function generateSubtaskId(index: number): string {
  return `subtask_${String(index + 1).padStart(2, '0')}`;
}

export function planTask(goal: string, availableAgents?: RegisteredAgent[]): TaskPlan {
  const detectedRoles = detectRoles(goal);
  const uniqueRoles = new Map<string, number>();

  for (const r of detectedRoles) {
    if (!uniqueRoles.has(r.role) || uniqueRoles.get(r.role)! > r.priority) {
      uniqueRoles.set(r.role, r.priority);
    }
  }

  if (uniqueRoles.size === 0) {
    uniqueRoles.set('coder', 1);
    uniqueRoles.set('planner', 3);
  }

  const sortedRoles = Array.from(uniqueRoles.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([role]) => role);

  const subtasks: Subtask[] = [];
  let parallelGroup = 0;

  for (let i = 0; i < sortedRoles.length; i++) {
    const role = sortedRoles[i];
    const isFirst = i === 0;
    const canParallel = !isFirst && sortedRoles.slice(0, i).every(r => {
      const deps = role === 'tester' || role === 'reviewer' || role === 'security';
      return !deps;
    });

    const depIds = isFirst ? [] : [generateSubtaskId(i - 1)];

    const roleNames: Record<string, string> = {
      planner: 'Plan architecture',
      researcher: 'Research requirements',
      coder: 'Implement code',
      reviewer: 'Review implementation',
      tester: 'Write tests',
      security: 'Security audit',
      debugger: 'Debug and fix',
    };

    const roleDescs: Record<string, string> = {
      planner: `Design the architecture and plan for: ${goal}`,
      researcher: `Research and gather information needed for: ${goal}`,
      coder: `Implement the code for: ${goal}`,
      reviewer: `Review the implementation of: ${goal}`,
      tester: `Write tests for the implementation of: ${goal}`,
      security: `Audit security for the implementation of: ${goal}`,
      debugger: `Debug and fix issues in: ${goal}`,
    };

    if (canParallel) {
      subtasks.push({
        id: generateSubtaskId(i),
        title: roleNames[role] || role,
        description: roleDescs[role] || goal,
        requiredCapabilities: ROLE_CAPABILITY_MAP[role] || ['codeGeneration'],
        suggestedRole: role as Subtask['suggestedRole'],
        dependencies: depIds,
        canRunInParallel: true,
        modeRequired: ROLE_MODE_MAP[role] || 'execution',
      });
    } else {
      subtasks.push({
        id: generateSubtaskId(i),
        title: roleNames[role] || role,
        description: roleDescs[role] || goal,
        requiredCapabilities: ROLE_CAPABILITY_MAP[role] || ['codeGeneration'],
        suggestedRole: role as Subtask['suggestedRole'],
        dependencies: [],
        canRunInParallel: false,
        modeRequired: ROLE_MODE_MAP[role] || 'execution',
      });
    }
  }

  return {
    summary: `Plan for: ${goal}`,
    subtasks,
  };
}

export function suggestExecutionStrategy(plan: TaskPlan, availableCount: number): ExecutionStrategy {
  if (availableCount <= 1) return 'single';
  if (plan.subtasks.length <= 1) return 'single';

  if (plan.subtasks.length >= 2) return 'single-fallback';
  return 'single';
}

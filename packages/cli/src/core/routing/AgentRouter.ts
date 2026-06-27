import type { RegisteredAgent, AgentCapabilities, AgentMode, ExecutionStrategy } from '../agents/types.js';
import type { TaskPlan, Subtask } from '../planning/TaskPlanner.js';

export interface Assignment {
  subtaskId: string;
  agentId: string;
  role: string;
}

export type FallbackReason =
  | 'timeout'
  | 'quota'
  | 'rate-limit'
  | 'auth-failed'
  | 'token-limit'
  | 'context-overflow'
  | 'invalid-output'
  | 'validation-failed'
  | 'agent-crashed'
  | 'provider-unavailable'
  | 'user-requested';

export interface RoutingDecision {
  strategy: 'single' | 'single-fallback' | 'fallback' | 'swarm' | 'manual';
  selectedAgents: string[];
  fallbackChain: string[];
  assignments: Assignment[];
  reason: string;
}

export interface RouterInput {
  plan: TaskPlan;
  availableAgents: RegisteredAgent[];
  mode: AgentMode;
  strategy?: ExecutionStrategy;
  preferredAgent?: string;
  recentFailures?: Record<string, string[]>;
}

const ROLE_AGENT_PREFERENCE: Record<string, string[]> = {
  researcher: ['opencode', 'claude-code', 'gemini-cli'],
  planner: ['opencode', 'claude-code', 'gemini-cli'],
  coder: ['opencode', 'claude-code', 'aider', 'goose', 'codex-cli'],
  reviewer: ['opencode', 'claude-code', 'gemini-cli'],
  tester: ['opencode', 'claude-code', 'aider'],
  security: ['opencode', 'claude-code', 'gemini-cli'],
  debugger: ['opencode', 'claude-code', 'aider'],
};

function hasCapability(agent: RegisteredAgent, capability: string): boolean {
  const caps = agent.capabilities as unknown as Record<string, boolean>;
  return caps[capability] === true;
}

function selectAgentsForSubtask(
  subtask: Subtask,
  available: RegisteredAgent[],
  recentFailures: Record<string, string[]>,
  preferredAgent?: string
): { primary: string | null; fallbacks: string[] } {
  const role = subtask.suggestedRole;
  const preferred = ROLE_AGENT_PREFERENCE[role] || ROLE_AGENT_PREFERENCE.coder;

  const sorted = [...available].sort((a, b) => a.priority - b.priority);

  const failureMap = new Map<string, number>();
  for (const [agentId, failures] of Object.entries(recentFailures)) {
    failureMap.set(agentId, failures.length);
  }

  const scored = sorted.map(agent => {
    let score = 0;

    if (subtask.modeRequired === 'communication' && !agent.supportedModes.includes('communication')) {
      score -= 100;
    }
    if (subtask.modeRequired === 'execution' && !agent.supportedModes.includes('execution')) {
      score -= 100;
    }

    for (const cap of subtask.requiredCapabilities) {
      if (hasCapability(agent, cap)) score += 10;
    }

    const prefIndex = preferred.indexOf(agent.id);
    if (prefIndex >= 0) score += (10 - prefIndex);

    if (agent.id === preferredAgent) score += 20;

    const failures = failureMap.get(agent.id) || 0;
    score -= failures * 15;

    return { agent, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const valid = scored.filter(s => s.score > -50);
  if (valid.length === 0) return { primary: null, fallbacks: [] };

  const primary = valid[0].agent.id;
  const fallbacks = valid.slice(1).map(s => s.agent.id);

  return { primary, fallbacks };
}

export function routeTask(input: RouterInput): RoutingDecision {
  const { plan, availableAgents, mode, strategy, preferredAgent, recentFailures = {} } = input;

  if (availableAgents.length === 0) {
    return {
      strategy: 'single',
      selectedAgents: [],
      fallbackChain: [],
      assignments: [],
      reason: 'No available agents',
    };
  }

  if (plan.subtasks.length === 0) {
    return {
      strategy: 'single',
      selectedAgents: [availableAgents[0].id],
      fallbackChain: availableAgents.slice(1).map(a => a.id),
      assignments: [],
      reason: 'No subtasks, using default agent',
    };
  }

  const assignments: Assignment[] = [];
  const selectedSet = new Set<string>();
  const fallbackSet = new Set<string>();

  for (const subtask of plan.subtasks) {
    const { primary, fallbacks } = selectAgentsForSubtask(
      subtask,
      availableAgents,
      recentFailures,
      preferredAgent
    );

    if (primary) {
      selectedSet.add(primary);
      assignments.push({ subtaskId: subtask.id, agentId: primary, role: subtask.suggestedRole });
    }

    for (const fb of fallbacks) {
      fallbackSet.add(fb);
    }
  }

  const resolvedStrategy: RoutingDecision['strategy'] =
    strategy === 'swarm'
      ? 'swarm'
      : strategy === 'single-fallback' || strategy === 'fallback'
        ? strategy
        : strategy === 'single' || plan.subtasks.length <= 1
          ? 'single'
          : 'single-fallback';

  return {
    strategy: resolvedStrategy,
    selectedAgents: Array.from(selectedSet),
    fallbackChain: Array.from(fallbackSet).filter(a => !selectedSet.has(a)),
    assignments,
    reason: `Routed ${plan.subtasks.length} subtask(s) across ${selectedSet.size} agent(s) with ${fallbackSet.size} fallback(s)`,
  };
}

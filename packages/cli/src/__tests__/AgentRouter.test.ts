import { describe, it, expect } from 'vitest';
import { routeTask } from '../core/routing/AgentRouter.js';
import type { RegisteredAgent } from '../core/agents/types.js';
import type { TaskPlan } from '../core/planning/TaskPlanner.js';

const mockAgent = (id: string, priority: number, modes: string[] = ['execution']): RegisteredAgent => ({
  id,
  name: id,
  kind: 'cli',
  provider: 'test',
  status: 'available',
  priority,
  version: '1.0',
  capabilities: { codeGeneration: true, fileEditing: true, commandExecution: true, webResearch: false, longContext: true, local: true, cloud: false, multimodal: false },
  supportedModes: modes as any,
  error: undefined,
});

const simplePlan: TaskPlan = {
  summary: 'Test task',
  subtasks: [
    { id: 's1', title: 'Write code', description: '', requiredCapabilities: ['codeGeneration'], suggestedRole: 'coder', dependencies: [], canRunInParallel: false, modeRequired: 'execution' },
  ],
};

describe('AgentRouter', () => {
  it('returns no agents when none available', () => {
    const result = routeTask({ plan: simplePlan, availableAgents: [], mode: 'execution' });
    expect(result.selectedAgents).toHaveLength(0);
    expect(result.reason).toContain('No available agents');
  });

  it('selects the highest-priority agent for single subtask', () => {
    const agents = [
      mockAgent('agent-b', 5),
      mockAgent('agent-a', 1),
    ];
    const result = routeTask({ plan: simplePlan, availableAgents: agents, mode: 'execution' });
    expect(result.selectedAgents).toContain('agent-a');
    expect(result.fallbackChain).toContain('agent-b');
  });

  it('uses preferred agent when available', () => {
    const agents = [
      mockAgent('agent-a', 1),
      mockAgent('agent-b', 5),
    ];
    const result = routeTask({ plan: simplePlan, availableAgents: agents, mode: 'execution', preferredAgent: 'agent-b' });
    expect(result.selectedAgents).toContain('agent-b');
  });

  it('defaults to single-fallback strategy', () => {
    const agents = [mockAgent('agent-a', 1), mockAgent('agent-b', 2)];
    const result = routeTask({ plan: simplePlan, availableAgents: agents, mode: 'execution' });
    expect(result.strategy).toBe('single');
  });

  it('uses swarm strategy when explicitly requested', () => {
    const plan: TaskPlan = {
      summary: 'Parallel task',
      subtasks: [
        { id: 's1', title: 'Task 1', description: '', requiredCapabilities: ['codeGeneration'], suggestedRole: 'coder', dependencies: [], canRunInParallel: true, modeRequired: 'execution' },
        { id: 's2', title: 'Task 2', description: '', requiredCapabilities: ['codeGeneration'], suggestedRole: 'coder', dependencies: [], canRunInParallel: true, modeRequired: 'execution' },
      ],
    };
    const agents = [mockAgent('agent-a', 1), mockAgent('agent-b', 2)];
    const result = routeTask({ plan, availableAgents: agents, mode: 'execution', strategy: 'swarm' });
    expect(result.strategy).toBe('swarm');
  });

  it('uses single-fallback when explicitly requested', () => {
    const plan: TaskPlan = {
      summary: 'Multi-subtask',
      subtasks: [
        { id: 's1', title: 'Task 1', description: '', requiredCapabilities: ['codeGeneration'], suggestedRole: 'coder', dependencies: [], canRunInParallel: false, modeRequired: 'execution' },
        { id: 's2', title: 'Task 2', description: '', requiredCapabilities: ['codeGeneration'], suggestedRole: 'coder', dependencies: [], canRunInParallel: false, modeRequired: 'execution' },
      ],
    };
    const agents = [mockAgent('agent-a', 1), mockAgent('agent-b', 2)];
    const result = routeTask({ plan, availableAgents: agents, mode: 'execution', strategy: 'single-fallback' });
    expect(result.strategy).toBe('single-fallback');
  });

  it('penalizes agents with recent failures', () => {
    const agents = [
      mockAgent('agent-a', 1),
      mockAgent('agent-b', 2),
    ];
    const failures = { 'agent-a': ['timeout', 'quota'] };
    const result = routeTask({ plan: simplePlan, availableAgents: agents, mode: 'execution', recentFailures: failures });
    expect(result.selectedAgents).toContain('agent-b');
  });

  it('assigns all subtasks', () => {
    const plan: TaskPlan = {
      summary: 'Multi-subtask',
      subtasks: [
        { id: 's1', title: 'Code', description: '', requiredCapabilities: ['codeGeneration'], suggestedRole: 'coder', dependencies: [], canRunInParallel: false, modeRequired: 'execution' },
        { id: 's2', title: 'Test', description: '', requiredCapabilities: ['commandExecution'], suggestedRole: 'tester', dependencies: ['s1'], canRunInParallel: false, modeRequired: 'execution' },
      ],
    };
    const agents = [mockAgent('agent-a', 1)];
    const result = routeTask({ plan, availableAgents: agents, mode: 'execution' });
    expect(result.assignments).toHaveLength(2);
    expect(result.assignments[0].subtaskId).toBe('s1');
    expect(result.assignments[1].subtaskId).toBe('s2');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { SwarmOrchestrator } from '../multi-agent/orchestrator/SwarmOrchestrator.js';
import { TaskPlanner } from '../multi-agent/orchestrator/TaskPlanner.js';

vi.mock('../core/agents/AgentRegistry.js', () => {
  const createMockRegistry = () => ({
    detect: vi.fn().mockResolvedValue(undefined),
    getAvailableAgents: vi.fn().mockReturnValue([]),
    getBestAgent: vi.fn().mockReturnValue(null),
    getAgentInfoMap: vi.fn().mockReturnValue(new Map()),
    getAgent: vi.fn().mockReturnValue(null),
  });

  return {
    AgentRegistry: {
      create: vi.fn(createMockRegistry),
    },
  };
});

describe('TaskPlanner', () => {
  const planner = new TaskPlanner();

  it('should classify code tasks', async () => {
    const plan = await planner.analyze('Build a REST API with Express');
    expect(plan.type).toBe('code');
    expect(plan.requiresCodeGeneration).toBe(true);
  });

  it('should classify research tasks', async () => {
    const plan = await planner.analyze('Research and explain quantum computing concepts');
    expect(plan.type).toBe('research');
    expect(plan.requiresResearch).toBe(true);
  });

  it('should classify debug tasks', async () => {
    const plan = await planner.analyze('Fix the bug in the login function');
    expect(plan.type).toBe('debug');
  });

  it('should classify refactor tasks', async () => {
    const plan = await planner.analyze('Refactor the authentication module');
    expect(plan.type).toBe('refactor');
  });

  it('should determine complexity from task length', async () => {
    const shortPlan = await planner.analyze('Fix bug');
    expect(shortPlan.complexity).toBe('low');

    const longPlan = await planner.analyze('a'.repeat(301));
    expect(longPlan.complexity).toBe('high');
  });
});

describe('SwarmOrchestrator', () => {
  const baseConfig = {
    goal: 'Test task',
    projectId: 'test-project',
    strategy: 'single' as const,
    mode: 'execution' as const,
    workingDir: process.cwd(),
  };

  it('should create with correct config', () => {
    const o = new SwarmOrchestrator({
      ...baseConfig,
      strategy: 'swarm',
    });
    expect(o).toBeInstanceOf(SwarmOrchestrator);
  });

  it('should analyze task via TaskPlanner', async () => {
    const o = new SwarmOrchestrator(baseConfig);
    const analysis = await o.analyzeTask('Build a REST API');
    expect(analysis.type).toBe('code');
  });

  it('should fail with no available agents', async () => {
    const o = new SwarmOrchestrator(baseConfig);
    const result = await o.execute('Build something');
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should not fail on terminate', async () => {
    const o = new SwarmOrchestrator(baseConfig);
    await expect(o.terminate()).resolves.not.toThrow();
  });

  it('should not fail on stop', async () => {
    const o = new SwarmOrchestrator(baseConfig);
    await expect(o.stop()).resolves.not.toThrow();
  });
});

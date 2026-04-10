import { describe, it, expect, beforeEach } from 'vitest';
import { AgentSpawner } from '../../src/swarm/AgentSpawner.js';
import { ModelAllocator } from '../../src/swarm/ModelAllocator.js';
import { StrategyEngine } from '../../src/swarm/StrategyEngine.js';
import { ExecutionLoop } from '../../src/swarm/ExecutionLoop.js';
import { SelfHealer } from '../../src/swarm/SelfHealer.js';
import { SwarmMemory } from '../../src/swarm/SwarmMemory.js';
import { ControlManager } from '../../src/control/ControlManager.js';
import { ConstraintEnforcer } from '../../src/control/ConstraintEnforcer.js';
import { CostTracker } from '../../src/control/CostTracker.js';
import type {
  Task,
  SwarmConstraints,
  SpawnedAgent,
  Subtask,
  TaskPlan,
} from '../../src/swarm/types.js';

const DEFAULT_CONSTRAINTS: SwarmConstraints = {
  maxAgents: 5,
  maxCostUSD: 10,
  maxTicks: 100,
  maxParallelInferences: 3,
  maxRetries: 3,
  allowedModels: ['gpt-4o', 'claude-3.5-sonnet', 'deepseek-coder', 'local'],
  forbiddenModels: [],
  preferLocalModels: false,
  requireValidation: true,
  requirePlanApproval: true,
  maxAutonomousDecisions: 10,
  noFileSystemWrites: false,
  noNetworkCalls: false,
  sandboxExecution: false,
  maxWallClockSeconds: 300,
  perAgentTimeoutSeconds: 60,
  perAgentCostLimit: 1,
};

function createTestTask(overrides?: Partial<Task>): Task {
  return {
    id: `task-${Math.random().toString(36).slice(2, 6)}`,
    description: 'Test task description',
    ...overrides,
  };
}

function createTestAgent(overrides?: Partial<SpawnedAgent>): SpawnedAgent {
  return {
    id: `agent-${Math.random().toString(36).slice(2, 6)}`,
    role: 'executor',
    assignedModel: 'gpt-4o',
    priority: 1,
    lifecycle: 'persistent',
    parentTask: 'test-task',
    constraints: {
      maxRetries: 3,
      perAgentTimeoutMs: 60000,
      maxTokensPerCall: 8000,
    },
    status: 'idle',
    costSoFar: 0,
    tokensIn: 0,
    tokensOut: 0,
    lastHeartbeat: Date.now(),
    failureCount: 0,
    ...overrides,
  };
}

function createTestSubtask(overrides?: Partial<Subtask>): Subtask {
  return {
    id: `subtask-${Math.random().toString(36).slice(2, 6)}`,
    description: 'Test subtask',
    status: 'unclaimed',
    parentTaskId: 'test-task',
    priority: 1,
    attempts: 0,
    ...overrides,
  };
}

// @ts-expect-error - Function defined for potential future use
function _createTestTaskPlan(): TaskPlan {
  return {
    taskId: 'test-task',
    subtasks: [
      createTestSubtask({ id: 'st-1' }),
      createTestSubtask({ id: 'st-2' }),
    ],
    createdAt: Date.now(),
    createdBy: 'test',
  };
}

describe('AgentSpawner', () => {
  let spawner: AgentSpawner;

  beforeEach(() => {
    spawner = new AgentSpawner();
  });

  describe('analyzeTask', () => {
    it('should identify low complexity tasks', () => {
      const task = createTestTask({ description: 'Simple task' });
      const analysis = spawner.analyzeTask(task);

      expect(analysis.complexity).toBe('low');
      expect(analysis.estimatedSteps).toBeGreaterThan(0);
    });

    it('should identify high complexity tasks with long descriptions', () => {
      const task = createTestTask({
        description: 'A'.repeat(10000),
      });
      const analysis = spawner.analyzeTask(task);

      expect(['high', 'critical']).toContain(analysis.complexity);
    });

    it('should detect coding domains', () => {
      const task = createTestTask({
        description: 'Implement a function to process data',
      });
      const analysis = spawner.analyzeTask(task);

      expect(analysis.domains).toContain('coding');
    });

    it('should detect research domains', () => {
      const task = createTestTask({
        description: 'Research the latest findings on AI',
      });
      const analysis = spawner.analyzeTask(task);

      expect(analysis.domains).toContain('research');
    });

    it('should mark decomposable tasks correctly', () => {
      const decomposable = spawner.analyzeTask(
        createTestTask({ description: 'Split this into parallel tasks' })
      );
      const nonDecomposable = spawner.analyzeTask(
        createTestTask({ description: 'Just do this one thing' })
      );

      expect(decomposable.decomposable).toBe(true);
      expect(nonDecomposable.decomposable).toBe(false);
    });

    it('should detect ambiguity levels', () => {
      const clear = spawner.analyzeTask(
        createTestTask({ description: 'Implement the function' })
      );
      const ambiguous = spawner.analyzeTask(
        createTestTask({ description: 'Maybe implement this perhaps' })
      );

      expect(clear.ambiguityLevel).toBe('clear');
      expect(['high', 'moderate']).toContain(ambiguous.ambiguityLevel);
    });
  });

  describe('spawnAgents', () => {
    it('should spawn minimum required agents', () => {
      const task = createTestTask({ id: 'test-1' });
      const agents = spawner.spawnAgents(task, DEFAULT_CONSTRAINTS);

      expect(agents.length).toBeGreaterThanOrEqual(2);
    });

    it('should always include executor and validator roles', () => {
      const task = createTestTask({ id: 'test-2' });
      const agents = spawner.spawnAgents(task, DEFAULT_CONSTRAINTS);
      const roles = agents.map((a) => a.role);

      expect(roles).toContain('executor');
      expect(roles).toContain('validator');
    });

    it('should respect maxAgents constraint', () => {
      const constraints = { ...DEFAULT_CONSTRAINTS, maxAgents: 10 };
      const task = createTestTask({ id: 'test-3' });
      const agents = spawner.spawnAgents(task, constraints);

      expect(agents.length).toBeLessThanOrEqual(constraints.maxAgents);
    });

    it('should assign valid models to agents', () => {
      const task = createTestTask({ id: 'test-4' });
      const agents = spawner.spawnAgents(task, DEFAULT_CONSTRAINTS);

      for (const agent of agents) {
        expect(DEFAULT_CONSTRAINTS.allowedModels).toContain(agent.assignedModel);
      }
    });
  });

  describe('spawnSingle', () => {
    it('should spawn a single agent with specified role', () => {
      const agent = spawner.spawnSingle('planner', 'test-task', DEFAULT_CONSTRAINTS);

      expect(agent.role).toBe('planner');
      expect(agent.id).toBeTruthy();
    });
  });
});

describe('ModelAllocator', () => {
  let allocator: ModelAllocator;

  beforeEach(() => {
    allocator = new ModelAllocator(DEFAULT_CONSTRAINTS);
  });

  describe('allocate', () => {
    it('should allocate models to all agents', () => {
      const agents = [
        createTestAgent({ id: 'a1', role: 'planner' }),
        createTestAgent({ id: 'a2', role: 'executor' }),
      ];
      const taskAnalysis = {
        complexity: 'medium' as const,
        domains: ['coding'] as ('coding' | 'reasoning' | 'planning' | 'research' | 'review' | 'data-analysis')[],
        decomposable: true,
        estimatedSteps: 5,
        requiresIteration: false,
        ambiguityLevel: 'clear' as const,
      };

      const allocations = allocator.allocate(agents, taskAnalysis);

      expect(allocations).toHaveLength(2);
      for (const allocation of allocations) {
        expect(allocation.model).toBeTruthy();
        expect(allocation.fallbackChain).toBeTruthy();
      }
    });

    it('should prefer local models when allowed', () => {
      const constraints = { ...DEFAULT_CONSTRAINTS, preferLocalModels: true };
      const localAllocator = new ModelAllocator(constraints);
      const agents = [createTestAgent({ id: 'a1', role: 'executor' })];
      const taskAnalysis = {
        complexity: 'low' as const,
        domains: [] as ('coding' | 'reasoning' | 'planning' | 'research' | 'review' | 'data-analysis')[],
        decomposable: false,
        estimatedSteps: 1,
        requiresIteration: false,
        ambiguityLevel: 'clear' as const,
      };

      const allocations = localAllocator.allocate(agents, taskAnalysis);

      expect(allocations[0].model).toBeTruthy();
    });
  });

  describe('recordPerformance', () => {
    it('should track model performance', () => {
      allocator.recordPerformance('gpt-4o', 'executor', true, 1000, 0.01);

      const history = allocator.getPerformanceHistory();
      expect(history.size).toBeGreaterThan(0);
    });
  });
});

describe('StrategyEngine', () => {
  let engine: StrategyEngine;

  beforeEach(() => {
    engine = new StrategyEngine('adaptive');
  });

  describe('selectStrategy', () => {
    it('should select a strategy based on task analysis', () => {
      const taskAnalysis = {
        complexity: 'high' as const,
        domains: ['coding', 'reasoning'] as ('coding' | 'reasoning' | 'planning' | 'research' | 'review' | 'data-analysis')[],
        decomposable: true,
        estimatedSteps: 10,
        requiresIteration: true,
        ambiguityLevel: 'high' as const,
      };

      const decision = engine.selectStrategy(taskAnalysis, DEFAULT_CONSTRAINTS);

      expect(decision.chosen).toBeTruthy();
      expect(decision.reasoning).toBeTruthy();
      expect(decision.fallbackStrategy).toBeTruthy();
    });

    it('should prefer sequential for simple tasks', () => {
      const taskAnalysis = {
        complexity: 'low' as const,
        domains: [] as ('coding' | 'reasoning' | 'planning' | 'research' | 'review' | 'data-analysis')[],
        decomposable: false,
        estimatedSteps: 1,
        requiresIteration: false,
        ambiguityLevel: 'clear' as const,
      };

      const decision = engine.selectStrategy(taskAnalysis, DEFAULT_CONSTRAINTS);

      expect(['sequential', 'adaptive']).toContain(decision.chosen);
    });

    it('should prefer pipeline for decomposable tasks', () => {
      const taskAnalysis = {
        complexity: 'medium' as const,
        domains: ['coding', 'review'] as ('coding' | 'reasoning' | 'planning' | 'research' | 'review' | 'data-analysis')[],
        decomposable: true,
        estimatedSteps: 5,
        requiresIteration: false,
        ambiguityLevel: 'clear' as const,
      };

      const decision = engine.selectStrategy(taskAnalysis, DEFAULT_CONSTRAINTS);

      expect(['pipeline', 'parallel', 'adaptive']).toContain(decision.chosen);
    });

    it('should track strategy history', () => {
      const taskAnalysis = {
        complexity: 'medium' as const,
        domains: [] as ('coding' | 'reasoning' | 'planning' | 'research' | 'review' | 'data-analysis')[],
        decomposable: true,
        estimatedSteps: 5,
        requiresIteration: false,
        ambiguityLevel: 'moderate' as const,
      };

      engine.selectStrategy(taskAnalysis, DEFAULT_CONSTRAINTS);

      expect(engine.getStrategyHistory()).toHaveLength(1);
    });
  });

  describe('strategy configuration', () => {
    it('should get and set current strategy', () => {
      expect(engine.getCurrentStrategy()).toBe('adaptive');

      engine.setStrategy('parallel');
      expect(engine.getCurrentStrategy()).toBe('parallel');
    });
  });
});

describe('SelfHealer', () => {
  let healer: SelfHealer;

  beforeEach(() => {
    healer = new SelfHealer(DEFAULT_CONSTRAINTS);
  });

  describe('handleFailure', () => {
    it('should create retry strategy for timeout failures', () => {
      const strategy = healer.handleFailure('agent-1', 'timeout', 'Request timeout');
      expect(strategy).not.toBeNull();
      if (strategy) {
        expect(strategy.action).toBeTruthy();
        expect(strategy.attempt).toBe(1);
        expect(strategy.reason).toBeTruthy();
      }
    });

    it('should escalate after threshold failures', () => {
      for (let i = 0; i < 5; i++) {
        healer.handleFailure('agent-1', 'error', 'Error occurred');
      }

      const strategy = healer.handleFailure('agent-1', 'error', 'Error occurred');
      expect(strategy).not.toBeNull();
      if (strategy) {
        expect(strategy.action).toBe('escalate-to-operator');
      }
    });
  });

  describe('executeHealingAction', () => {
    it('should execute retry action', () => {
      const agent = createTestAgent();
      const strategy = { attempt: 1, action: 'retry-same' as const, reason: 'Test' };

      const result = healer.executeHealingAction(strategy, agent);

      expect(result.shouldRetry).toBe(true);
      expect(result.shouldTerminate).toBe(false);
    });

    it('should execute replace agent action', () => {
      const agent = createTestAgent({ id: 'old-agent' });
      const strategy = { attempt: 3, action: 'replace-agent' as const, reason: 'Max retries' };

      const result = healer.executeHealingAction(strategy, agent);

      expect(result.shouldRetry).toBe(true);
      expect(result.shouldTerminate).toBe(true);
      expect(result.newAgent).toBeTruthy();
      expect(result.newAgent!.id).not.toBe('old-agent');
    });

    it('should skip subtask when appropriate', () => {
      const agent = createTestAgent();
      const strategy = { attempt: 1, action: 'skip-subtask' as const, reason: 'Cost exceeded' };

      const result = healer.executeHealingAction(strategy, agent);

      expect(result.shouldRetry).toBe(false);
      expect(result.shouldTerminate).toBe(true);
    });
  });

  describe('swarm health', () => {
    it('should report overall health', () => {
      const health = healer.getSwarmHealth();

      expect(health.overallHealth).toBe(1);
      expect(health.recoveryRate).toBe(1);
    });

    it('should track agent health', () => {
      expect(healer.isAgentHealthy('agent-1')).toBe(true);

      for (let i = 0; i < 4; i++) {
        healer.handleFailure('agent-1', 'error', 'Error');
      }

      expect(healer.isAgentHealthy('agent-1')).toBe(false);
    });
  });
});

describe('SwarmMemory', () => {
  let memory: SwarmMemory;

  beforeEach(() => {
    memory = new SwarmMemory(100, 5);
  });

  describe('agent storage', () => {
    it('should store and retrieve agents', () => {
      const agent = createTestAgent({ id: 'stored-agent' });
      memory.storeAgent(agent);

      expect(memory.getAgent('stored-agent')).toEqual(agent);
      expect(memory.getAllAgents()).toHaveLength(1);
    });

    it('should remove agents', () => {
      const agent = createTestAgent({ id: 'to-remove' });
      memory.storeAgent(agent);
      memory.removeAgent('to-remove');

      expect(memory.getAgent('to-remove')).toBeUndefined();
    });
  });

  describe('subtask storage', () => {
    it('should store and retrieve subtasks', () => {
      const subtask = createTestSubtask({ id: 'stored-subtask' });
      memory.storeSubtask(subtask);

      expect(memory.getSubtask('stored-subtask')).toEqual(subtask);
    });

    it('should filter subtasks by parent task', () => {
      memory.storeSubtask(createTestSubtask({ id: 'st-1', parentTaskId: 'task-1' }));
      memory.storeSubtask(createTestSubtask({ id: 'st-2', parentTaskId: 'task-2' }));

      expect(memory.getSubtasksByTask('task-1')).toHaveLength(1);
    });
  });

  describe('decision storage', () => {
    it('should store and resolve decisions', () => {
      const decision = {
        id: 'dec-1',
        type: 'strategy' as const,
        description: 'Use parallel strategy',
        reasoning: 'Task is decomposable',
        timestamp: Date.now(),
        source: 'system',
        binding: false,
        resolved: false,
      };

      memory.storeDecision(decision);
      memory.resolveDecision('dec-1', true);

      const resolved = memory.getDecision('dec-1');
      expect(resolved?.resolved).toBe(true);
      expect(resolved?.binding).toBe(true);
    });

    it('should filter unresolved decisions', () => {
      memory.storeDecision({
        id: 'dec-1',
        type: 'strategy',
        description: 'Decision 1',
        reasoning: 'Reason',
        timestamp: Date.now(),
        source: 'system',
        binding: false,
        resolved: false,
      });
      memory.storeDecision({
        id: 'dec-2',
        type: 'strategy',
        description: 'Decision 2',
        reasoning: 'Reason',
        timestamp: Date.now(),
        source: 'system',
        binding: false,
        resolved: true,
      });

      expect(memory.getUnresolvedDecisions()).toHaveLength(1);
    });
  });

  describe('checkpoints', () => {
    it('should create and retrieve checkpoints', () => {
      const checkpoint = memory.createCheckpoint(10, [], {}, []);

      expect(checkpoint.tick).toBe(10);
      expect(memory.getCheckpoint('checkpoint-10')).toBeTruthy();
    });

    it('should limit checkpoint count', () => {
      const smallMemory = new SwarmMemory(100, 2);

      smallMemory.createCheckpoint(1, [], {}, []);
      smallMemory.createCheckpoint(2, [], {}, []);
      smallMemory.createCheckpoint(3, [], {}, []);
      smallMemory.createCheckpoint(4, [], {}, []);

      expect(smallMemory.listCheckpoints()).toHaveLength(2);
    });
  });

  describe('state export/import', () => {
    it('should export and import state', () => {
      const agent = createTestAgent({ id: 'export-agent' });
      memory.storeAgent(agent);

      const exported = memory.exportState();
      const newMemory = new SwarmMemory();
      newMemory.importState(exported);

      expect(newMemory.getAgent('export-agent')).toEqual(agent);
    });
  });
});

describe('ControlManager', () => {
  let manager: ControlManager;

  beforeEach(() => {
    manager = new ControlManager(DEFAULT_CONSTRAINTS, 'guided');
  });

  describe('processCommand', () => {
    it('should process pause command', async () => {
      const result = await manager.processCommand({ type: 'pause' });

      expect(result.status).toBe('ok');
      expect(manager.isPaused()).toBe(true);
    });

    it('should process resume command', async () => {
      await manager.processCommand({ type: 'pause' });
      const result = await manager.processCommand({ type: 'resume' });

      expect(result.status).toBe('ok');
      expect(manager.isPaused()).toBe(false);
    });

    it('should process stop command', async () => {
      const result = await manager.processCommand({ type: 'stop' });

      expect(result.status).toBe('ok');
      expect(result.message).toContain('stop');
    });

    it('should process set-mode command', async () => {
      const result = await manager.processCommand({ type: 'set-mode', mode: 'auto' });

      expect(result.status).toBe('ok');
      expect(manager.getMode()).toBe('auto');
    });

    it('should process limit-cost command', async () => {
      const result = await manager.processCommand({ type: 'limit-cost', maxCost: 50 });

      expect(result.status).toBe('ok');
      expect(manager.getConstraints().maxCostUSD).toBe(50);
    });

    it('should process limit-agents command', async () => {
      const result = await manager.processCommand({ type: 'limit-agents', maxAgents: 10 });

      expect(result.status).toBe('ok');
      expect(manager.getConstraints().maxAgents).toBe(10);
    });

    it('should process query-status command', async () => {
      const result = await manager.processCommand({ type: 'query-status' });

      expect(result.status).toBe('ok');
      expect(result.data).toBeTruthy();
    });

    it('should process query-agents command', async () => {
      const result = await manager.processCommand({ type: 'query-agents' });

      expect(result.status).toBe('ok');
      expect(result.data).toHaveProperty('agents');
    });

    it('should process query-cost command', async () => {
      const result = await manager.processCommand({ type: 'query-cost' });

      expect(result.status).toBe('ok');
      expect(result.data).toHaveProperty('totalCost');
      expect(result.data).toHaveProperty('budget');
    });
  });

  describe('audit logging', () => {
    it('should log all commands', async () => {
      await manager.processCommand({ type: 'pause' });
      await manager.processCommand({ type: 'resume' });
      await manager.processCommand({ type: 'set-mode', mode: 'auto' });

      const log = manager.getAuditLog();
      expect(log).toHaveLength(3);
      expect(log[0].type).toBe('pause');
      expect(log[1].type).toBe('resume');
      expect(log[2].type).toBe('set-mode');
    });
  });

  describe('pending decisions', () => {
    it('should add and retrieve pending decisions', () => {
      const decision = {
        id: 'dec-1',
        type: 'strategy' as const,
        description: 'Test decision',
        reasoning: 'Test reasoning',
        timestamp: Date.now(),
        source: 'system',
        binding: false,
        resolved: false,
      };

      manager.addPendingDecision(decision);
      const pending = manager.getPendingDecisions();

      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe('dec-1');
    });
  });
});

describe('ConstraintEnforcer', () => {
  let enforcer: ConstraintEnforcer;

  beforeEach(() => {
    enforcer = new ConstraintEnforcer(DEFAULT_CONSTRAINTS);
  });

  describe('guardAgentCreation', () => {
    it('should allow agent creation within limits', () => {
      const result = enforcer.guardAgentCreation(2);

      expect(result.allowed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('should track constraint violations', () => {
      const result = enforcer.guardAgentCreation(10);
      expect(result).toHaveProperty('allowed');
      expect(result).toHaveProperty('violations');
    });
  });

  describe('guardInference', () => {
    it('should allow inference with allowed models', () => {
      const result = enforcer.guardInference('gpt-4o');

      expect(result.allowed).toBe(true);
    });

    it('should block inference with forbidden models', () => {
      enforcer.updateConstraints({
        forbiddenModels: ['gpt-4o'],
      });

      const result = enforcer.guardInference('gpt-4o');

      expect(result.allowed).toBe(false);
    });
  });

  describe('guardCost', () => {
    it('should allow cost within budget', () => {
      const result = enforcer.guardCost(5, 1);

      expect(result.allowed).toBe(true);
    });

    it('should track cost violations', () => {
      const result = enforcer.guardCost(15, 10);
      expect(result).toHaveProperty('allowed');
      expect(result).toHaveProperty('violations');
    });
  });

  describe('guardFileSystem', () => {
    it('should allow file operations by default', () => {
      const result = enforcer.guardFileSystem();

      expect(result.allowed).toBe(true);
    });

    it('should block file operations when disabled', () => {
      enforcer.updateConstraints({ noFileSystemWrites: true });

      const result = enforcer.guardFileSystem();

      expect(result.allowed).toBe(false);
    });
  });

  describe('guardNetwork', () => {
    it('should allow network by default', () => {
      const result = enforcer.guardNetwork();

      expect(result.allowed).toBe(true);
    });

    it('should block network when disabled', () => {
      enforcer.updateConstraints({ noNetworkCalls: true });

      const result = enforcer.guardNetwork();

      expect(result.allowed).toBe(false);
    });
  });

  describe('checkAll', () => {
    it('should return status of all constraints', () => {
      const checks = enforcer.checkAll(2, 5, 50, Date.now() - 1000, 1);

      expect(checks.length).toBeGreaterThan(0);
      for (const check of checks) {
        expect(check).toHaveProperty('name');
        expect(check).toHaveProperty('passed');
      }
    });
  });
});

describe('CostTracker', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker(10);
  });

  describe('recordInference', () => {
    it('should track inference costs', () => {
      const cost = tracker.recordInference('agent-1', 'gpt-4o', 1000, 500);

      expect(cost).toBeGreaterThan(0);
      expect(tracker.getCurrentCost()).toBe(cost);
    });

    it('should track per-agent costs', () => {
      tracker.recordInference('agent-1', 'gpt-4o', 1000, 500);
      tracker.recordInference('agent-2', 'gpt-4o', 2000, 1000);

      expect(tracker.getAgentCost('agent-1')).toBeLessThan(tracker.getAgentCost('agent-2'));
    });

    it('should track per-model costs', () => {
      tracker.recordInference('agent-1', 'gpt-4o', 1000, 500);

      expect(tracker.getModelCost('gpt-4o')).toBeGreaterThan(0);
    });
  });

  describe('budget management', () => {
    it('should track remaining budget', () => {
      tracker.recordInference('agent-1', 'gpt-4o', 5000, 2500);
      const remaining = tracker.getRemainingBudget();

      expect(remaining).toBeLessThan(10);
      expect(remaining).toBeGreaterThanOrEqual(0);
    });

    it('should track budget status', () => {
      expect(tracker.isOverBudget()).toBe(false);
      expect(tracker.getBudgetPercentage()).toBeGreaterThanOrEqual(0);
    });

    it('should update budget dynamically', () => {
      tracker.setBudget(50);
      expect(tracker.getBudget()).toBe(50);
    });
  });

  describe('alerts', () => {
    it('should track costs correctly', () => {
      const cost = tracker.recordInference('agent-1', 'gpt-4o', 1000, 1000);
      expect(cost).toBeGreaterThan(0);
      expect(tracker.getCurrentCost()).toBeGreaterThan(0);
    });

    it('should acknowledge alerts', () => {
      tracker.recordInference('agent-1', 'gpt-4o', 6000, 4000);

      const alerts = tracker.getUnacknowledgedAlerts();
      if (alerts.length > 0) {
        tracker.acknowledgeAlert(alerts[0].id);
        expect(tracker.getUnacknowledgedAlerts()).toHaveLength(0);
      }
    });
  });

  describe('forecasting', () => {
    it('should forecast cost at completion', () => {
      tracker.startTracking(0);
      tracker.recordTickCost(0.5);
      tracker.recordTickCost(0.5);
      tracker.recordTickCost(0.5);

      const forecast = tracker.forecast(3, 0.5);

      expect(forecast).toHaveProperty('estimatedTotalCost');
      expect(forecast).toHaveProperty('risk');
    });
  });

  describe('statistics', () => {
    it('should provide cost statistics', () => {
      tracker.recordInference('agent-1', 'gpt-4o', 1000, 500);
      tracker.recordInference('agent-2', 'gpt-4o', 2000, 1000);

      const stats = tracker.getStatistics();

      expect(stats.totalCost).toBeGreaterThan(0);
      expect(stats.budget).toBe(10);
      expect(stats.agentCount).toBe(2);
      expect(stats.tickCount).toBe(0);
    });
  });
});

describe('ExecutionLoop', () => {
  let loop: ExecutionLoop;

  beforeEach(() => {
    loop = new ExecutionLoop('parallel', DEFAULT_CONSTRAINTS, {
      tickIntervalMs: 10,
      maxTicks: 10,
    });
  });

  describe('lifecycle', () => {
    it('should report initial state correctly', () => {
      expect(loop.isActive()).toBe(false);
      expect(loop.isPausedState()).toBe(false);
      expect(loop.getCurrentTick()).toBe(0);
    });

    it('should change strategy', () => {
      expect(loop.getStrategy()).toBe('parallel');

      loop.setStrategy('sequential');
      expect(loop.getStrategy()).toBe('sequential');
    });

    it('should stop execution', () => {
      loop.stop();
      expect(loop.isActive()).toBe(false);
    });

    it('should change strategy', () => {
      expect(loop.getStrategy()).toBe('parallel');

      loop.setStrategy('sequential');
      expect(loop.getStrategy()).toBe('sequential');
    });
  });

  describe('agent management', () => {
    it('should add agents', () => {
      const agent = createTestAgent({ id: 'new-agent' });
      loop.addAgent(agent);

      const agents = loop.getAgents();
      expect(agents.some((a) => a.id === 'new-agent')).toBe(true);
    });

    it('should remove agents', () => {
      const agent = createTestAgent({ id: 'to-remove' });
      loop.addAgent(agent);
      loop.removeAgent('to-remove');

      const agents = loop.getAgents();
      expect(agents.some((a) => a.id === 'to-remove')).toBe(false);
    });
  });

  describe('subtask management', () => {
    it('should get subtasks', () => {
      const subtasks = loop.getSubtasks();
      expect(Array.isArray(subtasks)).toBe(true);
    });

    it('should prioritize subtasks', () => {
      loop.prioritizeSubtask('nonexistent', 10);

      const subtasks = loop.getSubtasks();
      expect(subtasks).toBeDefined();
    });
  });

  describe('metrics', () => {
    it('should provide metrics', () => {
      const metrics = loop.getMetrics();

      expect(metrics).toHaveProperty('ticksElapsed');
      expect(metrics).toHaveProperty('subtasksTotal');
      expect(metrics).toHaveProperty('costSoFar');
      expect(metrics).toHaveProperty('budgetRemaining');
    });
  });
});

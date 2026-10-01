import { describe, expect, it } from 'vitest';
import { HarnessCompetition } from '../core/differentiation/HarnessCompetition.js';
import { CrossHarnessDelegator } from '../core/differentiation/CrossHarnessDelegator.js';
import { MissionOptimizer } from '../core/differentiation/MissionOptimizer.js';
import { FleetScheduler } from '../core/differentiation/FleetScheduler.js';
import { CognitiveGraph } from '../core/differentiation/CognitiveGraph.js';
import { DecisionEngine } from '../core/differentiation/DecisionEngine.js';
import { AutonomousRecovery } from '../core/differentiation/AutonomousRecovery.js';
import { EvidenceGraph } from '../core/differentiation/EvidenceGraph.js';
import type { HarnessDescriptor } from '../core/execution/types.js';
import type { TaskNode } from '../core/mission/types.js';
import type { FabricNodeRecord } from '../core/fabric/types.js';

const harness = (id: string, streaming = true): HarnessDescriptor => ({
  id, name: id, kind: 'plugin', provider: id, args: [],
  capabilities: {
    codeGeneration: true, fileEditing: true, commandExecution: true, webResearch: false,
    communication: true, execution: true, local: true, remote: false, streaming,
    cancellation: true, checkpointResume: true, workspaceIsolation: true, multimodal: false, longContext: true,
  },
  supportedModes: ['execution'], status: 'AVAILABLE',
  availability: { installed: true, authenticated: true, executable: true, checkedAt: new Date().toISOString() },
});

const task = (id: string, deps: string[] = []): TaskNode => ({
  id, missionId: 'm1', title: id, description: id, state: 'READY', priority: 'MEDIUM',
  dependencies: deps, requiredCapabilities: [], acceptanceCriteria: [], inputs: {}, outputs: {},
  artifacts: [], evidenceIds: [], attempt: 0, maxAttempts: 3, idempotencyKey: id,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});

describe('Phase F EamilOS differentiation', () => {
  it('ranks compatible harnesses', () => {
    const scores = new HarnessCompetition().rank([harness('a'), harness('b')], { requiredCapabilities: ['codeGeneration'] });
    expect(scores).toHaveLength(2);
  });

  it('plans cross-harness delegation', () => {
    const plan = new CrossHarnessDelegator().plan(
      { id: 'd1', missionId: 'm1', taskId: 't1', objective: 'build', requiredCapabilities: ['codeGeneration'] },
      [{ harnessId: 'a', score: 10 }, { harnessId: 'b', score: 9 }],
      2,
    );
    expect(plan.strategy).toBe('fallback');
    expect(plan.targets).toHaveLength(2);
  });

  it('optimizes task waves and critical path', () => {
    const plan = new MissionOptimizer().optimize([task('a'), task('b', ['a']), task('c', ['a'])], { maxConcurrentTasks: 2 });
    expect(plan.waves).toEqual([['a'], ['b', 'c']]);
    expect(plan.criticalPath).toEqual(['a', 'b']);
  });

  it('assigns fleet work by capabilities and load', () => {
    const nodes: FabricNodeRecord[] = [
      { identity: { nodeId: 'n1', name: 'one', publicKey: 'p', version: '1', createdAt: 0 }, capabilities: { platform: 'x', arch: 'x', cpuCores: 4, totalRAMBytes: 1, availableRAMBytes: 1, gpus: [], harnesses: ['a'], models: [], providers: [], tools: [], maxConcurrentTasks: 1 }, state: 'online', lastSeenAt: 0, activeTasks: 1 },
      { identity: { nodeId: 'n2', name: 'two', publicKey: 'p', version: '1', createdAt: 0 }, capabilities: { platform: 'x', arch: 'x', cpuCores: 4, totalRAMBytes: 1, availableRAMBytes: 1, gpus: [], harnesses: ['a'], models: [], providers: [], tools: [], maxConcurrentTasks: 2 }, state: 'online', lastSeenAt: 0, activeTasks: 0 },
    ];
    expect(new FleetScheduler().assign([{ id: 't', requiredHarnesses: ['a'] }], nodes)[0].nodeId).toBe('n2');
  });

  it('builds cognitive and evidence graphs', () => {
    const graph = new CognitiveGraph();
    graph.addNode({ id: 'm', kind: 'mission', label: 'mission' });
    graph.addNode({ id: 't', kind: 'task', label: 'task' });
    graph.addEdge({ from: 'm', to: 't', relation: 'decomposes' });
    expect(graph.neighbors('m')).toHaveLength(1);

    const evidence = new EvidenceGraph();
    evidence.addNode({ id: 'r', type: 'requirement', label: 'req' });
    evidence.addNode({ id: 'v', type: 'validation', label: 'test', passed: true });
    evidence.addEdge({ from: 'r', to: 'v', relation: 'satisfies' });
    expect(evidence.verifyRequirement('r')).toBe(true);
  });

  it('chooses a safe autonomous recovery action', () => {
    expect(new AutonomousRecovery().plan({
      missionId: 'm1', taskId: 't1', failure: 'TIMEOUT', retryable: true,
      fallbackEligible: true, checkpointAvailable: true, alternatives: ['b'],
    }).action).toBe('checkpoint-resume');
  });

  it('records a decision', async () => {
    const result = await new DecisionEngine().decide([
      { id: 'a', description: 'a', expectedCost: 2, risk: 1, confidence: 0.8, execute: () => 'a' },
      { id: 'b', description: 'b', expectedCost: 10, risk: 2, confidence: 0.6, execute: () => 'b' },
    ]);
    expect(result.result).toBe('a');
    expect(result.record.selectedOption).toBe('a');
  });
});

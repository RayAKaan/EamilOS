import { describe, expect, it } from 'vitest';
import { CognitiveGraph } from './CognitiveGraph.js';
import { GraphMutationEngine } from './GraphMutationEngine.js';
import { GraphQueryEngine } from './GraphQueryEngine.js';
import { GraphValidator } from './GraphValidator.js';

const source = { kind: 'SYSTEM' as const, sourceId: 'test' };

function graph() {
  const g = new CognitiveGraph('mission-1');
  g.addNode({ id: 'mission-1', type: 'MISSION', source });
  g.addNode({ id: 'task-a', type: 'TASK', source, attributes: { state: 'COMPLETED' } });
  g.addNode({ id: 'task-b', type: 'TASK', source, attributes: { state: 'BLOCKED' } });
  g.addEdge({ id: 'e1', type: 'CONTAINS', from: 'mission-1', to: 'task-a', source });
  g.addEdge({ id: 'e2', type: 'CONTAINS', from: 'mission-1', to: 'task-b', source });
  g.addEdge({ id: 'e3', type: 'DEPENDS_ON', from: 'task-a', to: 'task-b', source });
  return g.commitVersion();
}

describe('CognitiveGraph', () => {
  it('builds a deterministic versioned snapshot', () => {
    const a = graph();
    const b = graph();
    expect(a.version).toBe(1);
    expect(a.stateHash).toBe(b.stateHash);
  });

  it('queries dependencies and blockers', () => {
    const snapshot = graph();
    const query = new GraphQueryEngine(snapshot);
    expect(query.findDependencies('task-b').map(n => n.id)).toEqual(['task-a']);
    const g = new CognitiveGraph('mission-1', snapshot);
    g.updateNode('task-a', { state: 'FAILED' });
    const updated = g.commitVersion();
    expect(new GraphQueryEngine(updated).findBlockers('task-b').map(n => n.id)).toEqual(['task-a']);
  });

  it('rejects stale mutations and validates successful mutations', () => {
    const snapshot = graph();
    const engine = new GraphMutationEngine();
    expect(() => engine.apply(snapshot, engine.propose({
      missionId: 'mission-1', baseVersion: 0, type: 'UPDATE_NODE',
      actor: { kind: 'SYSTEM', id: 'test' }, targetIds: ['task-a'],
      payload: { attributes: { state: 'FAILED' } },
    }))).toThrow(/Stale graph mutation/);
    const mutation = engine.propose({
      missionId: 'mission-1', baseVersion: snapshot.version, type: 'UPDATE_NODE',
      actor: { kind: 'SYSTEM', id: 'test' }, targetIds: ['task-a'],
      payload: { attributes: { state: 'FAILED' } },
    });
    const next = engine.apply(snapshot, mutation);
    expect(next.version).toBe(2);
    expect(new GraphValidator().validate(next).consistent).toBe(true);
  });

  it('rejects edges with missing endpoints', () => {
    const g = new CognitiveGraph('mission-1');
    g.addNode({ id: 'a', type: 'TASK', source });
    expect(() => g.addEdge({ id: 'bad', type: 'DEPENDS_ON', from: 'a', to: 'missing', source })).toThrow(/missing node/);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { ExecutionGraph } from '../../src/collaboration/ExecutionGraph.js';

describe('ExecutionGraph', () => {
  let graph: ExecutionGraph;

  beforeEach(() => {
    graph = new ExecutionGraph();
  });

  describe('addNode', () => {
    it('should add a node and return its ID', () => {
      const nodeId = graph.addNode('task1', 'planner');
      expect(nodeId).toBeTruthy();
      expect(graph.getNode(nodeId)).toBeDefined();
    });

    it('should set initial status to pending', () => {
      const nodeId = graph.addNode('task1', 'planner');
      const node = graph.getNode(nodeId);
      expect(node?.status).toBe('pending');
    });

    it('should create nodes with correct role', () => {
      const nodeId = graph.addNode('task1', 'coder');
      const node = graph.getNode(nodeId);
      expect(node?.role).toBe('coder');
    });
  });

  describe('dependencies', () => {
    it('should track dependencies between nodes', () => {
      const plannerId = graph.addNode('plan', 'planner');
      const coderId = graph.addNode('code', 'coder', [plannerId]);

      const coder = graph.getNode(coderId);
      expect(coder?.dependencies).toContain(plannerId);
    });

    it('should track dependents', () => {
      const plannerId = graph.addNode('plan', 'planner');
      const coderId = graph.addNode('code', 'coder', [plannerId]);

      const planner = graph.getNode(plannerId);
      expect(planner?.dependents).toContain(coderId);
    });
  });

  describe('status updates', () => {
    it('should update node status', () => {
      const nodeId = graph.addNode('task1', 'planner');
      expect(graph.updateNodeStatus(nodeId, 'running')).toBe(true);

      const node = graph.getNode(nodeId);
      expect(node?.status).toBe('running');
    });

    it('should set startTime when running', () => {
      const nodeId = graph.addNode('task1', 'planner');
      graph.updateNodeStatus(nodeId, 'running');

      const node = graph.getNode(nodeId);
      expect(node?.startTime).toBeDefined();
    });

    it('should set endTime when completed', () => {
      const nodeId = graph.addNode('task1', 'planner');
      graph.updateNodeStatus(nodeId, 'running');
      graph.updateNodeStatus(nodeId, 'completed');

      const node = graph.getNode(nodeId);
      expect(node?.endTime).toBeDefined();
    });
  });

  describe('getReadyNodes', () => {
    it('should return nodes with all dependencies met', () => {
      const node1 = graph.addNode('task1', 'planner');
      const node2 = graph.addNode('task2', 'coder', [node1]);

      graph.updateNodeStatus(node1, 'completed');

      const ready = graph.getReadyNodes();
      expect(ready.length).toBe(1);
      expect(ready[0].id).toBe(node2);
    });

    it('should not return nodes with unmet dependencies', () => {
      const node1 = graph.addNode('task1', 'planner');
      graph.addNode('task2', 'coder', [node1]);

      const ready = graph.getReadyNodes();
      expect(ready.length).toBe(0);
    });
  });

  describe('validation', () => {
    it('should detect missing dependencies', () => {
      graph.addNode('task1', 'planner');
      graph.addNode('task2', 'coder', ['nonexistent']);

      const result = graph.validate();
      expect(result.valid).toBe(false);
      expect(result.missingDependencies.length).toBeGreaterThan(0);
    });

    it('should detect circular dependencies', () => {
      const node1 = graph.addNode('task1', 'planner');
      const node2 = graph.addNode('task2', 'coder', [node1]);

      const node1Node = graph.getNode(node1);
      if (node1Node) {
        node1Node.dependencies.push(node2);
      }

      const result = graph.validate();
      expect(result.cycles.length).toBeGreaterThan(0);
    });

    it('should validate empty graph', () => {
      const result = graph.validate();
      expect(result.valid).toBe(true);
    });
  });

  describe('topological order', () => {
    it('should compute valid topological order', () => {
      const node1 = graph.addNode('task1', 'planner');
      const node2 = graph.addNode('task2', 'coder', [node1]);
      const node3 = graph.addNode('task3', 'validator', [node2]);

      const order = graph.computeTopologicalOrder();
      expect(order.indexOf(node1)).toBeLessThan(order.indexOf(node2));
      expect(order.indexOf(node2)).toBeLessThan(order.indexOf(node3));
    });
  });

  describe('execution schedule', () => {
    it('should compute phases correctly', () => {
      const node1 = graph.addNode('plan', 'planner');
      graph.addNode('code1', 'coder', [node1]);
      graph.addNode('code2', 'coder', [node1]);

      const schedule = graph.computeExecutionSchedule();
      expect(schedule.phases.length).toBeGreaterThanOrEqual(2);
    });

    it('should identify critical path', () => {
      const node1 = graph.addNode('task1', 'planner');
      graph.addNode('task2', 'coder', [node1]);

      const schedule = graph.computeExecutionSchedule();
      expect(schedule.criticalPath.length).toBeGreaterThan(0);
    });
  });

  describe('outputs', () => {
    it('should set and get node outputs', () => {
      const nodeId = graph.addNode('task1', 'planner');
      graph.setNodeOutput(nodeId, { result: 'success', data: { key: 'value' } });

      expect(graph.getNodeOutput(nodeId, 'result')).toBe('success');
      expect(graph.getNodeOutput(nodeId, 'data')).toEqual({ key: 'value' });
    });
  });

  describe('cancellation', () => {
    it('should cancel a node', () => {
      const nodeId = graph.addNode('task1', 'planner');
      expect(graph.cancelNode(nodeId)).toBe(true);

      const node = graph.getNode(nodeId);
      expect(node?.status).toBe('cancelled');
    });

    it('should cascade cancel to dependents', () => {
      const node1 = graph.addNode('task1', 'planner');
      const node2 = graph.addNode('task2', 'coder', [node1]);

      graph.cancelNode(node1);

      const cancelled1 = graph.getNode(node1);
      const cancelled2 = graph.getNode(node2);
      expect(cancelled1?.status).toBe('cancelled');
      expect(cancelled2?.status).toBe('cancelled');
    });
  });

  describe('stats', () => {
    it('should return correct stats', () => {
      graph.addNode('task1', 'planner');
      graph.addNode('task2', 'coder');

      const node1Id = graph.addNode('task3', 'writer');
      graph.updateNodeStatus(node1Id, 'completed');

      const stats = graph.getStats();
      expect(stats.total).toBe(3);
      expect(stats.completed).toBe(1);
      expect(stats.pending).toBe(2);
    });

    it('should calculate success rate', () => {
      const node1Id = graph.addNode('task1', 'planner');
      graph.updateNodeStatus(node1Id, 'completed');

      const node2Id = graph.addNode('task2', 'coder');
      graph.updateNodeStatus(node2Id, 'failed');

      const stats = graph.getStats();
      expect(stats.successRate).toBe(50);
    });
  });

  describe('clone', () => {
    it('should create a deep copy of the graph', () => {
      graph.addNode('task1', 'planner');
      const cloned = graph.clone();

      expect(cloned.getNodesByRole('planner')).toHaveLength(1);
    });
  });
});

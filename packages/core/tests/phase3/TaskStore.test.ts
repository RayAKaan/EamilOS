import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { TaskStore } from '../../src/distributed/TaskStore.js';
import type { PersistedTask } from '../../src/distributed/types.js';

describe('TaskStore', () => {
  const testDir = '.test-eamilos-tasks';
  let taskStore: TaskStore;

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    taskStore = new TaskStore({ persistPath: testDir });
  });

  afterEach(() => {
    taskStore.stopAutoSave();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('save and get', () => {
    it('should save and retrieve a task', () => {
      const task: PersistedTask = {
        taskId: 'task-1',
        agentId: 'agent-1',
        model: 'gpt-4',
        status: 'pending',
        assignedNode: 'node-1',
        timestamp: Date.now(),
        attempts: 1,
      };

      taskStore.save(task);
      const retrieved = taskStore.get('task-1');

      expect(retrieved).toBeDefined();
      expect(retrieved?.taskId).toBe('task-1');
      expect(retrieved?.status).toBe('pending');
    });

    it('should return undefined for non-existent task', () => {
      const retrieved = taskStore.get('non-existent');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update a task', () => {
      const task: PersistedTask = {
        taskId: 'task-1',
        agentId: 'agent-1',
        model: 'gpt-4',
        status: 'pending',
        assignedNode: 'node-1',
        timestamp: Date.now(),
        attempts: 1,
      };

      taskStore.save(task);
      taskStore.update('task-1', { status: 'running', assignedNode: 'node-2' });

      const updated = taskStore.get('task-1');
      expect(updated?.status).toBe('running');
      expect(updated?.assignedNode).toBe('node-2');
    });
  });

  describe('getPending', () => {
    it('should return only pending and running tasks', () => {
      taskStore.save({ taskId: 't1', agentId: 'a1', model: 'm1', status: 'pending', assignedNode: 'n1', timestamp: Date.now(), attempts: 1 });
      taskStore.save({ taskId: 't2', agentId: 'a2', model: 'm2', status: 'running', assignedNode: 'n2', timestamp: Date.now(), attempts: 1 });
      taskStore.save({ taskId: 't3', agentId: 'a3', model: 'm3', status: 'completed', assignedNode: 'n3', timestamp: Date.now(), attempts: 1 });

      const pending = taskStore.getPending();
      expect(pending).toHaveLength(2);
      expect(pending.map((t) => t.taskId)).toContain('t1');
      expect(pending.map((t) => t.taskId)).toContain('t2');
    });
  });

  describe('priority filtering', () => {
    it('should filter by priority', () => {
      taskStore.save({ taskId: 't1', agentId: 'a1', model: 'm1', status: 'pending', assignedNode: 'n1', priority: 'high', timestamp: Date.now(), attempts: 1 });
      taskStore.save({ taskId: 't2', agentId: 'a2', model: 'm2', status: 'pending', assignedNode: 'n2', priority: 'normal', timestamp: Date.now(), attempts: 1 });
      taskStore.save({ taskId: 't3', agentId: 'a3', model: 'm3', status: 'pending', assignedNode: 'n3', priority: 'low', timestamp: Date.now(), attempts: 1 });

      const high = taskStore.getByPriority('high');
      expect(high).toHaveLength(1);
      expect(high[0].taskId).toBe('t1');
    });

    it('should sort by priority', () => {
      taskStore.save({ taskId: 't1', agentId: 'a1', model: 'm1', status: 'pending', assignedNode: 'n1', priority: 'low', timestamp: 1000, attempts: 1 });
      taskStore.save({ taskId: 't2', agentId: 'a2', model: 'm2', status: 'pending', assignedNode: 'n2', priority: 'high', timestamp: 2000, attempts: 1 });
      taskStore.save({ taskId: 't3', agentId: 'a3', model: 'm3', status: 'pending', assignedNode: 'n3', priority: 'normal', timestamp: 3000, attempts: 1 });

      const sorted = taskStore.getSortedByPriority();
      expect(sorted[0].taskId).toBe('t2');
      expect(sorted[1].taskId).toBe('t3');
      expect(sorted[2].taskId).toBe('t1');
    });
  });

  describe('mark helpers', () => {
    it('should mark task as running', () => {
      taskStore.save({ taskId: 't1', agentId: 'a1', model: 'm1', status: 'pending', assignedNode: 'n1', timestamp: Date.now(), attempts: 1 });
      taskStore.markRunning('t1', 'node-2');

      const task = taskStore.get('t1');
      expect(task?.status).toBe('running');
      expect(task?.assignedNode).toBe('node-2');
    });

    it('should mark task as completed', () => {
      taskStore.save({ taskId: 't1', agentId: 'a1', model: 'm1', status: 'running', assignedNode: 'n1', timestamp: Date.now(), attempts: 1 });
      taskStore.markCompleted('t1', { success: true, taskId: 't1', nodeId: 'n1' });

      const task = taskStore.get('t1');
      expect(task?.status).toBe('completed');
      expect(task?.result?.success).toBe(true);
    });

    it('should mark task as failed', () => {
      taskStore.save({ taskId: 't1', agentId: 'a1', model: 'm1', status: 'running', assignedNode: 'n1', timestamp: Date.now(), attempts: 1 });
      taskStore.markFailed('t1', 'Connection lost');

      const task = taskStore.get('t1');
      expect(task?.status).toBe('failed');
    });

    it('should increment attempts', () => {
      taskStore.save({ taskId: 't1', agentId: 'a1', model: 'm1', status: 'running', assignedNode: 'n1', timestamp: Date.now(), attempts: 1 });
      const newAttempts = taskStore.incrementAttempts('t1');

      expect(newAttempts).toBe(2);
      expect(taskStore.get('t1')?.attempts).toBe(2);
    });
  });

  describe('persistence', () => {
    it('should persist tasks to disk', () => {
      taskStore.save({ taskId: 't1', agentId: 'a1', model: 'm1', status: 'pending', assignedNode: 'n1', timestamp: Date.now(), attempts: 1 });

      const newStore = new TaskStore({ persistPath: testDir });
      const retrieved = newStore.get('t1');

      expect(retrieved).toBeDefined();
      expect(retrieved?.taskId).toBe('t1');
    });
  });

  describe('clearCompleted', () => {
    it('should clear completed tasks', () => {
      taskStore.save({ taskId: 't1', agentId: 'a1', model: 'm1', status: 'completed', assignedNode: 'n1', timestamp: Date.now() - 60000, attempts: 1 });
      taskStore.save({ taskId: 't2', agentId: 'a2', model: 'm2', status: 'completed', assignedNode: 'n2', timestamp: Date.now(), attempts: 1 });
      taskStore.save({ taskId: 't3', agentId: 'a3', model: 'm3', status: 'pending', assignedNode: 'n3', timestamp: Date.now(), attempts: 1 });

      const cleared = taskStore.clearCompleted(30000);

      expect(cleared).toBe(1);
      expect(taskStore.get('t1')).toBeUndefined();
      expect(taskStore.get('t2')).toBeDefined();
      expect(taskStore.get('t3')).toBeDefined();
    });
  });

  describe('stats', () => {
    it('should return correct stats', () => {
      taskStore.save({ taskId: 't1', agentId: 'a1', model: 'm1', status: 'pending', assignedNode: 'n1', priority: 'high', timestamp: Date.now(), attempts: 1 });
      taskStore.save({ taskId: 't2', agentId: 'a2', model: 'm2', status: 'running', assignedNode: 'n2', priority: 'normal', timestamp: Date.now(), attempts: 1 });
      taskStore.save({ taskId: 't3', agentId: 'a3', model: 'm3', status: 'completed', assignedNode: 'n3', priority: 'low', timestamp: Date.now(), attempts: 1 });
      taskStore.save({ taskId: 't4', agentId: 'a4', model: 'm4', status: 'failed', assignedNode: 'n4', priority: 'normal', timestamp: Date.now(), attempts: 1 });

      const stats = taskStore.getStats();

      expect(stats.total).toBe(4);
      expect(stats.pending).toBe(1);
      expect(stats.running).toBe(1);
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.byPriority.high).toBe(1);
      expect(stats.byPriority.normal).toBe(2);
      expect(stats.byPriority.low).toBe(1);
    });
  });
});

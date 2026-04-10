import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SharedMemory } from '../../src/memory/SharedMemory.js';

describe('SharedMemory', () => {
  let memory: SharedMemory;

  beforeEach(() => {
    memory = new SharedMemory();
  });

  describe('basic operations', () => {
    it('should set and get a value', () => {
      memory.set('key1', 'value1', 'agent1', 'coder');
      expect(memory.getValue('key1')).toBe('value1');
    });

    it('should return undefined for non-existent key', () => {
      expect(memory.getValue('nonexistent')).toBeUndefined();
    });

    it('should check if key exists', () => {
      memory.set('key1', 'value1', 'agent1');
      expect(memory.has('key1')).toBe(true);
      expect(memory.has('nonexistent')).toBe(false);
    });

    it('should delete a value', () => {
      memory.set('key1', 'value1', 'agent1');
      expect(memory.delete('key1')).toBe(true);
      expect(memory.has('key1')).toBe(false);
    });

    it('should not delete value from different agent', () => {
      memory.set('key1', 'value1', 'agent1');
      expect(memory.delete('key1', 'agent2')).toBe(false);
      expect(memory.has('key1')).toBe(true);
    });
  });

  describe('versioning', () => {
    it('should increment version on update', () => {
      memory.set('key1', 'value1', 'agent1');
      expect(memory.getVersion('key1')).toBe(1);

      memory.set('key1', 'value2', 'agent1');
      expect(memory.getVersion('key1')).toBe(2);
    });

    it('should maintain version history', () => {
      memory.set('key1', 'v1', 'agent1');
      memory.set('key1', 'v2', 'agent1');
      memory.set('key1', 'v3', 'agent1');

      const history = memory.getHistory('key1');
      expect(history.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('conflict resolution - last-write-wins', () => {
    it('should use last-write-wins by default', () => {
      const onConflict = vi.fn();
      memory = new SharedMemory({
        conflictResolution: 'last-write-wins',
        onConflict,
      });

      memory.set('key1', 'value1', 'agent1');
      memory.set('key1', 'value2', 'agent2');

      expect(memory.getValue('key1')).toBe('value2');
      expect(onConflict).toHaveBeenCalled();
    });
  });

  describe('conflict resolution - reject-conflict', () => {
    it('should reject conflicting writes', () => {
      const onConflict = vi.fn();
      memory = new SharedMemory({
        conflictResolution: 'reject-conflict',
        onConflict,
      });

      memory.set('key1', 'value1', 'agent1');
      memory.set('key1', 'value2', 'agent2');

      expect(memory.getValue('key1')).toBe('value1');
      expect(onConflict).toHaveBeenCalled();
    });
  });

  describe('query methods', () => {
    it('should get entries by agent', () => {
      memory.set('key1', 'v1', 'agent1', 'coder');
      memory.set('key2', 'v2', 'agent2', 'planner');
      memory.set('key3', 'v3', 'agent1', 'writer');

      const agent1Entries = memory.getByAgent('agent1');
      expect(agent1Entries).toHaveLength(2);
    });

    it('should get entries by role', () => {
      memory.set('key1', 'v1', 'agent1', 'coder');
      memory.set('key2', 'v2', 'agent2', 'planner');

      const coderEntries = memory.getByRole('coder');
      expect(coderEntries).toHaveLength(1);
      expect(coderEntries[0].value).toBe('v1');
    });

    it('should filter keys by pattern', () => {
      memory.set('user:name', 'John', 'agent1');
      memory.set('user:age', '30', 'agent1');
      memory.set('config:theme', 'dark', 'agent1');

      const userKeys = memory.keys('user:*');
      expect(userKeys).toHaveLength(2);
    });
  });

  describe('snapshot and restore', () => {
    it('should create and restore snapshot', () => {
      memory.set('key1', 'value1', 'agent1');
      memory.set('key2', 'value2', 'agent1');

      const snapshot = memory.snapshot();
      memory.clear();

      expect(memory.size()).toBe(0);

      memory.restore(snapshot);
      expect(memory.size()).toBe(2);
      expect(memory.getValue('key1')).toBe('value1');
    });
  });

  describe('TTL', () => {
    it('should expire entries after TTL', async () => {
      memory = new SharedMemory({
        ttl: 100,
      });

      memory.set('key1', 'value1', 'agent1');
      expect(memory.has('key1')).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 150));
      expect(memory.has('key1')).toBe(false);
    });
  });
});

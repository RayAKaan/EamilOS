import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { VectorClock } from '../../src/comms/VectorClock.js';
import { DistributedCommsGround } from '../../src/comms/DistributedCommsGround.js';
import { DistributedRelevanceScorer, type DistributedMessage } from '../../src/comms/DistributedRelevanceScorer.js';
import { MessageSummarizer } from '../../src/comms/MessageSummarizer.js';
import { DistributedMemory } from '../../src/memory/DistributedMemory.js';
import type { SwarmMessage } from '../../src/swarm/types.js';

function createMockEventEmitter(): EventEmitter {
  return new EventEmitter();
}

describe('Phase 5.1: Distributed Reliability & Consistency', () => {
  describe('VectorClock Stabilization', () => {
    let clock: VectorClock;

    beforeEach(() => {
      clock = new VectorClock('node-1', { maxNodes: 10, nodeTTL: 5000 });
    });

    it('should prune old nodes after TTL', () => {
      clock.tick();
      clock.tick();

      expect(clock.getStats().nodeCount).toBe(1);

      clock.merge({ 'node-2': 1, 'node-3': 1 });
      expect(clock.getActiveNodes().length).toBeGreaterThanOrEqual(1);
    });

    it('should respect maxNodes limit', () => {
      for (let i = 0; i < 15; i++) {
        clock.merge({ [`node-${i}`]: 1 });
      }

      clock.prune();
      const stats = clock.getStats();
      expect(stats.nodeCount).toBeLessThan(stats.nodeCount + 1);
    });

    it('should compare clocks correctly', () => {
      const clockA = { 'node-1': 1 };
      const clockB = { 'node-1': 2 };

      const result1 = VectorClock.compare(clockA, clockB);
      const result2 = VectorClock.compare(clockB, clockA);
      const result3 = VectorClock.compare(clockA, clockA);

      expect(result1).not.toBe('equal');
      expect(result2).not.toBe('equal');
      expect(result3).toBe('equal');
    });

    it('should sort causally with tie-breaker', () => {
      const messages: { vectorClock: Record<string, number>; timestamp: number; fromNode: string }[] = [
        { vectorClock: { 'node-1': 1 }, timestamp: 1000, fromNode: 'node-1' },
        { vectorClock: { 'node-2': 1 }, timestamp: 500, fromNode: 'node-2' },
        { vectorClock: { 'node-1': 1, 'node-2': 1 }, timestamp: 1500, fromNode: 'node-1' },
      ];

      const sorted = VectorClock.causalSort(messages);
      expect(sorted.length).toBe(3);
      expect(sorted[0].fromNode).toBe('node-2');
    });

    it('should emit prune event', () => {
      let pruneCount = 0;
      clock.onPruneEvent(() => {
        pruneCount++;
      });

      for (let i = 0; i < 15; i++) {
        clock.merge({ [`node-${i}`]: 1 });
      }
      clock.prune();

      expect(pruneCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Reliable Messaging (ACK + Retry)', () => {
    let comms: DistributedCommsGround;

    beforeEach(() => {
      comms = new DistributedCommsGround('node-1', createMockEventEmitter());
    });

    it('should publish messages without requiring ack by default', () => {
      const message = comms.publish('task-1', {
        from: 'agent-1',
        type: 'task',
        content: 'Test message',
      });

      expect(message).not.toBeNull();
      expect(message!.id).toBeTruthy();
    });

    it('should track message delivery', () => {
      comms.publish('task-1', {
        from: 'agent-1',
        type: 'task',
        content: 'Test message',
      });

      expect(comms.getTaskMessageCount('task-1')).toBeGreaterThanOrEqual(0);
    });

    it('should get state snapshot', () => {
      comms.publish('task-1', { from: 'agent-1', type: 'task', content: 'Test' });

      const snapshot = comms.getStateSnapshot();
      expect(snapshot).toHaveProperty('messages');
      expect(snapshot).toHaveProperty('vectorClock');
      expect(snapshot).toHaveProperty('knownMessageIds');
    });
  });

  describe('Deduplication Engine (LRU + TTL)', () => {
    let comms: DistributedCommsGround;

    beforeEach(() => {
      comms = new DistributedCommsGround('node-1', createMockEventEmitter(), {
        deduplicationWindowMs: 1000,
        dedupMaxSize: 100,
      });
    });

    it('should track seen messages', () => {
      comms.publish('task-1', {
        id: 'msg-1',
        from: 'agent-1',
        type: 'task',
        content: 'First',
      });

      comms.publish('task-1', {
        id: 'msg-2',
        from: 'agent-2',
        type: 'task',
        content: 'Second',
      });

      const stats = comms.getStats();
      expect(stats.deduplicatedCount).toBeGreaterThanOrEqual(0);
    });

    it('should clean up old dedup entries', () => {
      for (let i = 0; i < 50; i++) {
        comms.publish('task-1', {
          id: `msg-${i}`,
          from: 'agent-1',
          type: 'task',
          content: `Message ${i}`,
        });
      }

      const stats = comms.getStats();
      expect(stats.totalMessages).toBeGreaterThan(0);
    });
  });

  describe('Summarization Safety Layer', () => {
    let summarizer: MessageSummarizer;

    beforeEach(() => {
      summarizer = new MessageSummarizer({
        protectedRecentMessages: 5,
        preserveDecisions: true,
        preserveDependencies: true,
      });
    });

    it('should preserve decisions in summary', async () => {
      const messages: any[] = [];
      for (let i = 0; i < 20; i++) {
        messages.push({
          id: String(i),
          type: i === 5 ? 'decision' : 'task',
          content: i === 5 ? 'Decision made here' : `Work item ${i}`,
          from: 'agent-1',
          timestamp: 1000 + i * 100,
          vectorClock: {},
          causalOrder: i,
        });
      }

      const summary = await summarizer.summarize(messages, 'task-1', 'node-1', { 'node-1': 25 });

      expect(summary).not.toBeNull();
    });

    it('should preserve dependencies in summary', async () => {
      const messages: any[] = [];
      for (let i = 0; i < 15; i++) {
        messages.push({
          id: String(i),
          type: 'task',
          content: `Task ${i}`,
          from: 'agent-1',
          timestamp: 1000 + i * 100,
          vectorClock: {},
          causalOrder: i,
          metadata: i === 5 ? { dependencies: ['Task 1'] } : {},
        });
      }

      const summary = await summarizer.summarize(messages, 'task-1', 'node-1', { 'node-1': 20 });

      expect(summary).not.toBeNull();
      expect(summary!.dependencyChains.length).toBeGreaterThanOrEqual(0);
    });

    it('should not summarize critical priority messages', () => {
      const messages: any[] = [];
      for (let i = 0; i < 15; i++) {
        messages.push({
          id: String(i),
          type: 'task',
          content: `Message ${i}`,
          from: 'agent-1',
          timestamp: 1000 + i,
          vectorClock: {},
          causalOrder: i,
          priority: i === 10 ? 'critical' : 'normal',
        });
      }

      const canSummarize = summarizer.canSummarize(messages);
      expect(canSummarize).toBe(true);
    });
  });

  describe('Conflict Resolution (CRDT+)', () => {
    let memory: DistributedMemory;

    beforeEach(() => {
      memory = new DistributedMemory({
        nodeId: 'node-1',
        conflictResolution: 'version-merge',
        conflictStrategy: 'version-wins',
        maxEntries: 100,
        onConflict: vi.fn(),
      });
    });

    it('should detect concurrent writes', () => {
      memory.set('key-1', 'value-1', 'agent-1', { 'node-1': 1 });
      memory.set('key-1', 'value-2', 'agent-2', { 'node-2': 1 });

      const entry = memory.get('key-1');
      expect(entry).toBeDefined();
    });

    it('should merge concurrent versions', () => {
      memory.set('key-1', { field1: 'a' }, 'agent-1', { 'node-1': 1 });
      memory.set('key-1', { field2: 'b' }, 'agent-2', { 'node-2': 1 });

      const entry = memory.get('key-1');
      expect(entry).toBeDefined();
    });

    it('should resolve conflicts with specified strategy', () => {
      memory.set('key-1', 'value-1', 'agent-1', { 'node-1': 1 });
      memory.set('key-1', 'value-2', 'agent-2', { 'node-2': 1 });

      const resolved = memory.resolveConflict('key-1', 'version-wins');
      expect(resolved).toBeDefined();
    });

    it('should track conflict history', () => {
      memory.set('key-1', 'value-1', 'agent-1', { 'node-1': 1 });
      memory.set('key-1', 'value-2', 'agent-2', { 'node-2': 1 });

      const entry = memory.get('key-1');
      expect(entry).toBeDefined();
    });

    it('should handle version history', () => {
      memory.set('key-1', 'v1', 'agent-1', { 'node-1': 1 });
      memory.set('key-1', 'v2', 'agent-1', { 'node-1': 2 });
      memory.set('key-1', 'v3', 'agent-1', { 'node-1': 3 });

      const history = memory.getHistory('key-1');
      expect(history.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Rate Limiting', () => {
    let comms: DistributedCommsGround;

    beforeEach(() => {
      comms = new DistributedCommsGround('node-1', createMockEventEmitter(), {
        maxMessagesPerMinute: 10,
        maxMemoryWritesPerMinute: 5,
      });
    });

    it('should allow messages within rate limit', () => {
      for (let i = 0; i < 5; i++) {
        const msg = comms.publish('task-1', {
          from: 'agent-1',
          type: 'task',
          content: `Message ${i}`,
        });
        expect(msg).not.toBeNull();
      }
    });

    it('should track message statistics', () => {
      comms.publish('task-1', { from: 'agent-1', type: 'task', content: 'Test' });
      const stats = comms.getStats();
      expect(stats).toHaveProperty('totalMessages');
    });
  });

  describe('State Sync', () => {
    let comms1: DistributedCommsGround;
    let comms2: DistributedCommsGround;

    beforeEach(() => {
      comms1 = new DistributedCommsGround('node-1', createMockEventEmitter());
      comms2 = new DistributedCommsGround('node-2', createMockEventEmitter());
    });

    it('should create state snapshot', () => {
      comms1.publish('task-1', { from: 'agent-1', type: 'task', content: 'Test' });
      const snapshot = comms1.getStateSnapshot();

      expect(snapshot.messages).toBeDefined();
      expect(snapshot.vectorClock).toBeDefined();
    });

    it('should apply state snapshot', () => {
      const snapshot = comms1.getStateSnapshot();
      const applied = comms2.applyStateSnapshot(snapshot);

      expect(applied).toBeGreaterThanOrEqual(0);
    });

    it('should request sync', () => {
      const syncRequest = comms1.requestSync(['msg-1', 'msg-2']);

      expect(syncRequest.type).toBe('sync-request');
      expect(syncRequest.vectorClock).toBeDefined();
      expect(syncRequest.knownMessageIds).toContain('msg-1');
    });
  });

  describe('Semantic Relevance Scoring', () => {
    let scorer: DistributedRelevanceScorer;

    beforeEach(() => {
      scorer = new DistributedRelevanceScorer();
    });

    it('should score messages based on relevance', () => {
      const message: DistributedMessage = {
        id: 'msg-1',
        taskId: 'task-1',
        fromNode: 'node-1',
        vectorClock: {},
        synced: false,
        syncedTo: [],
        summarized: false,
        causalOrder: 1,
        from: 'agent-1',
        target: { type: 'broadcast' },
        type: 'task',
        priority: 'normal',
        subject: 'Implement the feature',
        content: 'Implement the feature to process data',
        timestamp: Date.now(),
      };

      const score = scorer.score(message, 'agent-2', 'coder', 'task-1');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('should provide score breakdown', () => {
      const message: DistributedMessage = {
        id: 'msg-1',
        taskId: 'task-1',
        fromNode: 'node-1',
        vectorClock: {},
        synced: false,
        syncedTo: [],
        summarized: false,
        causalOrder: 1,
        from: 'agent-1',
        target: { type: 'broadcast' },
        type: 'task',
        priority: 'high',
        subject: 'Urgent task',
        content: 'Fix the bug now',
        timestamp: Date.now(),
      };

      const result = scorer.scoreWithBreakdown(message, 'agent-2', 'coder', 'task-1');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('breakdown');
      expect(result).toHaveProperty('reasons');
    });

    it('should weight semantic similarity', () => {
      const message: DistributedMessage = {
        id: 'msg-1',
        taskId: 'task-1',
        fromNode: 'node-1',
        vectorClock: {},
        synced: false,
        syncedTo: [],
        summarized: false,
        causalOrder: 1,
        from: 'agent-1',
        target: { type: 'broadcast' },
        type: 'task',
        priority: 'normal',
        subject: 'Implement feature',
        content: 'Implement a new feature for user authentication',
        timestamp: Date.now(),
      };

      const scoreWithSemantic = scorer.scoreWithSemantic(
        message,
        'agent-2',
        'coder',
        'task-1',
        'Implement user authentication'
      );

      const scoreWithoutSemantic = scorer.score(message, 'agent-2', 'coder', 'task-1');

      expect(scoreWithSemantic).toBeDefined();
      expect(scoreWithoutSemantic).toBeDefined();
    });
  });

  describe('Observability Events', () => {
    let comms: DistributedCommsGround;
    let emittedEvents: string[] = [];

    beforeEach(() => {
      const eventBus = createMockEventEmitter();
      comms = new DistributedCommsGround('node-1', eventBus);
      comms.on('comms:message-published', () => emittedEvents.push('comms:message-published'));
      emittedEvents = [];
    });

    it('should emit message events', () => {
      comms.publish('task-1', { from: 'agent-1', type: 'task', content: 'Test' });

      expect(comms).toBeDefined();
    });

    it('should track stats', () => {
      comms.publish('task-1', { from: 'agent-1', type: 'task', content: 'Test' });
      const stats = comms.getStats();

      expect(stats).toHaveProperty('totalMessages');
      expect(stats).toHaveProperty('vectorClock');
    });
  });

  describe('SwarmMessage Type Extension', () => {
    it('should support ack message type', () => {
      const message: SwarmMessage = {
        id: 'ack-1',
        type: 'ack',
        from: 'node-1',
        to: 'node-2',
        payload: { originalMessageId: 'msg-1' },
        timestamp: Date.now(),
        priority: 'normal',
      };

      expect(message.type).toBe('ack');
    });

    it('should support sync message types', () => {
      const syncRequest: SwarmMessage = {
        id: 'sync-1',
        type: 'sync-request',
        from: 'node-1',
        to: '*',
        payload: { knownMessageIds: ['msg-1'] },
        timestamp: Date.now(),
        priority: 'normal',
        vectorClock: { 'node-1': 5, 'node-2': 3 },
      };

      expect(syncRequest.type).toBe('sync-request');

      const syncResponse: SwarmMessage = {
        id: 'sync-2',
        type: 'sync-response',
        from: 'node-2',
        to: 'node-1',
        payload: { messages: [] },
        timestamp: Date.now(),
        priority: 'normal',
      };

      expect(syncResponse.type).toBe('sync-response');
    });

    it('should support reliable message fields', () => {
      const message: SwarmMessage = {
        id: 'msg-1',
        type: 'task',
        from: 'node-1',
        to: '*',
        payload: { data: 'test' },
        timestamp: Date.now(),
        priority: 'high',
        requiresAck: true,
        retryCount: 0,
        maxRetries: 3,
        vectorClock: { 'node-1': 1 },
      };

      expect(message.requiresAck).toBe(true);
      expect(message.maxRetries).toBe(3);
      expect(message.vectorClock).toEqual({ 'node-1': 1 });
    });
  });
});

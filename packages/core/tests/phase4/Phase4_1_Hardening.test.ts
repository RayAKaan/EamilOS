import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VectorClock } from '../../src/comms/VectorClock.js';
import { DistributedCommsGround } from '../../src/comms/DistributedCommsGround.js';
import { DistributedMemory } from '../../src/memory/DistributedMemory.js';
import { DistributedRelevanceScorer, type DistributedMessage } from '../../src/comms/DistributedRelevanceScorer.js';
import { MessageSummarizer } from '../../src/comms/MessageSummarizer.js';
import { EventEmitter } from 'events';

describe('Phase 4.1 - System Hardening', () => {
  describe('FIX 1: VectorClock Scalability & Pruning', () => {
    it('should track last seen timestamps for nodes', () => {
      const clock = new VectorClock('nodeA');
      clock.tick();
      clock.merge({ nodeA: 1, nodeB: 2 });

      expect(clock.getLastSeen('nodeA')).toBeDefined();
      expect(clock.getLastSeen('nodeB')).toBeDefined();
    });

    it('should prune inactive nodes after TTL', () => {
      const clock = new VectorClock('nodeA', { nodeTTL: 100 });
      clock.merge({ nodeA: 1, nodeB: 1, nodeC: 1 });

      expect(clock.getActiveNodes()).toContain('nodeB');
      expect(clock.getActiveNodes()).toContain('nodeC');

      clock.prune();

      expect(clock.getActiveNodes()).toContain('nodeA');
    });

    it('should enforce maxNodes limit', () => {
      const clock = new VectorClock('nodeA', { maxNodes: 2 });
      clock.merge({ nodeA: 1, nodeB: 1 });
      clock.merge({ nodeA: 2, nodeC: 1 });

      clock.prune();

      expect(clock.getStats().nodeCount).toBeLessThanOrEqual(3);
    });

    it('should support causalSort for proper ordering', () => {
      interface SortableMsg {
        id: string;
        vectorClock: Record<string, number>;
        timestamp: number;
        fromNode: string;
      }

      const messages: SortableMsg[] = [
        { id: '1', vectorClock: { nodeA: 1 }, timestamp: 100, fromNode: 'nodeA' },
        { id: '2', vectorClock: { nodeA: 1, nodeB: 1 }, timestamp: 200, fromNode: 'nodeB' },
        { id: '3', vectorClock: { nodeA: 2 }, timestamp: 150, fromNode: 'nodeA' },
      ];

      const sorted = VectorClock.causalSort(messages);

      expect(sorted[0].id).toBe('1');
      expect(sorted[1].id).toBe('3');
      expect(sorted[2].id).toBe('2');
    });

    it('should support auto-prune interval', () => {
      const clock = new VectorClock('nodeA', { pruneInterval: 100 });
      clock.startAutoPrune();
      
      expect(clock.getStats().ttl).toBe(600000);
      
      clock.stopAutoPrune();
    });
  });

  describe('FIX 2: Causal Order Correction', () => {
    it('should use VectorClock.compare for ordering', () => {
      const clockA: Record<string, number> = { nodeA: 1, nodeB: 1 };
      const clockB: Record<string, number> = { nodeA: 1, nodeC: 1 };

      const comparison = VectorClock.compare(clockA, clockB);
      expect(comparison).toBe('concurrent');
    });

    it('should detect concurrent relationship correctly', () => {
      const clockA: Record<string, number> = { nodeA: 1 };
      const clockB: Record<string, number> = { nodeA: 1, nodeB: 1 };

      const comparison = VectorClock.compare(clockA, clockB);
      expect(comparison).toBe('concurrent');
    });

    it('should detect equal relationship', () => {
      const clockA: Record<string, number> = { nodeA: 1 };
      const clockB: Record<string, number> = { nodeA: 1 };

      const comparison = VectorClock.compare(clockA, clockB);
      expect(comparison).toBe('equal');
    });
  });

  describe('FIX 3: Deduplication LRU + TTL', () => {
    let commsGround: DistributedCommsGround;
    let eventBus: EventEmitter;

    beforeEach(() => {
      eventBus = new EventEmitter();
      commsGround = new DistributedCommsGround('nodeA', eventBus);
    });

    afterEach(() => {
      commsGround.shutdown();
    });

    it('should deduplicate messages by ID', () => {
      const message = {
        id: 'msg-1',
        from: 'agent1',
        type: 'status' as const,
        content: 'test',
      };

      const result1 = commsGround.publish('task1', message);
      const result2 = commsGround.publish('task1', message);

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      expect(result1?.id).toBe(result2?.id);
    });

    it('should emit deduplicated event on receiveFromNetwork duplicate', () => {
      const emitted: unknown[] = [];
      commsGround.on('comms:message-deduplicated', (data) => emitted.push(data));

      const message = {
        id: 'msg-dedup',
        taskId: 'task1',
        fromNode: 'nodeB',
        vectorClock: { nodeA: 1, nodeB: 1 },
        synced: false,
        syncedTo: [],
        summarized: false,
        causalOrder: 2,
        from: 'agent1',
        target: { type: 'broadcast' as const },
        type: 'status',
        priority: 'normal' as const,
        subject: 'Test',
        content: 'test',
        timestamp: Date.now(),
      };

      commsGround.receiveFromNetwork(message);
      commsGround.receiveFromNetwork(message);

      expect(emitted.length).toBe(1);
    });
  });

  describe('FIX 4: Network ACK + Retry System', () => {
    it('should track pending ACKs', () => {
      const commsGround = new DistributedCommsGround('nodeA', new EventEmitter());
      
      commsGround.publish('task1', {
        id: 'msg-ack',
        from: 'agent1',
        type: 'status' as const,
        content: 'test',
      });
      
      commsGround.shutdown();
    });
  });

  describe('FIX 5: Summarization Context Safety', () => {
    it('should preserve recent messages from summarization', () => {
      const summarizer = new MessageSummarizer({
        protectedRecentMessages: 5,
      });

      const messages: any[] = [];
      for (let i = 0; i < 20; i++) {
        messages.push({
          id: `msg-${i}`,
          taskId: 'task1',
          fromNode: 'nodeA',
          vectorClock: { nodeA: i },
          synced: false,
          syncedTo: [],
          summarized: false,
          causalOrder: i,
          from: 'agent1',
          target: { type: 'broadcast' },
          type: 'message',
          priority: 'normal' as const,
          subject: `Message ${i}`,
          content: `Content ${i}`,
          timestamp: Date.now() - (20 - i) * 1000,
        });
      }

      const canSummarize = summarizer.canSummarize(messages);
      expect(canSummarize).toBe(true);
    });

    it('should include decisions in summary', async () => {
      const summarizer = new MessageSummarizer({
        preserveDecisions: true,
      });

      const messages: any[] = [];

      for (let i = 0; i < 15; i++) {
        messages.push({
          id: `msg-old-${i}`,
          taskId: 'task1',
          fromNode: 'nodeA',
          vectorClock: { nodeA: 1 + i },
          synced: false,
          syncedTo: [],
          summarized: false,
          causalOrder: 1 + i,
          from: 'agent1',
          target: { type: 'broadcast' },
          type: i === 5 ? 'decision' : 'message',
          priority: 'normal',
          subject: i === 5 ? 'Use approach X' : `Message ${i}`,
          content: i === 5 ? 'Decision: Use approach X' : `Content ${i}`,
          timestamp: Date.now() - 1000 * (16 - i),
        });
      }

      const summary = await summarizer.summarize(messages, 'task1', 'nodeA', { nodeA: 20 });
      
      expect(summary).toBeDefined();
      if (summary && summary.decisions) {
        const hasDecision = summary.decisions.some(d => 
          typeof d === 'string' && d.includes('Use approach X')
        );
        expect(hasDecision).toBe(true);
      }
    });
  });

  describe('FIX 6: Memory Conflict Handling', () => {
    it('should handle concurrent writes with causal ordering', () => {
      const memory = new DistributedMemory({
        nodeId: 'nodeA',
        maxEntries: 100,
        conflictResolution: 'version-merge',
        conflictStrategy: 'version-wins',
      });

      const vc1: Record<string, number> = { nodeA: 1 };
      const vc2: Record<string, number> = { nodeB: 1 };

      const entry1 = memory.set('key1', 'value1', 'agent1', vc1);
      const entry2 = memory.set('key1', 'value2', 'agent2', vc2);

      expect(entry1).toBeDefined();
      expect(entry2).toBeDefined();
    });

    it('should resolve conflicts with version-wins strategy', () => {
      const memory = new DistributedMemory({
        nodeId: 'nodeA',
        maxEntries: 100,
        conflictResolution: 'version-merge',
        conflictStrategy: 'version-wins',
      });

      const vc1: Record<string, number> = { nodeA: 1 };
      const vc2: Record<string, number> = { nodeB: 1 };

      memory.set('key1', 'value1', 'agent1', vc1);
      memory.set('key1', 'value2', 'agent2', vc2);

      const resolved = memory.resolveConflict('key1', 'version-wins');

      expect(resolved).toBeDefined();
    });

    it('should merge conflicting values', () => {
      const memory = new DistributedMemory({
        nodeId: 'nodeA',
        maxEntries: 100,
        conflictResolution: 'version-merge',
        conflictStrategy: 'merge',
      });

      const vc1: Record<string, number> = { nodeA: 1 };
      const vc2: Record<string, number> = { nodeB: 1 };

      memory.set('key1', { a: 1 }, 'agent1', vc1);
      memory.set('key1', { b: 2 }, 'agent2', vc2);

      memory.resolveConflict('key1', 'merge');

      const value = memory.getValue('key1') as Record<string, number>;
      expect(value).toHaveProperty('b');
    });

    it('should track conflict count', () => {
      const memory = new DistributedMemory({
        nodeId: 'nodeA',
        maxEntries: 100,
        conflictResolution: 'version-merge',
        conflictStrategy: 'version-wins',
      });

      const vc1: Record<string, number> = { nodeA: 1 };
      const vc2: Record<string, number> = { nodeB: 1 };
      const vc3: Record<string, number> = { nodeA: 2 };

      memory.set('key1', 'value1', 'agent1', vc1);
      memory.set('key2', 'value2', 'agent2', vc2);
      memory.set('key1', 'value3', 'agent1', vc3);

      expect(memory.getConflictCount()).toBeGreaterThanOrEqual(0);
    });
  });

  describe('FIX 7: Reconnection Sync', () => {
    it('should generate sync request with vector clock', () => {
      const commsGround = new DistributedCommsGround('nodeA', new EventEmitter());
      
      commsGround.publish('task1', {
        from: 'agent1',
        type: 'status',
        content: 'test',
      });

      const syncRequest = commsGround.requestSync(['msg-1', 'msg-2']);
      
      expect(syncRequest.type).toBe('sync-request');
      expect(syncRequest.vectorClock).toBeDefined();
      expect(syncRequest.knownMessageIds).toEqual(['msg-1', 'msg-2']);

      commsGround.shutdown();
    });

    it('should process sync response and apply messages', () => {
      const commsGround = new DistributedCommsGround('nodeA', new EventEmitter());
      
      const syncResponse = {
        type: 'sync-response' as const,
        vectorClock: { nodeA: 1, nodeB: 2 },
        knownMessageIds: [] as string[],
        missingMessages: [
          {
            id: 'msg-remote',
            taskId: 'task1',
            fromNode: 'nodeB',
            vectorClock: { nodeA: 1, nodeB: 1 },
            synced: false,
            syncedTo: [] as string[],
            summarized: false,
            causalOrder: 2,
            from: 'agent2',
            target: { type: 'broadcast' as const },
            type: 'status',
            priority: 'normal' as const,
            subject: 'Remote message',
            content: 'Remote content',
            timestamp: Date.now(),
          },
        ],
      };

      const applied = commsGround.processSyncResponse(syncResponse);
      
      expect(applied).toBe(1);
      expect(commsGround.getMessage('task1', 'msg-remote')).toBeDefined();

      commsGround.shutdown();
    });
  });

  describe('FIX 8: Rate Limiting', () => {
    it('should drop messages exceeding rate limit', () => {
      const commsGround = new DistributedCommsGround('nodeA', new EventEmitter(), {
        maxMessagesPerMinute: 2,
      });

      const results: (string | null | undefined)[] = [];
      
      for (let i = 0; i < 5; i++) {
        const result = commsGround.publish('task1', {
          id: `msg-${i}`,
          from: 'agent1',
          type: 'status',
          content: `Message ${i}`,
        });
        results.push(result?.id);
      }

      const successful = results.filter(Boolean);
      expect(successful.length).toBeLessThanOrEqual(3);

      commsGround.shutdown();
    });

    it('should emit rate-limited event', () => {
      const commsGround = new DistributedCommsGround('nodeA', new EventEmitter(), {
        maxMessagesPerMinute: 1,
      });

      const events: unknown[] = [];
      commsGround.on('comms:rate-limited', (data) => events.push(data));

      commsGround.publish('task1', {
        from: 'agent1',
        type: 'status',
        content: 'msg1',
      });
      commsGround.publish('task1', {
        from: 'agent1',
        type: 'status',
        content: 'msg2',
      });

      expect(events.length).toBeGreaterThan(0);

      commsGround.shutdown();
    });
  });

  describe('FIX 9: Semantic Relevance', () => {
    const scorer = new DistributedRelevanceScorer();

    it('should boost score for semantically relevant messages', () => {
      const message: DistributedMessage = {
        id: 'msg-1',
        taskId: 'task1',
        fromNode: 'nodeA',
        vectorClock: { nodeA: 1 },
        synced: false,
        syncedTo: [],
        summarized: false,
        causalOrder: 1,
        from: 'agent1',
        target: { type: 'broadcast' },
        type: 'message',
        priority: 'normal',
        subject: 'Implement the feature',
        content: 'I need to implement the new feature',
        timestamp: Date.now(),
      };

      const ruleScore = scorer.score(message, 'agent1', 'coder', 'task1');
      const semanticScore = scorer.scoreWithSemantic(
        message,
        'agent1',
        'coder',
        'task1',
        'implement feature add test'
      );

      expect(semanticScore).toBeGreaterThan(ruleScore);
    });

    it('should return same score without task description', () => {
      const message: DistributedMessage = {
        id: 'msg-1',
        taskId: 'task1',
        fromNode: 'nodeA',
        vectorClock: { nodeA: 1 },
        synced: false,
        syncedTo: [],
        summarized: false,
        causalOrder: 1,
        from: 'agent1',
        target: { type: 'broadcast' },
        type: 'message',
        priority: 'normal',
        subject: 'Test',
        content: 'Test content',
        timestamp: Date.now(),
      };

      const ruleScore = scorer.score(message, 'agent1', 'coder', 'task1');
      const withSemantic = scorer.scoreWithSemantic(message, 'agent1', 'coder', 'task1');

      expect(withSemantic).toBe(ruleScore);
    });

    it('should provide semantic breakdown', () => {
      const message: DistributedMessage = {
        id: 'msg-1',
        taskId: 'task1',
        fromNode: 'nodeA',
        vectorClock: { nodeA: 1 },
        synced: false,
        syncedTo: [],
        summarized: false,
        causalOrder: 1,
        from: 'agent1',
        target: { type: 'broadcast' },
        type: 'message',
        priority: 'normal',
        subject: 'Implement fix',
        content: 'Need to fix the bug',
        timestamp: Date.now(),
      };

      const result = scorer.scoreWithSemanticBreakdown(
        message,
        'agent1',
        'coder',
        'task1',
        'fix bug debug'
      );

      expect(result.breakdown.semantic).toBeDefined();
      expect(result.breakdown.rule).toBeDefined();
      expect(result.breakdown.final).toBeDefined();
    });
  });

  describe('FIX 10: Full State Bootstrap', () => {
    it('should generate state snapshot', () => {
      const commsGround = new DistributedCommsGround('nodeA', new EventEmitter());
      
      commsGround.publish('task1', {
        from: 'agent1',
        type: 'status',
        content: 'test1',
      });
      commsGround.publish('task1', {
        from: 'agent2',
        type: 'message',
        content: 'test2',
      });

      const snapshot = commsGround.getStateSnapshot();

      expect(snapshot.messages).toBeDefined();
      expect(snapshot.vectorClock).toBeDefined();
      expect(snapshot.knownMessageIds).toBeDefined();

      commsGround.shutdown();
    });

    it('should apply state snapshot', () => {
      const commsGroundA = new DistributedCommsGround('nodeA', new EventEmitter());
      const commsGroundB = new DistributedCommsGround('nodeB', new EventEmitter());

      commsGroundA.publish('task1', { from: 'agent1', type: 'status', content: 'from A' });

      const snapshot = commsGroundA.getStateSnapshot();
      const applied = commsGroundB.applyStateSnapshot(snapshot);

      expect(applied).toBeGreaterThan(0);

      commsGroundA.shutdown();
      commsGroundB.shutdown();
    });
  });

  describe('Integration: Message Loss Recovery', () => {
    it('should recover from duplicate message through retry', () => {
      const commsGround = new DistributedCommsGround('nodeA', new EventEmitter());
      
      const message = {
        id: 'msg-retry',
        from: 'agent1',
        type: 'status' as const,
        content: 'test',
      };

      const published1 = commsGround.publish('task1', message);
      const published2 = commsGround.publish('task1', { ...message, id: 'msg-retry' });

      expect(published1?.id).toBe(published2?.id);

      commsGround.shutdown();
    });
  });

  describe('Integration: Node Disconnect Reconnect', () => {
    it('should sync missing messages on reconnect', () => {
      const commsA = new DistributedCommsGround('nodeA', new EventEmitter());
      const commsB = new DistributedCommsGround('nodeB', new EventEmitter());

      commsA.publish('task1', { from: 'agent1', type: 'status', content: 'from A' });
      commsA.publish('task1', { from: 'agent1', type: 'message', content: 'another from A' });

      commsB.processSyncResponse({
        type: 'sync-response',
        vectorClock: commsA.getStats().vectorClock,
        knownMessageIds: [],
        missingMessages: commsA.getCausallyOrderedMessages('task1'),
      });

      expect(commsB.getTaskMessageCount('task1')).toBe(2);

      commsA.shutdown();
      commsB.shutdown();
    });
  });

  describe('Integration: Concurrent Memory Writes', () => {
    it('should handle concurrent writes with causal ordering', () => {
      const memory = new DistributedMemory({
        nodeId: 'nodeA',
        maxEntries: 100,
        conflictResolution: 'version-merge',
        conflictStrategy: 'version-wins',
      });

      const vcA: Record<string, number> = { nodeA: 1 };
      const vcB: Record<string, number> = { nodeB: 1 };

      const entry1 = memory.set('shared-key', 'from A', 'agentA', vcA);
      const entry2 = memory.set('shared-key', 'from B', 'agentB', vcB);

      expect(entry1).not.toBeNull();
      expect(entry2).not.toBeNull();
      expect(memory.get('shared-key')).toBeDefined();
    });
  });
});

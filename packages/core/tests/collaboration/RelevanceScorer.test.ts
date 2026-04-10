import { describe, it, expect, beforeEach } from 'vitest';
import { RelevanceScorer, type MessageContext } from '../../src/collaboration/RelevanceScorer.js';

describe('RelevanceScorer', () => {
  let scorer: RelevanceScorer;

  beforeEach(() => {
    scorer = new RelevanceScorer();
  });

  describe('scoreMessage', () => {
    it('should return a score between 0 and 100', () => {
      const context: MessageContext = {};
      const result = scorer.scoreMessage('test message', context);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('should include breakdown scores', () => {
      const context: MessageContext = {};
      const result = scorer.scoreMessage('test message', context);
      expect(result.breakdown).toBeDefined();
      expect(result.breakdown.keywordMatch).toBeGreaterThanOrEqual(0);
      expect(result.breakdown.roleRelevance).toBeGreaterThanOrEqual(0);
      expect(result.breakdown.recency).toBeGreaterThanOrEqual(0);
      expect(result.breakdown.contextMatch).toBeGreaterThanOrEqual(0);
    });

    it('should give higher score for matching keywords', () => {
      const context: MessageContext = {
        keywords: ['critical', 'urgent', 'task'],
      };

      const lowMatch = scorer.scoreMessage('hello world', context);
      const highMatch = scorer.scoreMessage('this is a critical task', context);

      expect(highMatch.score).toBeGreaterThan(lowMatch.score);
    });

    it('should give higher score for role-relevant content', () => {
      const coderContext: MessageContext = {
        targetRole: 'coder',
      };

      const lowRelevance = scorer.scoreMessage('write a poem about rain', coderContext);
      const highRelevance = scorer.scoreMessage('implement a function to sort arrays', coderContext);

      expect(highRelevance.breakdown.roleRelevance).toBeGreaterThanOrEqual(
        lowRelevance.breakdown.roleRelevance
      );
    });

    it('should give higher score for recent messages', () => {
      const recentContext: MessageContext = {
        recentMessages: ['recent message 1', 'recent message 2'],
      };

      const olderContext: MessageContext = {
        recentMessages: ['old message 1', 'old message 2', 'old message 3', 'old message 4', 'old message 5'],
      };

      const recentResult = scorer.scoreMessage('test content', recentContext);
      const olderResult = scorer.scoreMessage('test content', olderContext);

      expect(recentResult.breakdown.recency).toBeGreaterThanOrEqual(
        olderResult.breakdown.recency
      );
    });

    it('should match task context when provided', () => {
      const taskContext: MessageContext = {
        currentTask: 'implement user authentication system',
      };

      const matching = scorer.scoreMessage(
        'I implemented the authentication module with JWT tokens',
        taskContext
      );
      const nonMatching = scorer.scoreMessage(
        'I wrote a function to calculate fibonacci numbers',
        taskContext
      );

      expect(matching.breakdown.contextMatch).toBeGreaterThan(
        nonMatching.breakdown.contextMatch
      );
    });

    it('should include a reason in the result', () => {
      const context: MessageContext = {};
      const result = scorer.scoreMessage('test', context);
      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(0);
    });
  });

  describe('filterByThreshold', () => {
    it('should filter messages below threshold', () => {
      const messages = [
        { message: 'critical error found', timestamp: Date.now() },
        { message: 'hello world', timestamp: Date.now() },
        { message: 'urgent task required', timestamp: Date.now() },
      ];

      const context: MessageContext = {
        keywords: ['critical', 'urgent'],
      };

      const filtered = scorer.filterByThreshold(messages, context, 50);

      expect(filtered.length).toBeLessThanOrEqual(messages.length);
      for (const item of filtered) {
        expect(item.relevance).toBeGreaterThanOrEqual(50);
      }
    });

    it('should return empty array for no matching messages', () => {
      const messages = [
        { message: 'xyz abc def', timestamp: Date.now() },
      ];

      const context: MessageContext = {
        keywords: ['completely', 'different', 'words'],
      };

      const filtered = scorer.filterByThreshold(messages, context, 80);
      expect(filtered.length).toBe(0);
    });
  });

  describe('getTopMessages', () => {
    it('should return messages sorted by relevance', () => {
      const messages = [
        { message: 'low priority message', timestamp: Date.now() },
        { message: 'critical bug fix needed', timestamp: Date.now() },
        { message: 'medium priority task', timestamp: Date.now() },
      ];

      const context: MessageContext = {
        keywords: ['critical', 'bug', 'fix'],
      };

      const top = scorer.getTopMessages(messages, context, 3);

      for (let i = 1; i < top.length; i++) {
        expect(top[i - 1].relevance).toBeGreaterThanOrEqual(top[i].relevance);
      }
    });

    it('should respect maxCount limit', () => {
      const messages = [
        { message: 'message 1', timestamp: Date.now() },
        { message: 'message 2', timestamp: Date.now() },
        { message: 'message 3', timestamp: Date.now() },
        { message: 'message 4', timestamp: Date.now() },
        { message: 'message 5', timestamp: Date.now() },
      ];

      const top = scorer.getTopMessages(messages, {}, 3);
      expect(top.length).toBeLessThanOrEqual(3);
    });
  });
});

import type { AgentRole } from './AgentType.js';

export interface RelevanceScore {
  score: number;
  breakdown: {
    keywordMatch: number;
    roleRelevance: number;
    recency: number;
    contextMatch: number;
  };
  reason: string;
}

export interface MessageContext {
  currentTask?: string;
  targetRole?: AgentRole;
  recentMessages?: string[];
  keywords?: string[];
}

const ROLE_KEYWORDS: Record<AgentRole, string[]> = {
  planner: ['plan', 'task', 'breakdown', 'coordinate', 'decompose', 'strategy', 'roadmap', 'step', 'milestone'],
  coder: ['code', 'implement', 'function', 'class', 'variable', 'algorithm', 'refactor', 'bug', 'fix'],
  validator: ['test', 'validate', 'verify', 'check', 'assert', 'error', 'fail', 'pass', 'correct'],
  writer: ['document', 'write', 'readme', 'comment', 'description', 'explain', 'format'],
  reviewer: ['review', 'suggest', 'improve', 'quality', 'feedback', 'refactor', 'best practice'],
  researcher: ['research', 'find', 'search', 'analyze', 'compare', 'information', 'data'],
  executor: ['run', 'execute', 'command', 'shell', 'script', 'task', 'action'],
};

const RECENCY_DECAY_FACTOR = 0.95;

export class RelevanceScorer {
  scoreMessage(
    message: string,
    context: MessageContext
  ): RelevanceScore {
    const keywordScore = this.scoreKeywordMatch(message, context);
    const roleScore = this.scoreRoleRelevance(message, context);
    const recencyScore = this.scoreRecency(context);
    const contextScore = this.scoreContextMatch(message, context);

    const weights = {
      keywordMatch: 0.35,
      roleRelevance: 0.30,
      recency: 0.15,
      contextMatch: 0.20,
    };

    const totalScore = Math.round(
      keywordScore * weights.keywordMatch +
      roleScore * weights.roleRelevance +
      recencyScore * weights.recency +
      contextScore * weights.contextMatch
    );

    return {
      score: Math.min(100, Math.max(0, totalScore)),
      breakdown: {
        keywordMatch: keywordScore,
        roleRelevance: roleScore,
        recency: recencyScore,
        contextMatch: contextScore,
      },
      reason: this.generateReason(keywordScore, roleScore, recencyScore, contextScore),
    };
  }

  private scoreKeywordMatch(message: string, context: MessageContext): number {
    const lowerMessage = message.toLowerCase();
    const keywords = context.keywords || [];

    let matchCount = 0;
    let totalWeight = 0;

    for (const keyword of keywords) {
      const weight = this.getKeywordWeight(keyword);
      totalWeight += weight;

      if (lowerMessage.includes(keyword.toLowerCase())) {
        matchCount += weight;
      }
    }

    if (keywords.length === 0) {
      return 50;
    }

    return Math.round((matchCount / Math.max(totalWeight, 1)) * 100);
  }

  private getKeywordWeight(keyword: string): number {
    const highValueKeywords = ['critical', 'urgent', 'error', 'fail', 'blocker', 'must', 'required'];
    const mediumValueKeywords = ['important', 'should', 'need', 'task', 'execute'];

    if (highValueKeywords.includes(keyword.toLowerCase())) {
      return 3;
    }
    if (mediumValueKeywords.includes(keyword.toLowerCase())) {
      return 2;
    }
    return 1;
  }

  private scoreRoleRelevance(message: string, context: MessageContext): number {
    if (!context.targetRole) {
      return 50;
    }

    const lowerMessage = message.toLowerCase();
    const roleKeywords = ROLE_KEYWORDS[context.targetRole];

    let matches = 0;
    for (const keyword of roleKeywords) {
      if (lowerMessage.includes(keyword)) {
        matches++;
      }
    }

    const normalizedScore = (matches / roleKeywords.length) * 100;
    return Math.round(Math.min(100, normalizedScore * 1.5));
  }

  private scoreRecency(context: MessageContext): number {
    if (!context.recentMessages || context.recentMessages.length === 0) {
      return 50;
    }

    const latestMessage = context.recentMessages[context.recentMessages.length - 1];
    if (!latestMessage) {
      return 50;
    }

    const baseScore = 80;
    const decay = Math.pow(RECENCY_DECAY_FACTOR, context.recentMessages.length - 1);
    return Math.round(baseScore * decay);
  }

  private scoreContextMatch(message: string, context: MessageContext): number {
    if (!context.currentTask) {
      return 50;
    }

    const lowerMessage = message.toLowerCase();
    const lowerTask = context.currentTask.toLowerCase();

    const taskWords = lowerTask.split(/\s+/).filter(w => w.length > 3);
    let matches = 0;

    for (const word of taskWords) {
      if (lowerMessage.includes(word)) {
        matches++;
      }
    }

    if (taskWords.length === 0) {
      return 50;
    }

    return Math.round((matches / taskWords.length) * 100);
  }

  private generateReason(
    keyword: number,
    role: number,
    recency: number,
    context: number
  ): string {
    const reasons: string[] = [];

    if (keyword >= 70) reasons.push('strong keyword match');
    else if (keyword < 30) reasons.push('weak keyword match');

    if (role >= 70) reasons.push('highly relevant to role');
    else if (role < 30) reasons.push('not relevant to role');

    if (recency >= 70) reasons.push('recent message');
    else if (recency < 40) reasons.push('older message');

    if (context >= 70) reasons.push('matches current task');
    else if (context < 30) reasons.push('does not match task');

    return reasons.length > 0 ? reasons.join(', ') : 'neutral relevance';
  }

  filterByThreshold(
    messages: Array<{ message: string; timestamp: number }>,
    context: MessageContext,
    threshold: number = 50
  ): Array<{ message: string; timestamp: number; relevance: number }> {
    return messages
      .map(msg => ({
        ...msg,
        relevance: this.scoreMessage(msg.message, context).score,
      }))
      .filter(msg => msg.relevance >= threshold)
      .sort((a, b) => b.relevance - a.relevance);
  }

  getTopMessages(
    messages: Array<{ message: string; timestamp: number }>,
    context: MessageContext,
    maxCount: number = 5
  ): Array<{ message: string; timestamp: number; relevance: number }> {
    return this.filterByThreshold(messages, context, 0)
      .slice(0, maxCount);
  }
}

import type { AgentRole } from '../collaboration/AgentType.js';

export interface DistributedMessage {
  id: string;
  taskId: string;
  fromNode: string;
  vectorClock: Record<string, number>;
  synced: boolean;
  syncedTo: string[];
  receivedFrom?: string;
  summarized: boolean;
  originalLength?: number;
  partOfSummary?: string;
  causalOrder: number;
  compressed?: boolean;
  relevanceScore?: number;
  from: string;
  target: { type: 'broadcast' | 'direct' | 'role' | 'orchestrator'; agentId?: string; role?: AgentRole };
  type: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  subject: string;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

const ROLE_TYPE_WEIGHTS: Record<AgentRole, Record<string, number>> = {
  planner: { context: 1.0, error: 0.9, feedback: 0.8, decision: 0.7, result: 0.3, plan: 0.2, status: 0.1 },
  coder: { plan: 1.0, feedback: 0.95, correction: 0.9, decision: 0.8, error: 0.5, result: 0.3, status: 0.1 },
  validator: { result: 1.0, artifact: 0.95, correction: 0.9, plan: 0.7, error: 0.5, status: 0.1 },
  writer: { plan: 1.0, result: 0.9, artifact: 0.8, feedback: 0.7, status: 0.1 },
  reviewer: { result: 1.0, artifact: 0.95, plan: 0.7, correction: 0.5, status: 0.1 },
  researcher: { context: 1.0, plan: 0.8, result: 0.5, question: 0.9, status: 0.1 },
  executor: { plan: 1.0, feedback: 0.8, decision: 0.7, status: 0.1 },
};

const SEMANTIC_WEIGHT = 0.3;
const RULE_WEIGHT = 0.7;

export class DistributedRelevanceScorer {
  score(
    message: DistributedMessage,
    agentId: string,
    agentType: AgentRole,
    _currentTaskId: string
  ): number {
    return this.scoreWithSemantic(message, agentId, agentType, _currentTaskId, undefined);
  }

  scoreWithSemantic(
    message: DistributedMessage,
    agentId: string,
    agentType: AgentRole,
    _currentTaskId: string,
    taskDescription?: string
  ): number {
    const ruleScore = this.computeRuleScore(message, agentId, agentType);
    
    if (!taskDescription) {
      return ruleScore;
    }

    const semanticScore = this.computeSemanticScore(message, taskDescription);
    
    const finalScore = (ruleScore * RULE_WEIGHT) + (semanticScore * SEMANTIC_WEIGHT);
    
    return Math.max(0, Math.min(100, finalScore));
  }

  private computeRuleScore(
    message: DistributedMessage,
    agentId: string,
    agentType: AgentRole
  ): number {
    let score = 0;

    const ageMs = Date.now() - message.timestamp;
    const ageMinutes = ageMs / 60000;
    if (ageMinutes < 0.5) score += 20;
    else if (ageMinutes < 2) score += 17;
    else if (ageMinutes < 5) score += 14;
    else if (ageMinutes < 15) score += 10;
    else if (ageMinutes < 60) score += 5;
    else score += 2;

    const priorityScores: Record<string, number> = {
      critical: 15, high: 12, normal: 7, low: 3
    };
    score += priorityScores[message.priority] || 7;

    if (message.target.type === 'direct' && message.target.agentId === agentId) {
      score += 25;
    } else if (message.target.type === 'role' && message.target.role === agentType) {
      score += 15;
    } else if (message.target.type === 'broadcast') {
      score += 5;
    }

    const typeWeights = ROLE_TYPE_WEIGHTS[agentType];
    if (typeWeights) {
      const weight = typeWeights[message.type] || 0.1;
      score += Math.round(15 * weight);
    }

    score += Math.min(10, Math.round(message.causalOrder / 5));

    if (message.metadata?.iteration) {
      score += 10;
    }

    if (message.type === 'summary') score += 8;
    if (message.type === 'decision') score += 5;

    if (message.compressed) score -= 3;
    if (message.summarized) score -= 100;

    return Math.max(0, Math.min(100, score));
  }

  private computeSemanticScore(message: DistributedMessage, taskDescription: string): number {
    const messageWords = this.tokenize(message.content);
    const messageSubject = this.tokenize(message.subject);
    const taskWords = this.tokenize(taskDescription);

    if (taskWords.length === 0) return 50;

    const contentMatches = this.countMatches(messageWords, taskWords);
    const subjectMatches = this.countMatches(messageSubject, taskWords);

    const contentScore = (contentMatches / Math.max(messageWords.length, 1)) * 50;
    const subjectScore = (subjectMatches / Math.max(messageSubject.length, 1)) * 30;

    const keywordBonus = this.keywordBonus(message.content, taskDescription);

    return Math.min(100, contentScore + subjectScore + keywordBonus);
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2);
  }

  private countMatches(words: string[], targetWords: string[]): number {
    const targetSet = new Set(targetWords);
    let count = 0;
    for (const word of words) {
      if (targetSet.has(word)) {
        count++;
      }
    }
    return count;
  }

  private keywordBonus(content: string, taskDescription: string): number {
    const taskLower = taskDescription.toLowerCase();
    const keywords = ['implement', 'fix', 'add', 'create', 'update', 'delete', 'refactor', 'test', 'debug', 'optimize'];
    
    let bonus = 0;
    for (const keyword of keywords) {
      if (taskLower.includes(keyword) && content.toLowerCase().includes(keyword)) {
        bonus += 5;
      }
    }
    
    return Math.min(20, bonus);
  }

  scoreWithBreakdown(
    message: DistributedMessage,
    agentId: string,
    agentType: AgentRole,
    _currentTaskId: string
  ): { score: number; breakdown: Record<string, number>; reasons: string[] } {
    return this.scoreWithSemanticBreakdown(message, agentId, agentType, _currentTaskId, undefined);
  }

  scoreWithSemanticBreakdown(
    message: DistributedMessage,
    agentId: string,
    agentType: AgentRole,
    _currentTaskId: string,
    taskDescription?: string
  ): { score: number; breakdown: Record<string, number>; reasons: string[] } {
    const breakdown: Record<string, number> = {};
    const reasons: string[] = [];

    const ageMs = Date.now() - message.timestamp;
    const ageMinutes = ageMs / 60000;
    if (ageMinutes < 0.5) breakdown.recency = 20;
    else if (ageMinutes < 2) breakdown.recency = 17;
    else if (ageMinutes < 5) breakdown.recency = 14;
    else if (ageMinutes < 15) breakdown.recency = 10;
    else if (ageMinutes < 60) breakdown.recency = 5;
    else breakdown.recency = 2;

    if (breakdown.recency >= 15) reasons.push('recent message');
    else if (breakdown.recency <= 5) reasons.push('older message');

    const priorityScores: Record<string, number> = {
      critical: 15, high: 12, normal: 7, low: 3
    };
    breakdown.priority = priorityScores[message.priority] || 7;

    if (message.priority === 'critical') reasons.push('critical priority');
    else if (message.priority === 'high') reasons.push('high priority');

    let targetScore = 0;
    if (message.target.type === 'direct' && message.target.agentId === agentId) {
      targetScore = 25;
      reasons.push('directly addressed to this agent');
    } else if (message.target.type === 'role' && message.target.role === agentType) {
      targetScore = 15;
      reasons.push(`targeted to role: ${agentType}`);
    } else if (message.target.type === 'broadcast') {
      targetScore = 5;
    }
    breakdown.target = targetScore;

    const typeWeights = ROLE_TYPE_WEIGHTS[agentType];
    breakdown.roleRelevance = typeWeights ? Math.round(15 * (typeWeights[message.type] || 0.1)) : 0;

    breakdown.causal = Math.min(10, Math.round(message.causalOrder / 5));

    breakdown.iteration = message.metadata?.iteration ? 10 : 0;

    if (message.type === 'summary') breakdown.bonus = 8;
    else if (message.type === 'decision') breakdown.bonus = 5;
    else breakdown.bonus = 0;

    if (message.compressed) breakdown.penalty = -3;
    else if (message.summarized) breakdown.penalty = -100;
    else breakdown.penalty = 0;

    const ruleScore = Math.max(0, Math.min(100,
      breakdown.recency +
      breakdown.priority +
      breakdown.target +
      breakdown.roleRelevance +
      breakdown.causal +
      breakdown.iteration +
      breakdown.bonus +
      breakdown.penalty
    ));

    if (taskDescription) {
      breakdown.semantic = this.computeSemanticScore(message, taskDescription);
      breakdown.rule = ruleScore;
      breakdown.final = (ruleScore * RULE_WEIGHT) + (breakdown.semantic * SEMANTIC_WEIGHT);
      reasons.push(`semantic similarity: ${Math.round(breakdown.semantic)}%`);
    }

    const score = taskDescription
      ? Math.max(0, Math.min(100, breakdown.final || ruleScore))
      : ruleScore;

    return { score, breakdown, reasons };
  }
}

export const distributedRelevanceScorer = new DistributedRelevanceScorer();

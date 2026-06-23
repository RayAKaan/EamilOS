import { RelevanceScorer, type MessageContext } from './RelevanceScorer.js';
import type { AgentRole } from './AgentType.js';

export interface CommsMessage {
  id: string;
  sender: string;
  recipient?: string | 'broadcast';
  role: AgentRole;
  content: string;
  timestamp: number;
  type: 'message' | 'status' | 'request' | 'response' | 'delegation';
  metadata?: Record<string, unknown>;
  compressed?: boolean;
}

export interface CommsGroundConfig {
  maxMessages: number;
  maxTokensPerAgent: number;
  compressionThreshold: number;
  relevanceThreshold: number;
}

export interface FilteredContext {
  messages: CommsMessage[];
  totalTokens: number;
  compressionRatio: number;
  droppedMessages: number;
}

const DEFAULT_CONFIG: CommsGroundConfig = {
  maxMessages: 50,
  maxTokensPerAgent: 8000,
  compressionThreshold: 0.7,
  relevanceThreshold: 40,
};

export class CommsGround {
  private messages: CommsMessage[] = [];
  private config: CommsGroundConfig;
  private scorer: RelevanceScorer;
  private agentContext: Map<string, MessageContext> = new Map();

  constructor(config: Partial<CommsGroundConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.scorer = new RelevanceScorer();
  }

  addMessage(message: Omit<CommsMessage, 'id' | 'timestamp'>): string {
    const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const fullMessage: CommsMessage = {
      ...message,
      id,
      timestamp: Date.now(),
    };

    this.messages.push(fullMessage);

    if (this.messages.length > this.config.maxMessages * 2) {
      this.pruneOldMessages();
    }

    return id;
  }

  getMessages(
    forRole: AgentRole,
    sender?: string,
    since?: number
  ): CommsMessage[] {
    let filtered = this.messages;

    if (sender) {
      filtered = filtered.filter(m => m.sender === sender);
    }

    if (since) {
      filtered = filtered.filter(m => m.timestamp >= since);
    }

    return filtered.filter(m =>
      m.recipient === 'broadcast' ||
      m.recipient === forRole ||
      m.sender === forRole ||
      !m.recipient
    );
  }

  getContextForAgent(
    agentRole: AgentRole,
    agentId: string,
    maxTokens?: number
  ): FilteredContext {
    const context = this.getOrCreateContext(agentRole, agentId);
    const allMessages = this.getMessages(agentRole);

    if (allMessages.length === 0) {
      return {
        messages: [],
        totalTokens: 0,
        compressionRatio: 1,
        droppedMessages: 0,
      };
    }

    const scoredMessages = allMessages.map(msg => ({
      ...msg,
      relevance: this.scorer.scoreMessage(msg.content, context),
    }));

    scoredMessages.sort((a, b) => b.relevance.score - a.relevance.score);

    const tokenBudget = maxTokens || this.config.maxTokensPerAgent;
    const selectedMessages: CommsMessage[] = [];
    let totalTokens = 0;
    let droppedCount = 0;

    for (const msg of scoredMessages) {
      const msgTokens = this.estimateTokens(msg.content);

      if (totalTokens + msgTokens <= tokenBudget || selectedMessages.length === 0) {
        selectedMessages.push(msg);
        totalTokens += msgTokens;
      } else if (msg.relevance.score >= this.config.relevanceThreshold) {
        const compressed = this.compressMessage(msg);
        if (totalTokens + this.estimateTokens(compressed) <= tokenBudget) {
          selectedMessages.push({ ...msg, content: compressed, compressed: true });
          totalTokens += this.estimateTokens(compressed);
        } else {
          droppedCount++;
        }
      } else {
        droppedCount++;
      }
    }

    selectedMessages.sort((a, b) => a.timestamp - b.timestamp);

    const originalTokens = scoredMessages.reduce(
      (sum, msg) => sum + this.estimateTokens(msg.content),
      0
    );

    return {
      messages: selectedMessages,
      totalTokens,
      compressionRatio: originalTokens > 0 ? totalTokens / originalTokens : 1,
      droppedMessages: droppedCount,
    };
  }

  private getOrCreateContext(agentRole: AgentRole, agentId: string): MessageContext {
    const key = `${agentRole}_${agentId}`;
    if (!this.agentContext.has(key)) {
      this.agentContext.set(key, {
        targetRole: agentRole,
        recentMessages: this.messages.slice(-5).map(m => m.content),
      });
    }
    return this.agentContext.get(key)!;
  }

  updateAgentContext(agentId: string, role: AgentRole, updates: Partial<MessageContext>): void {
    const key = `${role}_${agentId}`;
    const existing = this.agentContext.get(key) || { targetRole: role };
    this.agentContext.set(key, { ...existing, ...updates });
  }

  private compressMessage(message: CommsMessage): string {
    const lines = message.content.split('\n').filter(l => l.trim());

    if (lines.length <= 3) {
      return message.content;
    }

    const summary = lines.slice(0, 2);
    summary.push(`[${lines.length - 4} lines compressed]`);
    summary.push(lines[lines.length - 1]);

    return summary.join('\n');
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private pruneOldMessages(): void {
    const keepCount = Math.floor(this.config.maxMessages * 0.8);
    if (this.messages.length > keepCount) {
      const sorted = [...this.messages].sort((a, b) => b.timestamp - a.timestamp);
      this.messages = sorted.slice(0, keepCount);
    }
  }

  getMessageCount(): number {
    return this.messages.length;
  }

  clear(olderThan?: number): number {
    const before = this.messages.length;
    if (olderThan) {
      const cutoff = Date.now() - olderThan;
      this.messages = this.messages.filter(m => m.timestamp >= cutoff);
    } else {
      this.messages = [];
    }
    return before - this.messages.length;
  }

  getMessagesForAgent(agentId: string, sessionId: string, since?: number): CommsMessage[] {
    return this.getMessages('planner', agentId, since).filter(m => {
      const msgSessionId = m.metadata?.sessionId;
      return msgSessionId === sessionId;
    });
  }

  getRecentMessages(count: number, forRole?: AgentRole): CommsMessage[] {
    const sorted = [...this.messages].sort((a, b) => b.timestamp - a.timestamp);
    let filtered = sorted;

    if (forRole) {
      filtered = sorted.filter(m =>
        m.recipient === 'broadcast' ||
        m.recipient === forRole ||
        m.sender === forRole
      );
    }

    return filtered.slice(0, count);
  }

  searchMessages(query: string, forRole?: AgentRole): CommsMessage[] {
    const lowerQuery = query.toLowerCase();
    return this.messages.filter(m => {
      const matchesContent = m.content.toLowerCase().includes(lowerQuery);
      const matchesRole = !forRole || m.sender === forRole || m.recipient === forRole;
      return matchesContent && matchesRole;
    });
  }
}

let globalCommsGround: CommsGround | null = null;

export function initCommsGround(config?: Partial<CommsGroundConfig>): CommsGround {
  globalCommsGround = new CommsGround(config);
  return globalCommsGround;
}

export function getCommsGround(): CommsGround {
  if (!globalCommsGround) {
    return initCommsGround();
  }
  return globalCommsGround;
}

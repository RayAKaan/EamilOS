import type { AgentRole } from '../collaboration/AgentType.js';
import { generateUUID } from '../distributed/protocol.js';

export interface SummaryMessage {
  id: string;
  taskId: string;
  fromNode: string;
  vectorClock: Record<string, number>;
  synced: boolean;
  syncedTo: string[];
  summarized: boolean;
  causalOrder: number;
  from: string;
  target: { type: 'broadcast' | 'direct' | 'role' | 'orchestrator'; agentId?: string; role?: AgentRole };
  type: 'summary';
  priority: 'critical' | 'high' | 'normal' | 'low';
  subject: string;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
  summarizedMessageIds: string[];
  summarizedCount: number;
  summarizedTimeRange: { earliest: number; latest: number };
  dependencyChains: string[];
  decisions: string[];
  unresolvedIssues: string[];
  referencedArtifacts: string[];
}

export interface SummarizableMessage {
  id: string;
  taskId: string;
  fromNode: string;
  vectorClock: Record<string, number>;
  synced: boolean;
  syncedTo: string[];
  summarized: boolean;
  partOfSummary?: string;
  causalOrder: number;
  from: string;
  target: { type: 'broadcast' | 'direct' | 'role' | 'orchestrator'; agentId?: string; role?: AgentRole };
  type: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  subject: string;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface MessageSummarizerConfig {
  maxSummaryLength?: number;
  summarizationTimeoutMs?: number;
  model?: string;
  protectedRecentMessages?: number;
  preserveDecisions?: boolean;
  preserveDependencies?: boolean;
  preserveArtifacts?: boolean;
}

interface ResolvedConfig {
  maxSummaryLength: number;
  summarizationTimeoutMs: number;
  model?: string;
  protectedRecentMessages: number;
  preserveDecisions: boolean;
  preserveDependencies: boolean;
  preserveArtifacts: boolean;
}

export class MessageSummarizer {
  private config: ResolvedConfig;
  private _agentRunner: unknown = null;

  constructor(config: MessageSummarizerConfig = {}) {
    this.config = {
      maxSummaryLength: config.maxSummaryLength ?? 500,
      summarizationTimeoutMs: config.summarizationTimeoutMs ?? 30000,
      model: config.model,
      protectedRecentMessages: config.protectedRecentMessages ?? 10,
      preserveDecisions: config.preserveDecisions ?? true,
      preserveDependencies: config.preserveDependencies ?? true,
      preserveArtifacts: config.preserveArtifacts ?? true,
    };
  }

  configure(agentRunner: unknown): void {
    this._agentRunner = agentRunner;
  }

  getAgentRunner(): unknown {
    return this._agentRunner;
  }

  canSummarize(messages: SummarizableMessage[]): boolean {
    const protectedTypes = new Set(['error', 'decision', 'summary', 'artifact']);
    const candidates = messages.filter(m =>
      !m.summarized &&
      !protectedTypes.has(m.type) &&
      m.priority !== 'critical'
    );
    return candidates.length >= 10;
  }

  async summarize(
    messages: SummarizableMessage[],
    taskId: string,
    nodeId: string,
    vectorClock: Record<string, number>
  ): Promise<SummaryMessage | null> {
    const protectedTypes = new Set(['error', 'decision', 'summary', 'artifact']);

    const protectedCount = this.config.protectedRecentMessages;
    const candidates = messages.filter(m =>
      !m.summarized &&
      !protectedTypes.has(m.type) &&
      m.priority !== 'critical'
    );

    const eligibleForSummarize = candidates.slice(0, candidates.length - protectedCount);

    if (eligibleForSummarize.length < 10) {
      return null;
    }

    const toSummarize = eligibleForSummarize.slice(0, 30);
    const summaryData = this.generateEnhancedSummary(toSummarize, messages);

    const clockSnapshot = { ...vectorClock };
    clockSnapshot[nodeId] = (clockSnapshot[nodeId] || 0) + 1;
    const causalOrder = Object.values(clockSnapshot).reduce((sum, v) => sum + v, 0);

    const summary: SummaryMessage = {
      id: generateUUID(),
      taskId,
      fromNode: nodeId,
      vectorClock: clockSnapshot,
      synced: false,
      syncedTo: [],
      summarized: false,
      causalOrder,
      from: 'system:summarizer',
      target: { type: 'broadcast' },
      type: 'summary',
      priority: 'normal',
      subject: `Summary of ${toSummarize.length} messages (${this.formatTimeRange(toSummarize)})`,
      content: summaryData.content,
      timestamp: Date.now(),
      metadata: {
        model: this.config.model || 'fallback',
        tags: ['auto-summary'],
        summaryType: 'enhanced',
      },
      summarizedMessageIds: toSummarize.map(m => m.id),
      summarizedCount: toSummarize.length,
      summarizedTimeRange: {
        earliest: toSummarize[0].timestamp,
        latest: toSummarize[toSummarize.length - 1].timestamp,
      },
      dependencyChains: summaryData.dependencyChains,
      decisions: summaryData.decisions,
      unresolvedIssues: summaryData.unresolvedIssues,
      referencedArtifacts: summaryData.referencedArtifacts,
    };

    return summary;
  }

  private generateEnhancedSummary(
    messages: SummarizableMessage[],
    allMessages: SummarizableMessage[]
  ): {
    content: string;
    dependencyChains: string[];
    decisions: string[];
    unresolvedIssues: string[];
    referencedArtifacts: string[];
  } {
    const lines: string[] = [
      `[Auto-summarized from ${messages.length} messages]`,
      '',
    ];

    const dependencyChains: string[] = [];
    const decisions: string[] = [];
    const unresolvedIssues: string[] = [];
    const referencedArtifacts: string[] = [];

    const protectedTypes = new Set(['error', 'decision', 'summary', 'artifact']);

    const recentMessages = allMessages
      .filter(m => !protectedTypes.has(m.type))
      .slice(-this.config.protectedRecentMessages);

    for (const msg of messages) {
      if (msg.metadata?.dependencies) {
        dependencyChains.push(...(msg.metadata.dependencies as string[]));
      }
      if (msg.type === 'decision') {
        decisions.push(`[${msg.from}] ${msg.subject || msg.content.slice(0, 100)}`);
      }
      if (msg.type === 'error' || msg.type === 'question') {
        unresolvedIssues.push(`[${msg.from}] ${msg.subject || msg.content.slice(0, 100)}`);
      }
      if (msg.type === 'artifact') {
        referencedArtifacts.push(msg.metadata?.artifactName as string || msg.subject);
      }
    }

    const byType: Record<string, string[]> = {};
    for (const msg of messages) {
      if (!byType[msg.type]) {
        byType[msg.type] = [];
      }
      const preview = msg.content.length > 200
        ? msg.content.slice(0, 200) + '...'
        : msg.content;
      byType[msg.type].push(`- ${msg.from}: ${preview}`);
    }

    lines.push('## Messages by Type');
    for (const [type, items] of Object.entries(byType)) {
      lines.push(`### ${type.toUpperCase()} (${items.length})`);
      for (const item of items.slice(0, 5)) {
        lines.push(item);
      }
      if (items.length > 5) {
        lines.push(`  ... and ${items.length - 5} more`);
      }
      lines.push('');
    }

    if (this.config.preserveDecisions && decisions.length > 0) {
      lines.push('## Key Decisions (preserved)');
      for (const decision of decisions.slice(0, 10)) {
        lines.push(`- ${decision}`);
      }
      lines.push('');
    }

    if (this.config.preserveDependencies && dependencyChains.length > 0) {
      lines.push('## Dependency Chains');
      const uniqueDeps = [...new Set(dependencyChains)];
      for (const dep of uniqueDeps.slice(0, 10)) {
        lines.push(`- ${dep}`);
      }
      lines.push('');
    }

    if (unresolvedIssues.length > 0) {
      lines.push('## Unresolved Issues');
      for (const issue of unresolvedIssues.slice(0, 10)) {
        lines.push(`- ${issue}`);
      }
      lines.push('');
    }

    if (this.config.preserveArtifacts && referencedArtifacts.length > 0) {
      lines.push('## Referenced Artifacts');
      const uniqueArtifacts = [...new Set(referencedArtifacts)];
      for (const artifact of uniqueArtifacts.slice(0, 10)) {
        lines.push(`- ${artifact}`);
      }
      lines.push('');
    }

    lines.push('## Recent Context (protected)');
    for (const msg of recentMessages.slice(0, 5)) {
      const preview = msg.content.length > 150
        ? msg.content.slice(0, 150) + '...'
        : msg.content;
      lines.push(`- [${msg.type}] ${msg.from}: ${preview}`);
    }

    const truncated = lines.join('\n');
    if (truncated.length > this.config.maxSummaryLength) {
      return {
        content: truncated.slice(0, this.config.maxSummaryLength) + '\n\n[TRUNCATED]',
        dependencyChains,
        decisions,
        unresolvedIssues,
        referencedArtifacts,
      };
    }

    return {
      content: truncated,
      dependencyChains,
      decisions,
      unresolvedIssues,
      referencedArtifacts,
    };
  }

  private formatTimeRange(messages: SummarizableMessage[]): string {
    if (messages.length === 0) return '';
    const earliest = new Date(messages[0].timestamp).toISOString().slice(11, 19);
    const latest = new Date(messages[messages.length - 1].timestamp).toISOString().slice(11, 19);
    return `${earliest} → ${latest}`;
  }

  markMessagesAsSummarized(
    messages: SummarizableMessage[],
    summaryId: string
  ): void {
    const protectedTypes = new Set(['error', 'decision', 'summary', 'artifact']);
    const protectedCount = this.config.protectedRecentMessages;

    const candidates = messages.filter(m =>
      !m.summarized &&
      !protectedTypes.has(m.type) &&
      m.priority !== 'critical'
    );

    const eligibleForSummarize = candidates.slice(0, candidates.length - protectedCount);

    for (const msg of eligibleForSummarize.slice(0, 30)) {
      msg.summarized = true;
      msg.partOfSummary = summaryId;
    }
  }
}

export const defaultMessageSummarizer = new MessageSummarizer();

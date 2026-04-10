import type { AgentRole } from './AgentType.js';
import { getAgentType } from './AgentType.js';
import type { CommsMessage } from './CommsGround.js';
import { CommsGround } from './CommsGround.js';
import { estimateTokens } from '../utils/tokenEstimator.js';

export interface ContextSection {
  id: string;
  priority: number;
  label: string;
  content: string;
  tokens: number;
  required: boolean;
  agentScope?: AgentRole[];
}

export interface TokenBudget {
  maxTokens: number;
  hardLimit: number;
  warningThreshold: number;
  reservedTokens: number;
}

export interface BuildContextOptions {
  agentRole: AgentRole;
  agentId: string;
  sessionId: string;
  commsGround?: CommsGround;
  includeHistory?: boolean;
  includeSystemPrompt?: boolean;
  customSections?: ContextSection[];
}

export interface BuiltContext {
  system: string;
  messages: string;
  totalTokens: number;
  budgetUsed: number;
  sections: ContextSection[];
  truncated: boolean;
  truncationDetails: string[];
}

const DEFAULT_BUDGET: TokenBudget = {
  maxTokens: 120000,
  hardLimit: 128000,
  warningThreshold: 0.85,
  reservedTokens: 2000,
};

export class ContextBuilder {
  private budgets: Map<string, TokenBudget> = new Map();
  private defaultBudget: TokenBudget;

  constructor(defaultBudget?: Partial<TokenBudget>) {
    this.defaultBudget = { ...DEFAULT_BUDGET, ...defaultBudget };
  }

  setBudget(projectId: string, budget: Partial<TokenBudget>): void {
    const existing = this.budgets.get(projectId) || { ...this.defaultBudget };
    this.budgets.set(projectId, { ...existing, ...budget });
  }

  getBudget(projectId: string): TokenBudget {
    return this.budgets.get(projectId) || this.defaultBudget;
  }

  buildContext(
    projectId: string,
    options: BuildContextOptions
  ): BuiltContext {
    const budget = this.getBudget(projectId);
    const availableTokens = budget.maxTokens - budget.reservedTokens;

    const sections: ContextSection[] = [];
    const truncationDetails: string[] = [];
    let totalTokens = 0;
    let truncated = false;

    if (options.includeSystemPrompt !== false) {
      const systemSection = this.buildSystemPrompt(options.agentRole, projectId);
      sections.push(systemSection);
      totalTokens += systemSection.tokens;
    }

    if (options.customSections) {
      for (const section of options.customSections) {
        if (totalTokens + section.tokens <= availableTokens) {
          sections.push(section);
          totalTokens += section.tokens;
        } else if (section.required) {
          const truncatedSection = this.truncateSection(section, availableTokens - totalTokens);
          sections.push(truncatedSection);
          totalTokens += truncatedSection.tokens;
          truncationDetails.push(`[${section.label} truncated: ${section.tokens - truncatedSection.tokens} tokens removed]`);
          truncated = true;
        }
      }
    }

    if (options.includeHistory !== false && options.commsGround) {
      const historySection = this.buildHistorySection(
        options.commsGround,
        options.agentRole,
        options.agentId,
        options.sessionId,
        availableTokens - totalTokens
      );

      if (historySection.tokens > 0) {
        if (totalTokens + historySection.tokens <= availableTokens) {
          sections.push(historySection);
          totalTokens += historySection.tokens;
        } else if (totalTokens < availableTokens) {
          const truncatedHistory = this.truncateSection(
            historySection,
            availableTokens - totalTokens
          );
          sections.push(truncatedHistory);
          totalTokens += truncatedHistory.tokens;
          truncationDetails.push(`[Communication history truncated]`);
          truncated = true;
        }
      }
    }

    if (totalTokens > budget.hardLimit) {
      throw new Error(
        `HARD LIMIT EXCEEDED: ${totalTokens} tokens > ${budget.hardLimit} limit. ` +
        `This would cause API failure. Truncation required.`
      );
    }

    if (totalTokens > budget.maxTokens * budget.warningThreshold) {
      truncationDetails.push(`[WARNING: ${Math.round((totalTokens / budget.maxTokens) * 100)}% of budget used]`);
    }

    return {
      system: sections.find(s => s.label === 'system')?.content || '',
      messages: sections.filter(s => s.label !== 'system').map(s => s.content).join('\n\n'),
      totalTokens,
      budgetUsed: Math.round((totalTokens / budget.maxTokens) * 100),
      sections,
      truncated,
      truncationDetails,
    };
  }

  private buildSystemPrompt(role: AgentRole, projectId: string): ContextSection {
    const agentType = getAgentType(role);
    const tokens = estimateTokens(agentType.systemPromptTemplate);

    return {
      id: `system_${projectId}`,
      priority: 1,
      label: 'system',
      content: `### EAMILOS SYSTEM INSTRUCTIONS

You are operating inside EamilOS (Agentic Operating Ground).
You are the ${agentType.name} agent (role: ${role}).
${agentType.description}

CORE LAWS (VIOLATION = TASK FAILURE):
1. ARTIFACT-FIRST: You MUST produce tangible files using provided tools. Chat-only output is failure.
2. CONTEXT-AWARE: You MUST read dependency outputs and workspace files before acting.
3. DOWNSTREAM-SAFE: Your outputs MUST be complete and usable by subsequent agents.
4. DECISIVE: Make reasonable assumptions. Do not ask questions. Execute.
5. BOUNDED: Stay within your role. Do not exceed your permissions.

${agentType.systemPromptTemplate}

## Token Budget Awareness
You have a LIMITED context window. Prioritize the most important information.
If you see truncation markers, the preceding context was cut due to budget constraints.`,
      tokens,
      required: true,
      agentScope: [role],
    };
  }

  private buildHistorySection(
    commsGround: CommsGround,
    agentRole: AgentRole,
    agentId: string,
    sessionId: string,
    maxTokens: number
  ): ContextSection {
    const messages = commsGround.getMessagesForAgent(agentId, sessionId);

    if (messages.length === 0) {
      return {
        id: `history_${sessionId}`,
        priority: 10,
        label: 'history',
        content: '',
        tokens: 0,
        required: false,
      };
    }

    const sortedMessages = [...messages].sort((a, b) => a.timestamp - b.timestamp);

    const relevantMessages = this.filterByRelevance(sortedMessages, agentRole, maxTokens);

    const formattedMessages = relevantMessages.map(msg => {
      const senderInfo = msg.metadata?.senderName
        ? `[${msg.metadata.senderName} (${msg.metadata.senderRole})]`
        : `[${msg.sender}]`;

      return `${senderInfo} ${msg.content}`;
    }).join('\n\n');

    const tokens = estimateTokens(formattedMessages);

    return {
      id: `history_${sessionId}`,
      priority: 10,
      label: 'history',
      content: `## Communication History\n\n${formattedMessages}`,
      tokens,
      required: false,
    };
  }

  private filterByRelevance(
    messages: CommsMessage[],
    agentRole: AgentRole,
    maxTokens: number
  ): CommsMessage[] {
    const roleKeywords = this.getRoleKeywords(agentRole);
    let tokenBudget = maxTokens;
    const selected: CommsMessage[] = [];

    for (const msg of messages) {
      const relevance = this.calculateRelevance(msg, agentRole, roleKeywords);

      if (relevance < 30 && selected.length > 3) {
        continue;
      }

      const msgTokens = estimateTokens(msg.content);

      if (msgTokens <= tokenBudget) {
        selected.push(msg);
        tokenBudget -= msgTokens;
      }
    }

    return selected;
  }

  private getRoleKeywords(role: AgentRole): string[] {
    const keywords: Record<AgentRole, string[]> = {
      planner: ['plan', 'task', 'coordinate', 'breakdown', 'roadmap'],
      coder: ['code', 'implement', 'function', 'class', 'file'],
      validator: ['test', 'validate', 'verify', 'pass', 'fail'],
      writer: ['document', 'write', 'readme', 'description'],
      reviewer: ['review', 'suggest', 'improve', 'feedback'],
      researcher: ['research', 'find', 'information', 'data'],
      executor: ['run', 'execute', 'command', 'action'],
    };
    return keywords[role] || [];
  }

  private calculateRelevance(
    msg: CommsMessage,
    agentRole: AgentRole,
    roleKeywords: string[]
  ): number {
    const content = msg.content.toLowerCase();
    let score = 50;

    if (msg.recipient === agentRole || msg.recipient === 'broadcast') {
      score += 20;
    }

    if (msg.sender === agentRole) {
      score -= 10;
    }

    for (const keyword of roleKeywords) {
      if (content.includes(keyword)) {
        score += 10;
      }
    }

    const age = Date.now() - msg.timestamp;
    const hoursOld = age / (1000 * 60 * 60);
    if (hoursOld < 1) {
      score += 15;
    } else if (hoursOld < 4) {
      score += 5;
    } else if (hoursOld > 24) {
      score -= 20;
    }

    return Math.max(0, Math.min(100, score));
  }

  private truncateSection(section: ContextSection, maxTokens: number): ContextSection {
    if (section.tokens <= maxTokens) {
      return section;
    }

    const content = section.content;
    const maxChars = maxTokens * 4;

    let truncated = content;
    if (content.length > maxChars) {
      truncated = content.slice(0, maxChars);

      const lastNewline = truncated.lastIndexOf('\n');
      if (lastNewline > maxChars * 0.8) {
        truncated = truncated.slice(0, lastNewline);
      }

      truncated += '\n\n[Content truncated due to token budget]';
    }

    return {
      ...section,
      content: truncated,
      tokens: estimateTokens(truncated),
    };
  }

  estimateTotalTokens(sections: ContextSection[]): number {
    return sections.reduce((sum, s) => sum + s.tokens, 0);
  }

  enforceHardLimit(tokens: number, projectId: string): void {
    const budget = this.getBudget(projectId);
    if (tokens > budget.hardLimit) {
      throw new Error(
        `Token limit exceeded: ${tokens} tokens would exceed hard limit of ${budget.hardLimit}`
      );
    }
  }

  getAvailableBudget(projectId: string, usedTokens: number): number {
    const budget = this.getBudget(projectId);
    return Math.max(0, budget.maxTokens - usedTokens - budget.reservedTokens);
  }
}

let globalContextBuilder: ContextBuilder | null = null;

export function initCollaborationContextBuilder(budget?: Partial<TokenBudget>): ContextBuilder {
  globalContextBuilder = new ContextBuilder(budget);
  return globalContextBuilder;
}

export function getCollaborationContextBuilder(): ContextBuilder {
  if (!globalContextBuilder) {
    return initCollaborationContextBuilder();
  }
  return globalContextBuilder;
}

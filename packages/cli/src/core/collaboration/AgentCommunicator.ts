import { CommsGround, type CommsMessage } from './CommsGround.js';
import { SharedMemory } from '../memory/SharedMemory.js';
import type { AgentRole } from './AgentType.js';
import { getAgentType } from './AgentType.js';

export interface AgentIdentity {
  id: string;
  role: AgentRole;
  name: string;
}

export interface CommunicationScope {
  projectId: string;
  sessionId: string;
  participants: AgentIdentity[];
}

export interface MessageRequest {
  recipient: string | AgentRole;
  content: string;
  type: CommsMessage['type'];
  metadata?: Record<string, unknown>;
  requiresResponse?: boolean;
  timeout?: number;
}

export interface MessageResponse {
  success: boolean;
  messageId?: string;
  content?: string;
  error?: string;
  timestamp: number;
}

export interface DelegationRequest {
  task: string;
  targetRole: AgentRole;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  deadline?: number;
  dependencies?: string[];
  context?: Record<string, unknown>;
}

export interface DelegationResult {
  success: boolean;
  taskId?: string;
  delegatedTo?: string;
  error?: string;
}

type MessageHandler = (
  message: CommsMessage,
  sender: AgentIdentity
) => Promise<void> | void;

export class AgentCommunicator {
  private commsGround: CommsGround;
  private sharedMemory: SharedMemory;
  private scopes: Map<string, CommunicationScope> = new Map();
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private pendingResponses: Map<string, {
    resolve: (response: MessageResponse) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();

  constructor(commsGround: CommsGround, sharedMemory: SharedMemory) {
    this.commsGround = commsGround;
    this.sharedMemory = sharedMemory;
  }

  createScope(
    projectId: string,
    participants: AgentIdentity[]
  ): CommunicationScope {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const scope: CommunicationScope = {
      projectId,
      sessionId,
      participants,
    };

    this.scopes.set(sessionId, scope);

    for (const participant of participants) {
      const key = `${sessionId}_${participant.id}`;
      this.handlers.set(key, new Set());
    }

    return scope;
  }

  getScope(sessionId: string): CommunicationScope | undefined {
    return this.scopes.get(sessionId);
  }

  joinScope(sessionId: string, agent: AgentIdentity): boolean {
    const scope = this.scopes.get(sessionId);
    if (!scope) {
      return false;
    }

    if (!scope.participants.find(p => p.id === agent.id)) {
      scope.participants.push(agent);
    }

    const key = `${sessionId}_${agent.id}`;
    if (!this.handlers.has(key)) {
      this.handlers.set(key, new Set());
    }

    return true;
  }

  leaveScope(sessionId: string, agentId: string): boolean {
    const scope = this.scopes.get(sessionId);
    if (!scope) {
      return false;
    }

    scope.participants = scope.participants.filter(p => p.id !== agentId);
    return true;
  }

  async sendMessage(
    sender: AgentIdentity,
    request: MessageRequest,
    sessionId: string
  ): Promise<MessageResponse> {
    const scope = this.scopes.get(sessionId);
    if (!scope) {
      return {
        success: false,
        error: 'Invalid session',
        timestamp: Date.now(),
      };
    }

    const recipientId = this.resolveRecipient(request.recipient, scope);
    if (!recipientId) {
      return {
        success: false,
        error: 'Recipient not found in scope',
        timestamp: Date.now(),
      };
    }

    const messageId = this.commsGround.addMessage({
      sender: sender.id,
      recipient: recipientId,
      role: sender.role,
      content: request.content,
      type: request.type,
      metadata: {
        ...request.metadata,
        sessionId,
        senderRole: sender.role,
        senderName: sender.name,
      },
    });

    const response: MessageResponse = {
      success: true,
      messageId,
      timestamp: Date.now(),
    };

    if (request.requiresResponse) {
      return new Promise<MessageResponse>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pendingResponses.delete(messageId);
          resolve({
            success: false,
            messageId,
            error: 'Response timeout',
            timestamp: Date.now(),
          });
        }, request.timeout || 30000);

        this.pendingResponses.set(messageId, { resolve, reject, timeout });
      });
    }

    return response;
  }

  async broadcast(
    sender: AgentIdentity,
    content: string,
    type: CommsMessage['type'],
    sessionId: string,
    metadata?: Record<string, unknown>
  ): Promise<MessageResponse> {
    const scope = this.scopes.get(sessionId);
    if (!scope) {
      return {
        success: false,
        error: 'Invalid session',
        timestamp: Date.now(),
      };
    }

    const messageId = this.commsGround.addMessage({
      sender: sender.id,
      recipient: 'broadcast',
      role: sender.role,
      content,
      type,
      metadata: {
        ...metadata,
        sessionId,
        senderRole: sender.role,
        senderName: sender.name,
        broadcast: true,
      },
    });

    return {
      success: true,
      messageId,
      timestamp: Date.now(),
    };
  }

  async delegate(
    delegator: AgentIdentity,
    request: DelegationRequest,
    sessionId: string
  ): Promise<DelegationResult> {
    const agentType = getAgentType(delegator.role);

    if (!agentType.canDelegate) {
      return {
        success: false,
        error: `${agentType.name} cannot delegate tasks`,
      };
    }

    const targetAgentType = getAgentType(request.targetRole);

    if (!targetAgentType.canReceiveDelegation) {
      return {
        success: false,
        error: `${targetAgentType.name} cannot receive delegations`,
      };
    }

    const scope = this.scopes.get(sessionId);
    if (!scope) {
      return {
        success: false,
        error: 'Invalid session',
      };
    }

    const targetParticipant = scope.participants.find(p => p.role === request.targetRole);
    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const taskContent = this.formatDelegationTask(request, delegator, taskId);

    const messageId = this.commsGround.addMessage({
      sender: delegator.id,
      recipient: targetParticipant?.id || request.targetRole,
      role: delegator.role,
      content: taskContent,
      type: 'delegation',
      metadata: {
        taskId,
        priority: request.priority || 'normal',
        deadline: request.deadline,
        dependencies: request.dependencies,
        context: request.context,
      },
    });

    this.sharedMemory.set(
      `task:${taskId}`,
      {
        id: taskId,
        task: request.task,
        delegator: delegator.id,
        delegatorRole: delegator.role,
        targetRole: request.targetRole,
        targetAgent: targetParticipant?.id,
        status: 'pending',
        priority: request.priority || 'normal',
        deadline: request.deadline,
        createdAt: Date.now(),
      },
      delegator.id,
      delegator.role,
      { sessionId, messageId }
    );

    return {
      success: true,
      taskId,
      delegatedTo: targetParticipant?.id || request.targetRole,
    };
  }

  private formatDelegationTask(
    request: DelegationRequest,
    delegator: AgentIdentity,
    taskId: string
  ): string {
    let content = `# DELEGATED TASK (${taskId})\n\n`;
    content += `**From:** ${delegator.name} (${delegator.role})\n`;
    content += `**Priority:** ${request.priority || 'normal'}\n\n`;
    content += `## Task Description\n${request.task}\n\n`;

    if (request.deadline) {
      const deadlineDate = new Date(request.deadline);
      content += `## Deadline\n${deadlineDate.toISOString()}\n\n`;
    }

    if (request.dependencies && request.dependencies.length > 0) {
      content += `## Dependencies\n${request.dependencies.map(d => `- ${d}`).join('\n')}\n\n`;
    }

    if (request.context) {
      content += `## Context\n\`\`\`json\n${JSON.stringify(request.context, null, 2)}\n\`\`\`\n\n`;
    }

    return content;
  }

  private resolveRecipient(
    recipient: string | AgentRole,
    scope: CommunicationScope
  ): string | undefined {
    if (recipient === 'broadcast') {
      return 'broadcast';
    }

    if (scope.participants.some(p => p.id === recipient)) {
      return recipient;
    }

    const byRole = scope.participants.find(p => p.role === recipient);
    return byRole?.id;
  }

  onMessage(
    agentId: string,
    sessionId: string,
    handler: MessageHandler
  ): () => void {
    const key = `${sessionId}_${agentId}`;
    const handlers = this.handlers.get(key);

    if (!handlers) {
      return () => {};
    }

    handlers.add(handler);

    return () => {
      handlers.delete(handler);
    };
  }

  getMessagesForAgent(
    agentId: string,
    sessionId: string,
    since?: number
  ): CommsMessage[] {
    return this.commsGround.getMessages(
      this.getAgentRole(agentId, sessionId),
      agentId,
      since
    ).filter(m => m.metadata?.sessionId === sessionId);
  }

  private getAgentRole(agentId: string, sessionId: string): AgentRole {
    const scope = this.scopes.get(sessionId);
    if (!scope) {
      return 'planner';
    }

    const participant = scope.participants.find(p => p.id === agentId);
    return participant?.role || 'planner';
  }

  acknowledgeMessage(messageId: string, response: string): void {
    const pending = this.pendingResponses.get(messageId);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.resolve({
        success: true,
        messageId,
        content: response,
        timestamp: Date.now(),
      });
      this.pendingResponses.delete(messageId);
    }
  }

  rejectMessage(messageId: string, reason: string): void {
    const pending = this.pendingResponses.get(messageId);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.resolve({
        success: false,
        messageId,
        error: reason,
        timestamp: Date.now(),
      });
      this.pendingResponses.delete(messageId);
    }
  }

  endScope(sessionId: string): void {
    for (const participant of this.scopes.get(sessionId)?.participants || []) {
      const key = `${sessionId}_${participant.id}`;
      this.handlers.delete(key);
    }

    for (const [, pending] of this.pendingResponses) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Session ended'));
    }
    this.pendingResponses.clear();

    this.scopes.delete(sessionId);
  }
}

import type { AgentRole } from '../collaboration/AgentType.js';
import type { VectorClockSnapshot } from '../comms/VectorClock.js';

export interface DistributedAgentIdentity {
  id: string;
  role: AgentRole;
  name: string;
  nodeId: string;
}

export interface TaskScope {
  taskId: string;
  participants: DistributedAgentIdentity[];
  createdAt: number;
  parentTaskId?: string;
  childTaskIds: string[];
}

export interface DistributedMessageRequest {
  recipient: string | AgentRole;
  content: string;
  type: 'message' | 'status' | 'request' | 'response' | 'delegation' | 'progress' | 'completion' | 'failure';
  metadata?: Record<string, unknown>;
  requiresResponse?: boolean;
  timeout?: number;
  causalDeps?: string[];
}

export interface DistributedMessageResponse {
  success: boolean;
  messageId?: string;
  content?: string;
  error?: string;
  timestamp: number;
  vectorClock?: VectorClockSnapshot;
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

export interface MessageWithCausality {
  id: string;
  sender: string;
  senderNode: string;
  recipient?: string | 'broadcast';
  role: AgentRole;
  content: string;
  timestamp: number;
  type: DistributedMessageRequest['type'];
  metadata?: Record<string, unknown>;
  vectorClock: VectorClockSnapshot;
  causalDeps: string[];
  taskId: string;
  sequenceNumber: number;
}

export interface CausalityChain {
  messageId: string;
  dependencies: string[];
  vectorClock: VectorClockSnapshot;
}

type MessageHandler = (
  message: MessageWithCausality,
  sender: DistributedAgentIdentity
) => Promise<void> | void;

export class DistributedAgentCommunicator {
  private nodeId: string;
  private scopes: Map<string, TaskScope> = new Map();
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private messageBuffer: Map<string, MessageWithCausality[]> = new Map();
  private pendingResponses: Map<string, {
    resolve: (response: DistributedMessageResponse) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();
  private causalityChains: Map<string, CausalityChain> = new Map();
  private sequenceCounters: Map<string, number> = new Map();
  private messageLog: Map<string, MessageWithCausality> = new Map();
  private deduplicationCache: Map<string, string> = new Map();
  private deduplicationWindow = 3600000;

  constructor(nodeId: string) {
    this.nodeId = nodeId;
  }

  createTaskScope(
    taskId: string,
    participants: DistributedAgentIdentity[],
    parentTaskId?: string
  ): TaskScope {
    const scope: TaskScope = {
      taskId,
      participants,
      createdAt: Date.now(),
      parentTaskId,
      childTaskIds: [],
    };

    if (parentTaskId) {
      const parentScope = this.scopes.get(parentTaskId);
      if (parentScope) {
        parentScope.childTaskIds.push(taskId);
      }
    }

    this.scopes.set(taskId, scope);
    this.messageBuffer.set(taskId, []);
    this.sequenceCounters.set(taskId, 0);

    for (const participant of participants) {
      const key = this.handlerKey(taskId, participant.id);
      this.handlers.set(key, new Set());
    }

    return scope;
  }

  getTaskScope(taskId: string): TaskScope | undefined {
    return this.scopes.get(taskId);
  }

  joinTaskScope(taskId: string, agent: DistributedAgentIdentity): boolean {
    const scope = this.scopes.get(taskId);
    if (!scope) {
      return false;
    }

    if (!scope.participants.find(p => p.id === agent.id)) {
      scope.participants.push(agent);
    }

    const key = this.handlerKey(taskId, agent.id);
    if (!this.handlers.has(key)) {
      this.handlers.set(key, new Set());
    }

    return true;
  }

  leaveTaskScope(taskId: string, agentId: string): boolean {
    const scope = this.scopes.get(taskId);
    if (!scope) {
      return false;
    }

    scope.participants = scope.participants.filter(p => p.id !== agentId);
    return true;
  }

  private handlerKey(taskId: string, agentId: string): string {
    return `${taskId}_${agentId}`;
  }

  private nextSequenceNumber(taskId: string): number {
    const current = this.sequenceCounters.get(taskId) || 0;
    const next = current + 1;
    this.sequenceCounters.set(taskId, next);
    return next;
  }

  sendMessage(
    sender: DistributedAgentIdentity,
    request: DistributedMessageRequest,
    taskId: string,
    vectorClock: VectorClockSnapshot
  ): MessageWithCausality {
    const scope = this.scopes.get(taskId);
    if (!scope) {
      throw new Error(`Task scope ${taskId} not found`);
    }

    const recipientId = this.resolveRecipient(request.recipient, scope);
    if (!recipientId) {
      throw new Error('Recipient not found in scope');
    }

    const deduplicationKey = this.computeDeduplicationKey(
      sender.id,
      recipientId,
      request.content,
      vectorClock
    );

    if (this.deduplicationCache.has(deduplicationKey)) {
      const existingId = this.deduplicationCache.get(deduplicationKey)!;
      const existing = this.messageLog.get(existingId);
      if (existing) {
        return existing;
      }
    }

    const messageId = `dmsg_${this.nodeId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const sequenceNumber = this.nextSequenceNumber(taskId);

    const message: MessageWithCausality = {
      id: messageId,
      sender: sender.id,
      senderNode: sender.nodeId,
      recipient: recipientId,
      role: sender.role,
      content: request.content,
      timestamp: Date.now(),
      type: request.type,
      metadata: {
        ...request.metadata,
        taskId,
        senderRole: sender.role,
        senderName: sender.name,
        senderNode: sender.nodeId,
      },
      vectorClock,
      causalDeps: request.causalDeps || [],
      taskId,
      sequenceNumber,
    };

    this.storeMessage(message);
    this.cacheDeduplicationKey(deduplicationKey, messageId);
    this.recordCausalityChain(messageId, request.causalDeps || [], vectorClock);

    this.deliverToHandlers(message);

    return message;
  }

  async sendMessageAsync(
    sender: DistributedAgentIdentity,
    request: DistributedMessageRequest,
    taskId: string,
    vectorClock: VectorClockSnapshot
  ): Promise<DistributedMessageResponse> {
    const message = this.sendMessage(sender, request, taskId, vectorClock);

    if (!request.requiresResponse) {
      return {
        success: true,
        messageId: message.id,
        timestamp: Date.now(),
        vectorClock,
      };
    }

    return new Promise<DistributedMessageResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(message.id);
        resolve({
          success: false,
          messageId: message.id,
          error: 'Response timeout',
          timestamp: Date.now(),
          vectorClock,
        });
      }, request.timeout || 30000);

      this.pendingResponses.set(message.id, { resolve, reject, timeout });
    });
  }

  broadcast(
    sender: DistributedAgentIdentity,
    content: string,
    type: DistributedMessageRequest['type'],
    taskId: string,
    vectorClock: VectorClockSnapshot,
    metadata?: Record<string, unknown>
  ): MessageWithCausality {
    const scope = this.scopes.get(taskId);
    if (!scope) {
      throw new Error(`Task scope ${taskId} not found`);
    }

    const deduplicationKey = this.computeDeduplicationKey(
      sender.id,
      'broadcast',
      content,
      vectorClock
    );

    if (this.deduplicationCache.has(deduplicationKey)) {
      const existingId = this.deduplicationCache.get(deduplicationKey)!;
      const existing = this.messageLog.get(existingId);
      if (existing) {
        return existing;
      }
    }

    const messageId = `dmsg_${this.nodeId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const sequenceNumber = this.nextSequenceNumber(taskId);

    const message: MessageWithCausality = {
      id: messageId,
      sender: sender.id,
      senderNode: sender.nodeId,
      recipient: 'broadcast',
      role: sender.role,
      content,
      timestamp: Date.now(),
      type,
      metadata: {
        ...metadata,
        taskId,
        senderRole: sender.role,
        senderName: sender.name,
        senderNode: sender.nodeId,
        broadcast: true,
      },
      vectorClock,
      causalDeps: [],
      taskId,
      sequenceNumber,
    };

    this.storeMessage(message);
    this.cacheDeduplicationKey(deduplicationKey, messageId);

    this.deliverToHandlers(message);

    return message;
  }

  receiveRemoteMessage(message: MessageWithCausality): MessageWithCausality | null {
    const deduplicationKey = `${message.sender}_${message.recipient}_${message.content}_${JSON.stringify(message.vectorClock)}`;

    if (this.deduplicationCache.has(deduplicationKey)) {
      const existingId = this.deduplicationCache.get(deduplicationKey)!;
      const existing = this.messageLog.get(existingId);
      return existing || null;
    }

    if (this.isStale(message)) {
      return null;
    }

    this.cacheDeduplicationKey(deduplicationKey, message.id);
    this.storeMessage(message);
    this.recordCausalityChain(message.id, message.causalDeps, message.vectorClock);

    this.deliverToHandlers(message);

    return message;
  }

  private isStale(message: MessageWithCausality): boolean {
    const existingMessages = this.messageBuffer.get(message.taskId) || [];

    for (const existing of existingMessages) {
      if (existing.sender === message.sender && existing.sequenceNumber >= message.sequenceNumber) {
        return true;
      }
    }

    return false;
  }

  private computeDeduplicationKey(
    sender: string,
    recipient: string | 'broadcast',
    content: string,
    vectorClock: VectorClockSnapshot
  ): string {
    return `${sender}_${recipient}_${content.length}_${JSON.stringify(vectorClock)}`;
  }

  private cacheDeduplicationKey(key: string, messageId: string): void {
    this.deduplicationCache.set(key, messageId);

    setTimeout(() => {
      this.deduplicationCache.delete(key);
    }, this.deduplicationWindow);
  }

  private storeMessage(message: MessageWithCausality): void {
    this.messageLog.set(message.id, message);

    const buffer = this.messageBuffer.get(message.taskId);
    if (buffer) {
      buffer.push(message);
      if (buffer.length > 1000) {
        buffer.shift();
      }
    }

    const scope = this.scopes.get(message.taskId);
    if (scope) {
      const recipient = message.recipient;
      if (recipient && recipient !== 'broadcast') {
        const participant = scope.participants.find(p => p.id === recipient);
        if (participant && participant.nodeId === this.nodeId) {
          return;
        }
      }

      for (const participant of scope.participants) {
        if (participant.nodeId === this.nodeId) {
          this.deliverToLocalHandler(message, participant.id);
        }
      }
    }
  }

  private deliverToHandlers(message: MessageWithCausality): void {
    const scope = this.scopes.get(message.taskId);
    if (!scope) return;

    const recipient = message.recipient;

    if (recipient === 'broadcast') {
      for (const participant of scope.participants) {
        if (participant.nodeId === this.nodeId && participant.id !== message.sender) {
          this.deliverToLocalHandler(message, participant.id);
        }
      }
    } else if (recipient) {
      const participant = scope.participants.find(p => p.id === recipient);
      if (participant && participant.nodeId === this.nodeId) {
        this.deliverToLocalHandler(message, recipient);
      }
    }
  }

  private deliverToLocalHandler(message: MessageWithCausality, agentId: string): void {
    const key = this.handlerKey(message.taskId, agentId);
    const handlers = this.handlers.get(key);

    if (!handlers) return;

    const scope = this.scopes.get(message.taskId);
    if (!scope) return;

    const sender = scope.participants.find(p => p.id === message.sender);

    for (const handler of handlers) {
      try {
        handler(message, sender || {
          id: message.sender,
          role: message.role,
          name: message.metadata?.senderName as string || message.sender,
          nodeId: message.senderNode,
        });
      } catch {
        // Ignore handler errors
      }
    }
  }

  private recordCausalityChain(
    messageId: string,
    dependencies: string[],
    vectorClock: VectorClockSnapshot
  ): void {
    this.causalityChains.set(messageId, {
      messageId,
      dependencies,
      vectorClock,
    });
  }

  acknowledgeMessage(messageId: string, response: string, vectorClock: VectorClockSnapshot): void {
    const pending = this.pendingResponses.get(messageId);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.resolve({
        success: true,
        messageId,
        content: response,
        timestamp: Date.now(),
        vectorClock,
      });
      this.pendingResponses.delete(messageId);
    }
  }

  rejectMessage(messageId: string, reason: string, vectorClock: VectorClockSnapshot): void {
    const pending = this.pendingResponses.get(messageId);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.resolve({
        success: false,
        messageId,
        error: reason,
        timestamp: Date.now(),
        vectorClock,
      });
      this.pendingResponses.delete(messageId);
    }
  }

  onMessage(agentId: string, taskId: string, handler: MessageHandler): () => void {
    const key = this.handlerKey(taskId, agentId);
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
    taskId: string,
    since?: number
  ): MessageWithCausality[] {
    const buffer = this.messageBuffer.get(taskId) || [];

    return buffer.filter(m => {
      if (since && m.timestamp < since) return false;

      if (m.recipient === 'broadcast') return true;
      if (m.recipient === agentId) return true;
      if (m.sender === agentId) return true;

      return false;
    }).sort((a, b) => a.timestamp - b.timestamp);
  }

  getCausalHistory(messageId: string): MessageWithCausality[] {
    const chain = this.causalityChains.get(messageId);
    if (!chain) return [];

    const history: MessageWithCausality[] = [];

    for (const depId of chain.dependencies) {
      const depMessage = this.messageLog.get(depId);
      if (depMessage) {
        history.push(depMessage);
        history.push(...this.getCausalHistory(depId));
      }
    }

    return history;
  }

  getCausalityChain(messageId: string): CausalityChain | undefined {
    return this.causalityChains.get(messageId);
  }

  delegate(
    delegator: DistributedAgentIdentity,
    request: DelegationRequest,
    taskId: string,
    vectorClock: VectorClockSnapshot
  ): { message: MessageWithCausality; taskDelegation: Record<string, unknown> } {
    const scope = this.scopes.get(taskId);
    if (!scope) {
      throw new Error(`Task scope ${taskId} not found`);
    }

    const targetParticipant = scope.participants.find(p => p.role === request.targetRole);
    const subtaskId = `subtask_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const taskContent = this.formatDelegationTask(request, delegator, subtaskId);

    const message = this.sendMessage(
      delegator,
      {
        recipient: targetParticipant?.id || request.targetRole,
        content: taskContent,
        type: 'delegation',
        metadata: {
          taskId: subtaskId,
          parentTaskId: taskId,
          priority: request.priority || 'normal',
          deadline: request.deadline,
          dependencies: request.dependencies,
          context: request.context,
        },
        causalDeps: [],
      },
      taskId,
      vectorClock
    );

    const taskDelegation = {
      id: subtaskId,
      task: request.task,
      delegator: delegator.id,
      delegatorRole: delegator.role,
      delegatorNode: delegator.nodeId,
      targetRole: request.targetRole,
      targetAgent: targetParticipant?.id,
      targetNode: targetParticipant?.nodeId,
      status: 'pending',
      priority: request.priority || 'normal',
      deadline: request.deadline,
      createdAt: Date.now(),
    };

    this.createTaskScope(subtaskId, [
      ...scope.participants.filter(p => p.role === request.targetRole),
      {
        id: delegator.id,
        role: delegator.role,
        name: delegator.name,
        nodeId: delegator.nodeId,
      },
    ], taskId);

    return { message, taskDelegation };
  }

  private formatDelegationTask(
    request: DelegationRequest,
    delegator: DistributedAgentIdentity,
    taskId: string
  ): string {
    let content = `# DELEGATED TASK (${taskId})\n\n`;
    content += `**From:** ${delegator.name} (${delegator.role}) on ${delegator.nodeId}\n`;
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
    scope: TaskScope
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

  endTaskScope(taskId: string): void {
    const scope = this.scopes.get(taskId);
    if (!scope) return;

    for (const childTaskId of scope.childTaskIds) {
      this.endTaskScope(childTaskId);
    }

    for (const participant of scope.participants) {
      const key = this.handlerKey(taskId, participant.id);
      this.handlers.delete(key);
    }

    for (const [, pending] of this.pendingResponses) {
      const pendingScope = this.messageBuffer.get(taskId);
      if (pendingScope) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Task scope ended'));
      }
    }

    this.scopes.delete(taskId);
    this.messageBuffer.delete(taskId);
    this.sequenceCounters.delete(taskId);
  }

  getTaskMetrics(taskId: string): {
    messageCount: number;
    participantCount: number;
    childTaskCount: number;
  } {
    const scope = this.scopes.get(taskId);
    const messages = this.messageBuffer.get(taskId) || [];

    return {
      messageCount: messages.length,
      participantCount: scope?.participants.length || 0,
      childTaskCount: scope?.childTaskIds.length || 0,
    };
  }

  getNodeId(): string {
    return this.nodeId;
  }

  getMessageLog(taskId: string): MessageWithCausality[] {
    return Array.from(this.messageLog.values())
      .filter(m => m.taskId === taskId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }
}

let globalCommunicator: DistributedAgentCommunicator | null = null;

export function initDistributedCommunicator(nodeId: string): DistributedAgentCommunicator {
  globalCommunicator = new DistributedAgentCommunicator(nodeId);
  return globalCommunicator;
}

export function getDistributedCommunicator(): DistributedAgentCommunicator | null {
  return globalCommunicator;
}

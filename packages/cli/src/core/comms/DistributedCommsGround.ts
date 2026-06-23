import { EventEmitter } from 'events';
import { VectorClock } from './VectorClock.js';
import { DistributedRelevanceScorer, type DistributedMessage } from './DistributedRelevanceScorer.js';
import { MessageSummarizer } from './MessageSummarizer.js';
import { generateUUID } from '../distributed/protocol.js';
import type { AgentRole } from '../collaboration/AgentType.js';

export interface DistributedCommsConfig {
  maxMessagesPerTask?: number;
  maxTotalMessages?: number;
  summarizationThreshold?: number;
  summarizationBatchSize?: number;
  maxContextMessages?: number;
  maxMessageContentLength?: number;
  maxArtifactSize?: number;
  enableDebugLogging?: boolean;
  syncBatchSize?: number;
  deduplicationWindowMs?: number;
  dedupMaxSize?: number;
  protectedRecentMessages?: number;
  maxMessagesPerMinute?: number;
  maxMemoryWritesPerMinute?: number;
}

export interface DistributedCommsStats {
  totalMessages: number;
  totalSummarized: number;
  totalArtifacts: number;
  taskCount: number;
  deduplicatedCount: number;
  vectorClock: Record<string, number>;
  byType?: Record<string, number>;
  byAgent?: Record<string, number>;
  byNode?: Record<string, number>;
}

export interface Artifact {
  name: string;
  type: string;
  content: string;
  producedBy: string;
  version: number;
  timestamp: number;
  language?: string;
}

export interface NetworkDeliveryMessage {
  id: string;
  payload: DistributedMessage;
  requiresAck: boolean;
  retryCount: number;
  maxRetries: number;
  sentAt: number;
}

export interface SyncRequest {
  type: 'sync-request' | 'sync-response' | 'ack' | 'nack';
  vectorClock: Record<string, number>;
  knownMessageIds: string[];
  missingMessages?: DistributedMessage[];
  memorySnapshot?: Record<string, unknown>;
  requestId?: string;
}

export interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class DistributedCommsGround extends EventEmitter {
  private messagesByTask: Map<string, Map<string, DistributedMessage>> = new Map();
  private messageOrderByTask: Map<string, string[]> = new Map();
  private artifactsByTask: Map<string, Map<string, Artifact[]>> = new Map();
  private vectorClock: VectorClock;
  private summarizer: MessageSummarizer;
  private summarizationInProgress: Set<string> = new Set();
  private networkManager: unknown = null;
  private config: Required<DistributedCommsConfig>;
  private relevanceScorer: DistributedRelevanceScorer;

  private seenMessages: Map<string, number> = new Map();
  private dedupTTL: number;
  private maxDedupSize: number;
  private dedupCleanupInterval: ReturnType<typeof setInterval> | null = null;

  private pendingAcks: Map<string, { timeout: ReturnType<typeof setTimeout>; message: DistributedMessage; retryCount: number }> = new Map();
  private maxRetries: number = 3;
  private ackTimeout: number = 5000;

  private protectedRecentMessages: number;
  private messageRateLimits: Map<string, RateLimitEntry> = new Map();
  private writeRateLimits: Map<string, RateLimitEntry> = new Map();
  private rateLimitWindow: number = 60000;

  constructor(
    nodeId: string,
    eventBus: EventEmitter,
    config?: DistributedCommsConfig,
    networkManager?: unknown
  ) {
    super();
    this.vectorClock = new VectorClock(nodeId);
    this.networkManager = networkManager || null;
    this.relevanceScorer = new DistributedRelevanceScorer();
    this.summarizer = new MessageSummarizer();

    this.dedupTTL = config?.deduplicationWindowMs ?? 5 * 60 * 1000;
    this.maxDedupSize = config?.dedupMaxSize ?? 10000;
    this.protectedRecentMessages = config?.protectedRecentMessages ?? 10;

    this.config = {
      maxMessagesPerTask: config?.maxMessagesPerTask ?? 100,
      maxTotalMessages: config?.maxTotalMessages ?? 500,
      summarizationThreshold: config?.summarizationThreshold ?? 50,
      summarizationBatchSize: config?.summarizationBatchSize ?? 30,
      maxContextMessages: config?.maxContextMessages ?? 20,
      maxMessageContentLength: config?.maxMessageContentLength ?? 10000,
      maxArtifactSize: config?.maxArtifactSize ?? 50000,
      enableDebugLogging: config?.enableDebugLogging ?? false,
      syncBatchSize: config?.syncBatchSize ?? 50,
      deduplicationWindowMs: config?.deduplicationWindowMs ?? 5 * 60 * 1000,
      dedupMaxSize: config?.dedupMaxSize ?? 10000,
      protectedRecentMessages: config?.protectedRecentMessages ?? 10,
      maxMessagesPerMinute: config?.maxMessagesPerMinute ?? 60,
      maxMemoryWritesPerMinute: config?.maxMemoryWritesPerMinute ?? 30,
    };

    this.dedupCleanupInterval = setInterval(() => {
      this.cleanupDedup();
    }, 30000);

    if (networkManager) {
      eventBus.on('network:comms-message-received', (data: unknown) => {
        this.receiveFromNetwork((data as { message: DistributedMessage }).message);
      });

      eventBus.on('network:ack-received', (data: unknown) => {
        this.handleAck((data as { messageId: string }).messageId);
      });

      eventBus.on('network:delivery-failed', (data: unknown) => {
        const { messageId } = data as { messageId: string };
        this.emit('network:delivery-failed', { messageId });
      });
    }
  }

  private cleanupDedup(): void {
    const now = Date.now();

    for (const [id, ts] of this.seenMessages) {
      if (now - ts > this.dedupTTL) {
        this.seenMessages.delete(id);
      }
    }

    if (this.seenMessages.size > this.maxDedupSize) {
      const sorted = [...this.seenMessages.entries()]
        .sort((a, b) => a[1] - b[1]);

      const removeCount = this.seenMessages.size - this.maxDedupSize;

      for (let i = 0; i < removeCount; i++) {
        this.seenMessages.delete(sorted[i][0]);
      }

      this.emit('comms:dedup-pruned', { removed: removeCount, remaining: this.seenMessages.size });
    }
  }

  private checkRateLimit(agentId: string, type: 'message' | 'write'): boolean {
    const limits = type === 'message' ? this.config.maxMessagesPerMinute : this.config.maxMemoryWritesPerMinute;
    const rateMap = type === 'message' ? this.messageRateLimits : this.writeRateLimits;

    const now = Date.now();
    const entry = rateMap.get(agentId);

    if (!entry || now >= entry.resetAt) {
      rateMap.set(agentId, { count: 1, resetAt: now + this.rateLimitWindow });
      return true;
    }

    if (entry.count >= limits) {
      this.emit('comms:rate-limited', { agentId, type, current: entry.count, limit: limits });
      return false;
    }

    entry.count++;
    return true;
  }

  publish(
    taskId: string,
    message: Partial<DistributedMessage>
  ): DistributedMessage | null {
    const from = message.from || 'unknown';

    if (!this.checkRateLimit(from, 'message')) {
      this.emit('comms:message-dropped-rate-limit', { taskId, from });
      return null;
    }

    const messageId = message.id || generateUUID();

    if (this.isDuplicate(messageId)) {
      return this.getMessage(taskId, messageId);
    }

    const clockSnapshot = this.vectorClock.tick();

    let content = message.content || '';
    if (content.length > this.config.maxMessageContentLength) {
      content = content.slice(0, this.config.maxMessageContentLength) +
        `\n\n[TRUNCATED — original ${content.length} chars]`;
    }

    const fullMessage: DistributedMessage = {
      id: messageId,
      taskId,
      fromNode: this.vectorClock.getNodeId(),
      vectorClock: clockSnapshot,
      synced: false,
      syncedTo: [],
      summarized: false,
      causalOrder: this.computeCausalOrder(clockSnapshot),
      from: message.from || 'unknown',
      target: message.target || { type: 'broadcast' },
      type: message.type || 'status',
      priority: message.priority || 'normal',
      subject: message.subject || '',
      content,
      timestamp: Date.now(),
      metadata: message.metadata,
    };

    this.storeMessage(taskId, fullMessage);
    this.markSeen(messageId);
    this.checkSummarizationNeeded(taskId);
    this.broadcastToNetwork(fullMessage, true);

    this.emit('comms:message-published', {
      message: fullMessage,
      totalMessages: this.getTaskMessageCount(taskId),
      isDistributed: this.networkManager !== null,
    });

    return fullMessage;
  }

  private computeCausalOrder(clock: Record<string, number>): number {
    const entries = Object.entries(clock);
    if (entries.length === 0) return 0;
    
    let hash = 0;
    for (const [nodeId, counter] of entries) {
      hash = ((hash << 5) - hash + nodeId.charCodeAt(0)) | 0;
      hash = ((hash << 5) - hash + counter) | 0;
    }
    return Math.abs(hash);
  }

  private isDuplicate(messageId: string): boolean {
    return this.seenMessages.has(messageId);
  }

  private markSeen(messageId: string): void {
    this.seenMessages.set(messageId, Date.now());
  }

  receiveFromNetwork(message: DistributedMessage): boolean {
    if (this.isDuplicate(message.id)) {
      this.emit('comms:message-deduplicated', {
        messageId: message.id,
        fromNode: message.fromNode,
        taskId: message.taskId,
      });
      return false;
    }

    if (this.vectorClock.isStale(message.vectorClock)) {
      this.emit('comms:message-stale', {
        messageId: message.id,
        fromNode: message.fromNode,
        incomingClock: message.vectorClock,
        localClock: this.vectorClock.snapshot(),
      });
      this.markSeen(message.id);
      return false;
    }

    this.vectorClock.merge(message.vectorClock);

    const storedMessage: DistributedMessage = {
      ...message,
      receivedFrom: message.fromNode,
      causalOrder: this.computeCausalOrder(message.vectorClock),
    };

    this.storeMessage(message.taskId, storedMessage);
    this.markSeen(message.id);
    this.checkSummarizationNeeded(message.taskId);

    this.emit('comms:message-received-network', {
      message: storedMessage,
      fromNode: message.fromNode,
      totalMessages: this.getTaskMessageCount(message.taskId),
    });

    return true;
  }

  private storeMessage(taskId: string, message: DistributedMessage): void {
    if (!this.messagesByTask.has(taskId)) {
      this.messagesByTask.set(taskId, new Map());
      this.messageOrderByTask.set(taskId, []);
    }

    const taskMessages = this.messagesByTask.get(taskId)!;
    const taskOrder = this.messageOrderByTask.get(taskId)!;

    if (taskMessages.size >= this.config.maxMessagesPerTask) {
      this.evictOldMessages(taskId);
    }

    const insertIndex = this.findCausalInsertIndex(taskOrder, taskMessages, message);
    taskOrder.splice(insertIndex, 0, message.id);
    taskMessages.set(message.id, message);
  }

  private findCausalInsertIndex(
    taskOrder: string[],
    taskMessages: Map<string, DistributedMessage>,
    newMessage: DistributedMessage
  ): number {
    const newVC = newMessage.vectorClock;

    for (let i = 0; i < taskOrder.length; i++) {
      const existing = taskMessages.get(taskOrder[i]);
      if (!existing) continue;

      const comparison = VectorClock.compare(newVC, existing.vectorClock);

      if (comparison === 'before') {
        return i;
      }

      if (comparison === 'concurrent' && newMessage.timestamp < existing.timestamp) {
        return i;
      }
    }

    return taskOrder.length;
  }

  private broadcastToNetwork(message: DistributedMessage, requiresAck: boolean): void {
    if (!this.networkManager) return;

    this.emit('network:send-message', {
      id: message.id,
      payload: message,
      requiresAck,
    });

    if (requiresAck) {
      this.waitForAck(message);
    }
  }

  private waitForAck(message: DistributedMessage): void {
    const timeout = setTimeout(() => {
      const pending = this.pendingAcks.get(message.id);
      if (!pending) return;

      if (pending.retryCount < this.maxRetries) {
        pending.retryCount++;
        pending.timeout = setTimeout(() => this.waitForAck(message), this.ackTimeout);
        
        this.emit('network:retry', {
          messageId: message.id,
          attempt: pending.retryCount,
          maxRetries: this.maxRetries,
        });
      } else {
        this.pendingAcks.delete(message.id);
        this.emit('network:delivery-failed', { messageId: message.id });
      }
    }, this.ackTimeout);

    this.pendingAcks.set(message.id, {
      timeout,
      message,
      retryCount: 0,
    });
  }

  private handleAck(messageId: string): void {
    const pending = this.pendingAcks.get(messageId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingAcks.delete(messageId);
      this.emit('network:ack-received', { messageId });
    }
  }

  requestSync(knownMessageIds: string[]): SyncRequest {
    return {
      type: 'sync-request',
      vectorClock: this.vectorClock.snapshot(),
      knownMessageIds,
    };
  }

  processSyncResponse(response: SyncRequest): number {
    if (response.type !== 'sync-response') return 0;

    let applied = 0;

    if (response.missingMessages) {
      for (const message of response.missingMessages) {
        if (this.receiveFromNetwork(message)) {
          applied++;
        }
      }
    }

    this.vectorClock.merge(response.vectorClock);

    this.emit('comms:sync-completed', { applied, messageCount: response.missingMessages?.length || 0 });

    return applied;
  }

  getMessagesForAgent(
    taskId: string,
    agentId: string,
    agentType: AgentRole,
    options?: { maxMessages?: number; scoreThreshold?: number }
  ): DistributedMessage[] {
    const taskMessages = this.messagesByTask.get(taskId);
    if (!taskMessages) return [];

    const taskOrder = this.messageOrderByTask.get(taskId) || [];
    const max = options?.maxMessages ?? this.config.maxContextMessages;
    const threshold = options?.scoreThreshold ?? 10;

    const candidates: Array<{ message: DistributedMessage; score: number }> = [];

    for (const messageId of taskOrder) {
      const msg = taskMessages.get(messageId);
      if (!msg) continue;
      if (msg.from === agentId) continue;
      if (msg.summarized) continue;

      const score = this.relevanceScorer.score(msg, agentId, agentType, taskId);
      if (score >= threshold) {
        candidates.push({ message: msg, score });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, max).map(c => c.message);
  }

  getTaskTranscript(taskId: string): DistributedMessage[] {
    const taskMessages = this.messagesByTask.get(taskId);
    const taskOrder = this.messageOrderByTask.get(taskId);
    if (!taskMessages || !taskOrder) return [];

    return taskOrder
      .map(id => taskMessages.get(id))
      .filter((m): m is DistributedMessage => m !== undefined);
  }

  getCausallyOrderedMessages(taskId: string): DistributedMessage[] {
    const messages = this.getTaskTranscript(taskId);
    return VectorClock.causalSort(
      messages.map(m => ({
        ...m,
        vectorClock: m.vectorClock,
        timestamp: m.timestamp,
        fromNode: m.fromNode,
      }))
    );
  }

  getMessage(taskId: string, messageId: string): DistributedMessage | null {
    return this.messagesByTask.get(taskId)?.get(messageId) || null;
  }

  getLatestDecision(taskId: string): DistributedMessage | null {
    const taskOrder = this.messageOrderByTask.get(taskId);
    if (!taskOrder) return null;

    const taskMessages = this.messagesByTask.get(taskId)!;

    for (let i = taskOrder.length - 1; i >= 0; i--) {
      const msg = taskMessages.get(taskOrder[i]);
      if (msg && msg.type === 'decision' && !msg.summarized) {
        return msg;
      }
    }

    return null;
  }

  publishArtifact(taskId: string, artifact: Omit<Artifact, 'version' | 'timestamp'>): Artifact | null {
    const producedBy = artifact.producedBy;

    if (!this.checkRateLimit(producedBy, 'write')) {
      this.emit('comms:artifact-dropped-rate-limit', { taskId, name: artifact.name });
      return null;
    }

    if (!this.artifactsByTask.has(taskId)) {
      this.artifactsByTask.set(taskId, new Map());
    }

    const taskArtifacts = this.artifactsByTask.get(taskId)!;
    const existing = taskArtifacts.get(artifact.name) || [];
    const version = existing.length + 1;

    if (artifact.content.length > this.config.maxArtifactSize) {
      throw new Error(`Artifact '${artifact.name}' exceeds size limit`);
    }

    const fullArtifact: Artifact = { ...artifact, version, timestamp: Date.now() };
    existing.push(fullArtifact);
    taskArtifacts.set(artifact.name, existing);

    this.publish(taskId, {
      from: artifact.producedBy,
      target: { type: 'broadcast' },
      type: 'artifact',
      priority: 'normal',
      subject: `Artifact: ${artifact.name} (v${version})`,
      content: `Published artifact: ${artifact.name}`,
      metadata: { artifactName: artifact.name, artifactType: artifact.type, version },
    });

    return fullArtifact;
  }

  getArtifact(taskId: string, name: string): Artifact | null {
    const taskArtifacts = this.artifactsByTask.get(taskId);
    if (!taskArtifacts) return null;
    const versions = taskArtifacts.get(name);
    return versions ? versions[versions.length - 1] : null;
  }

  getUnsyncedMessages(taskId: string, _forNodeId: string): DistributedMessage[] {
    const taskMessages = this.messagesByTask.get(taskId);
    if (!taskMessages) return [];

    return Array.from(taskMessages.values())
      .filter(m => !m.synced)
      .sort((a, b) => a.causalOrder - b.causalOrder);
  }

  markSynced(taskId: string, messageIds: string[], _nodeId: string): void {
    const taskMessages = this.messagesByTask.get(taskId);
    if (!taskMessages) return;

    for (const id of messageIds) {
      const msg = taskMessages.get(id);
      if (msg) {
        msg.synced = true;
      }
    }
  }

  private evictOldMessages(taskId: string): void {
    const taskMessages = this.messagesByTask.get(taskId)!;
    const taskOrder = this.messageOrderByTask.get(taskId)!;
    const protectedTypes = new Set(['error', 'decision', 'summary']);

    const protectedCount = Math.min(this.protectedRecentMessages, taskOrder.length);

    const evictable: string[] = [];
    for (let i = 0; i < taskOrder.length - protectedCount; i++) {
      if (evictable.length >= Math.floor(taskMessages.size * 0.2)) break;
      const msg = taskMessages.get(taskOrder[i]);
      if (!msg) continue;
      if (protectedTypes.has(msg.type)) continue;
      if (msg.priority === 'critical') continue;
      evictable.push(taskOrder[i]);
    }

    for (const id of evictable) {
      taskMessages.delete(id);
      const idx = taskOrder.indexOf(id);
      if (idx !== -1) taskOrder.splice(idx, 1);
    }

    if (evictable.length > 0) {
      this.emit('comms:messages-evicted', { taskId, count: evictable.length });
    }
  }

  getTaskMessageCount(taskId: string): number {
    return this.messagesByTask.get(taskId)?.size || 0;
  }

  private checkSummarizationNeeded(taskId: string): void {
    const taskMessages = this.messagesByTask.get(taskId);
    if (!taskMessages) return;

    const activeMessageCount = Array.from(taskMessages.values())
      .filter(m => !m.summarized && m.type !== 'summary')
      .length;

    if (activeMessageCount > this.config.summarizationThreshold &&
        !this.summarizationInProgress.has(taskId)) {
      this.summarizationInProgress.add(taskId);
      this.summarizeOldMessages(taskId).finally(() => {
        this.summarizationInProgress.delete(taskId);
      });
    }
  }

  private async summarizeOldMessages(taskId: string): Promise<void> {
    const messages = this.getTaskTranscript(taskId);
    const summary = await this.summarizer.summarize(
      messages,
      taskId,
      this.vectorClock.getNodeId(),
      this.vectorClock.snapshot()
    );

    if (summary) {
      this.storeMessage(taskId, summary);
      this.emit('comms:summarization-complete', {
        taskId,
        summarizedCount: summary.summarizedCount,
        summaryLength: summary.content.length,
        summaryMessageId: summary.id,
      });
    }
  }

  getStats(taskId?: string): DistributedCommsStats {
    if (taskId) {
      return this.getTaskStats(taskId);
    }

    let totalMessages = 0;
    let totalSummarized = 0;

    for (const taskMessages of this.messagesByTask.values()) {
      totalMessages += taskMessages.size;
      for (const msg of taskMessages.values()) {
        if (msg.summarized) totalSummarized++;
      }
    }

    return {
      totalMessages,
      totalSummarized,
      totalArtifacts: Array.from(this.artifactsByTask.values()).reduce((sum, m) => sum + m.size, 0),
      taskCount: this.messagesByTask.size,
      deduplicatedCount: this.seenMessages.size,
      vectorClock: this.vectorClock.snapshot(),
    };
  }

  private getTaskStats(taskId: string): DistributedCommsStats {
    const taskMessages = this.messagesByTask.get(taskId);
    const byType: Record<string, number> = {};
    const byAgent: Record<string, number> = {};
    const byNode: Record<string, number> = {};
    let summarized = 0;

    if (taskMessages) {
      for (const msg of taskMessages.values()) {
        byType[msg.type] = (byType[msg.type] || 0) + 1;
        byAgent[msg.from] = (byAgent[msg.from] || 0) + 1;
        byNode[msg.fromNode] = (byNode[msg.fromNode] || 0) + 1;
        if (msg.summarized) summarized++;
      }
    }

    return {
      totalMessages: taskMessages?.size || 0,
      totalSummarized: summarized,
      totalArtifacts: this.artifactsByTask.get(taskId)?.size || 0,
      taskCount: 1,
      deduplicatedCount: 0,
      vectorClock: this.vectorClock.snapshot(),
      byType,
      byAgent,
      byNode,
    };
  }

  getStateSnapshot(): {
    messages: DistributedMessage[];
    artifacts: Record<string, Artifact[]>;
    vectorClock: Record<string, number>;
    knownMessageIds: string[];
  } {
    const allMessages: DistributedMessage[] = [];
    const allArtifacts: Record<string, Artifact[]> = {};

    for (const [, messages] of this.messagesByTask) {
      allMessages.push(...messages.values());
    }

    for (const [taskId, artifacts] of this.artifactsByTask) {
      const taskArtifacts: Artifact[] = [];
      for (const versions of artifacts.values()) {
        taskArtifacts.push(...versions);
      }
      if (taskArtifacts.length > 0) {
        allArtifacts[taskId] = taskArtifacts;
      }
    }

    return {
      messages: allMessages.slice(-50),
      artifacts: allArtifacts,
      vectorClock: this.vectorClock.snapshot(),
      knownMessageIds: Array.from(this.seenMessages.keys()),
    };
  }

  applyStateSnapshot(snapshot: {
    messages: DistributedMessage[];
    artifacts: Record<string, Artifact[]>;
    vectorClock: Record<string, number>;
  }): number {
    let applied = 0;

    this.vectorClock.merge(snapshot.vectorClock);

    for (const message of snapshot.messages) {
      if (this.receiveFromNetwork(message)) {
        applied++;
      }
    }

    for (const [taskId, artifacts] of Object.entries(snapshot.artifacts)) {
      if (!this.artifactsByTask.has(taskId)) {
        this.artifactsByTask.set(taskId, new Map());
      }
      const taskArtifacts = this.artifactsByTask.get(taskId)!;
      for (const artifact of artifacts) {
        const existing = taskArtifacts.get(artifact.name) || [];
        existing.push(artifact);
        taskArtifacts.set(artifact.name, existing);
      }
    }

    this.emit('comms:state-snapshot-applied', { applied, messageCount: snapshot.messages.length });

    return applied;
  }

  reset(taskId?: string): void {
    if (taskId) {
      this.messagesByTask.delete(taskId);
      this.messageOrderByTask.delete(taskId);
      this.artifactsByTask.delete(taskId);
    } else {
      this.messagesByTask.clear();
      this.messageOrderByTask.clear();
      this.artifactsByTask.clear();
      this.seenMessages.clear();
    }
  }

  shutdown(): void {
    if (this.dedupCleanupInterval) {
      clearInterval(this.dedupCleanupInterval);
      this.dedupCleanupInterval = null;
    }

    for (const pending of this.pendingAcks.values()) {
      clearTimeout(pending.timeout);
    }
    this.pendingAcks.clear();

    this.vectorClock.destroy();
  }
}

let globalDistributedCommsGround: DistributedCommsGround | null = null;

export function initDistributedCommsGround(
  nodeId: string,
  eventBus: EventEmitter,
  config?: DistributedCommsConfig,
  networkManager?: unknown
): DistributedCommsGround {
  globalDistributedCommsGround = new DistributedCommsGround(nodeId, eventBus, config, networkManager);
  return globalDistributedCommsGround;
}

export function getDistributedCommsGround(): DistributedCommsGround | null {
  return globalDistributedCommsGround;
}

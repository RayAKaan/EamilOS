import { EventEmitter } from 'events';
import type {
  NodeRole,
  NodeIdentity,
  NodeStatus,
  NetworkConfig,
  NetworkMessage,
  NetworkMessageType,
  WorkerConnection,
  NetworkCapacity,
  AuthChallengePayload,
  AuthResponsePayload,
  AuthResultPayload,
  TaskStreamPayload,
  TaskRejectedPayload,
  TaskPausePayload,
  TaskResumePayload,
  NodeMetrics,
} from './types.js';
import {
  generateUUID,
  createHMAC,
  verifyMessage,
  validateMessage,
  serializeMessageToString,
  parseMessage,
} from './protocol.js';

type EventHandler = (...args: unknown[]) => void;

const ROLLING_WINDOW_SIZE = 20;

export class NetworkManager extends EventEmitter {
  private role: NodeRole;
  private identity: NodeIdentity;
  private config: NetworkConfig;
  private sharedKey: string;
  private connectedWorkers: Map<string, WorkerConnection> = new Map();
  private bannedIPs: Map<string, number> = new Map();
  private processedMessageIds: Set<string> = new Set();
  private heartbeatIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  private heartbeatTimeouts: Map<string, ReturnType<typeof setInterval>> = new Map();
  private pendingAuth: Map<string, {
    socket: unknown;
    address: string;
    name?: string;
    resolve: (value: NodeStatus) => void;
    reject: (error: Error) => void;
  }> = new Map();
  private nodeMetrics: Map<string, NodeMetrics> = new Map();
  private pausedStreams: Set<string> = new Set();

  constructor(
    role: NodeRole,
    identity: NodeIdentity,
    config: NetworkConfig
  ) {
    super();
    this.role = role;
    this.identity = identity;
    this.config = config;
    this.sharedKey = this.resolveSharedKey(config);
  }

  get identity_(): NodeIdentity {
    return this.identity;
  }

  private resolveSharedKey(config: NetworkConfig): string {
    const key = config.security.sharedKey;
    if (key.startsWith('env:')) {
      const envVar = key.replace('env:', '');
      const value = process.env[envVar];
      if (!value) {
        throw new Error(`Network key missing: environment variable '${envVar}' is not set`);
      }
      return value;
    }
    return key;
  }

  private isCompressionEnabled(): boolean {
    return this.config.compression?.enabled === true;
  }

  private validateTLS(address: string): void {
    if (this.config.security.requireTLS && address.startsWith('ws://')) {
      const { ExplainableError } = require('../errors/ExplainableError.js');
      throw new ExplainableError({
        code: 'INSECURE_CONNECTION',
        title: 'TLS Required',
        message: 'Use wss:// instead of ws://',
        fixes: ['Enable TLS on worker', 'Use wss:// endpoint'],
      });
    }
  }

  private _getAdaptiveTimeout(baseTimeout: number, nodeId: string): number {
    if (!this.config.heartbeat?.adaptive) return baseTimeout;

    const metrics = this.nodeMetrics.get(nodeId);
    if (!metrics || metrics.avgLatencyMs === 0) return baseTimeout;

    const minTimeout = this.config.heartbeat.minTimeoutMs || 2000;
    const maxTimeout = this.config.heartbeat.maxTimeoutMs || 30000;

    const calculatedTimeout = Math.round(metrics.avgLatencyMs * 3);
    return Math.max(minTimeout, Math.min(maxTimeout, calculatedTimeout));
  }

  private updateNodeMetrics(
    nodeId: string,
    success: boolean,
    latencyMs: number
  ): void {
    let metrics = this.nodeMetrics.get(nodeId);

    if (!metrics) {
      metrics = {
        nodeId,
        successCount: 0,
        failureCount: 0,
        totalLatencyMs: 0,
        lastLatencyMs: latencyMs,
        successRate: 0,
        errorRate: 0,
        avgLatencyMs: latencyMs,
        rollingLatencies: [],
        lastUpdated: Date.now(),
      };
      this.nodeMetrics.set(nodeId, metrics);
    }

    if (success) {
      metrics.successCount++;
    } else {
      metrics.failureCount++;
    }

    metrics.totalLatencyMs += latencyMs;
    metrics.lastLatencyMs = latencyMs;

    metrics.rollingLatencies.push(latencyMs);
    if (metrics.rollingLatencies.length > ROLLING_WINDOW_SIZE) {
      metrics.rollingLatencies.shift();
    }

    const totalRequests = metrics.successCount + metrics.failureCount;
    metrics.successRate = metrics.successCount / totalRequests;
    metrics.errorRate = metrics.failureCount / totalRequests;

    const rollingSum = metrics.rollingLatencies.reduce((a, b) => a + b, 0);
    metrics.avgLatencyMs = Math.round(rollingSum / metrics.rollingLatencies.length);

    metrics.lastUpdated = Date.now();

    const worker = this.connectedWorkers.get(nodeId);
    if (worker) {
      worker.status.metrics = { ...metrics };
      worker.status.score = this.calculateNodeScore(metrics, worker.status.capabilities.currentLoad);
    }
  }

  private calculateNodeScore(metrics: NodeMetrics, currentLoad: number): number {
    const successScore = metrics.successRate * 30;
    const errorPenalty = metrics.errorRate * 20;
    const latencyPenalty = metrics.avgLatencyMs * 0.05;
    const loadPenalty = currentLoad * 10;

    return Math.max(0, Math.min(100, successScore - errorPenalty - latencyPenalty - loadPenalty));
  }

  pauseStream(taskId: string): void {
    this.pausedStreams.add(taskId);
  }

  resumeStream(taskId: string): void {
    this.pausedStreams.delete(taskId);
  }

  isStreamPaused(taskId: string): boolean {
    return this.pausedStreams.has(taskId);
  }

  getNodeMetrics(nodeId: string): NodeMetrics | undefined {
    return this.nodeMetrics.get(nodeId);
  }

  getAllNodeMetrics(): Map<string, NodeMetrics> {
    return new Map(this.nodeMetrics);
  }

  recordTaskResult(nodeId: string, success: boolean, latencyMs: number): void {
    this.updateNodeMetrics(nodeId, success, latencyMs);
  }

  async startController(port?: number): Promise<void> {
    if (this.role !== 'controller') {
      throw new Error('Cannot start controller on a worker node');
    }

    this.emit('network:controller-started', { port: port || this.config.worker?.port || 7890 });
  }

  async startWorker(port?: number): Promise<void> {
    if (this.role !== 'worker') {
      throw new Error('Cannot start worker on a controller node');
    }

    this.emit('network:worker-started', { port: port || this.config.worker?.port || 7890 });
  }

  async connectToWorker(address: string, name?: string): Promise<NodeStatus> {
    this.validateTLS(address);

    const connectionId = generateUUID();

    return new Promise((resolve, reject) => {
      this.pendingAuth.set(connectionId, {
        socket: null,
        address,
        name,
        resolve,
        reject,
      });

      setTimeout(() => {
        if (this.pendingAuth.has(connectionId)) {
          this.pendingAuth.delete(connectionId);
          reject(new Error(`Connection timeout to ${address}`));
        }
      }, 10000);

      const nodeId = generateUUID();
      const sessionId = generateUUID();

      const nodeStatus: NodeStatus = {
        identity: {
          id: nodeId,
          name: name || 'remote-worker',
          role: 'worker',
          version: '1.0.0',
          startedAt: Date.now(),
        },
        capabilities: {
          cpuCores: 8,
          totalRAMBytes: 16 * 1024 * 1024 * 1024,
          availableRAMBytes: 8 * 1024 * 1024 * 1024,
          gpus: [],
          providers: [],
          models: [
            { modelId: 'phi3:mini', provider: 'ollama', loaded: true, maxContextLength: 4096 },
          ],
          maxConcurrentTasks: 2,
          currentLoad: 0,
          platform: 'linux',
          arch: 'x64',
        },
        connectionState: 'ready',
        lastHeartbeat: Date.now(),
        activeTasks: [],
        score: 70,
      };

      const connection: WorkerConnection = {
        socket: null,
        nodeId,
        sessionId,
        address,
        status: nodeStatus,
        connectedAt: Date.now(),
      };

      this.connectedWorkers.set(nodeId, connection);

      this.emit('network:worker-connected', {
        nodeId: nodeId,
        name: name || 'remote-worker',
        models: ['phi3:mini'],
        gpus: [],
      });

      resolve(nodeStatus);
    });
  }

  handleIncomingConnection(socket: unknown, request?: { socket?: { remoteAddress?: string; getPeerCertificate?: () => unknown } }): void {
    const remoteIP = (request?.socket?.remoteAddress) || 'unknown';

    if (this.isIPBanned(remoteIP)) {
      this.emit('network:connection-rejected', { reason: 'IP banned', ip: remoteIP });
      return;
    }

    if (this.config.security.trustedFingerprints?.length) {
      const cert = request?.socket;
      const fingerprint = this._extractFingerprint(cert);
      if (!this._validateCertificateFingerprint(fingerprint)) {
        this.emit('network:connection-rejected', { reason: 'Invalid TLS fingerprint', ip: remoteIP });
        return;
      }
    }

    this.setupSocketHandlers(socket as unknown as { on: EventHandler; send: (data: string) => void; close: () => void }, remoteIP);
  }

  private _extractFingerprint(cert: unknown): string | undefined {
    if (!cert || typeof cert !== 'object') return undefined;
    const certObj = cert as { getPeerCertificate?: () => { fingerprintSHA256?: string } };
    if (typeof certObj.getPeerCertificate === 'function') {
      const peerCert = certObj.getPeerCertificate();
      return peerCert?.fingerprintSHA256;
    }
    return undefined;
  }

  private _validateCertificateFingerprint(fingerprint: string | undefined): boolean {
    const trusted = this.config.security.trustedFingerprints || [];
    if (trusted.length === 0) return true;
    if (!fingerprint) return false;
    return trusted.includes(fingerprint);
  }

  private setupSocketHandlers(socket: { on: EventHandler; send: (data: string) => void; close: () => void }, remoteIP: string): void {
    socket.on('message', (data: unknown) => {
      this.handleMessage(socket, data, remoteIP);
    });

    socket.on('close', () => {
      this.emit('network:socket-closed', { remoteIP });
    });
  }

  private handleMessage(socket: { on: EventHandler; send: (data: string) => void; close: () => void }, data: unknown, remoteIP: string): void {
    const rawMessage = parseMessage(data as string);
    if (!rawMessage) {
      this.emit('network:invalid-message', { issues: ['Failed to parse message'] });
      return;
    }

    const message = rawMessage as NetworkMessage;

    if (this.processedMessageIds.has(message.messageId)) {
      return;
    }
    this.processedMessageIds.add(message.messageId);

    if (message.type === 'auth:response') {
      this.handleAuthResponse(socket, message, remoteIP);
      return;
    }

    if (this.config.security.requireSignedMessages && message.type !== 'auth:challenge') {
      if (!verifyMessage(message, this.sharedKey)) {
        this.emit('network:signature-failed', {
          messageId: message.messageId,
          type: message.type,
          from: message.from,
        });
        return;
      }
    }

    const validation = validateMessage(message);
    if (!validation.valid) {
      this.emit('network:invalid-message', { issues: validation.issues });
      return;
    }

    switch (message.type) {
      case 'auth:challenge':
        this.handleAuthChallenge(socket, message);
        break;
      case 'heartbeat:ping':
        this.handleHeartbeatPing(socket, message);
        break;
      case 'task:stream':
        this.handleTaskStream(message);
        break;
      case 'task:pause':
        this.handleTaskPause(message);
        break;
      case 'task:resume':
        this.handleTaskResume(message);
        break;
      case 'task:rejected':
        this.handleTaskRejected(message);
        break;
      case 'task:result':
        this.handleTaskResult(message);
        break;
      case 'task:error':
        this.handleTaskError(message);
        break;
      case 'control:disconnect':
        this.handleDisconnect(message);
        break;
      default:
        this.emit(`message:${message.type}`, message);
    }
  }

  private handleTaskPause(message: NetworkMessage): void {
    const payload = message.payload as TaskPausePayload;
    this.pauseStream(payload.taskId);
    this.emit('task:pause', payload);
  }

  private handleTaskResume(message: NetworkMessage): void {
    const payload = message.payload as TaskResumePayload;
    this.resumeStream(payload.taskId);
    this.emit('task:resume', payload);
  }

  private handleTaskStream(message: NetworkMessage): void {
    const payload = message.payload as TaskStreamPayload;
    this.emit('task:stream', payload);

    if (payload.isComplete) {
      this.emit('task:stream-complete', { taskId: payload.taskId });
    }
  }

  private handleTaskRejected(message: NetworkMessage): void {
    const payload = message.payload as TaskRejectedPayload;
    this.emit('task:rejected', payload);
  }

  private handleAuthChallenge(socket: { on: EventHandler; send: (data: string) => void; close: () => void }, message: NetworkMessage): void {
    const challenge = (message.payload as AuthChallengePayload).challenge;
    const response = createHMAC('sha256', this.sharedKey, challenge);

    const responseMsg: NetworkMessage = {
      protocolVersion: 1,
      messageId: generateUUID(),
      timestamp: Date.now(),
      type: 'auth:response',
      from: this.identity.id,
      to: message.from,
      payload: {
        response,
        workerNodeId: this.identity.id,
        workerName: this.identity.name,
        protocolVersion: 1,
      } as AuthResponsePayload,
    };

    socket.send(serializeMessageToString(responseMsg));
  }

  private handleAuthResponse(socket: { on: EventHandler; send: (data: string) => void; close: () => void }, message: NetworkMessage, remoteIP: string): void {
    const payload = message.payload as AuthResponsePayload;
    const sessionId = generateUUID();

    const nodeStatus: NodeStatus = {
      identity: {
        id: payload.workerNodeId,
        name: payload.workerName,
        role: 'worker',
        version: '',
        startedAt: Date.now(),
      },
      capabilities: {
        cpuCores: 8,
        totalRAMBytes: 32 * 1024 * 1024 * 1024,
        availableRAMBytes: 16 * 1024 * 1024 * 1024,
        gpus: [],
        providers: [],
        models: [],
        maxConcurrentTasks: 4,
        currentLoad: 0,
        platform: 'linux',
        arch: 'x64',
      },
      connectionState: 'ready',
      lastHeartbeat: Date.now(),
      activeTasks: [],
      score: 75,
    };

    const authResultMsg: NetworkMessage = {
      protocolVersion: 1,
      messageId: generateUUID(),
      timestamp: Date.now(),
      type: 'auth:result',
      from: this.identity.id,
      to: message.from,
      payload: {
        accepted: true,
        sessionId,
        sessionExpiresAt: Date.now() + this.config.security.sessionTimeoutMs,
      } as AuthResultPayload,
    };

    socket.send(serializeMessageToString(authResultMsg, this.sharedKey, this.isCompressionEnabled()));

    const connection: WorkerConnection = {
      socket,
      nodeId: payload.workerNodeId,
      sessionId,
      address: remoteIP,
      status: nodeStatus,
      connectedAt: Date.now(),
    };

    this.connectedWorkers.set(payload.workerNodeId, connection);
    this.startHeartbeat(socket, payload.workerNodeId);

    this.emit('network:worker-connected', {
      nodeId: payload.workerNodeId,
      name: payload.workerName,
      models: nodeStatus.capabilities.models.map((m) => m.modelId),
      gpus: nodeStatus.capabilities.gpus.map((g) => g.name),
    });
  }

  private handleHeartbeatPing(socket: { on: EventHandler; send: (data: string) => void; close: () => void }, message: NetworkMessage): void {
    const pongMsg: NetworkMessage = {
      protocolVersion: 1,
      messageId: generateUUID(),
      timestamp: Date.now(),
      type: 'heartbeat:pong',
      from: this.identity.id,
      to: message.from,
      payload: { timestamp: Date.now() },
    };

    socket.send(serializeMessageToString(pongMsg, this.sharedKey, this.isCompressionEnabled()));

    const worker = this.connectedWorkers.get(message.from);
    if (worker) {
      worker.status.lastHeartbeat = Date.now();
    }
  }

  private handleTaskResult(message: NetworkMessage): void {
    this.emit('distribution:task-result', message.payload);
  }

  private handleTaskError(message: NetworkMessage): void {
    this.emit('distribution:task-error', message.payload);
  }

  private handleDisconnect(message: NetworkMessage): void {
    const worker = this.connectedWorkers.get(message.from);
    if (worker) {
      this.emit('network:worker-disconnected', {
        nodeId: message.from,
        name: worker.status.identity.name,
        reason: 'Disconnect requested',
        activeTasks: worker.status.activeTasks,
      });
      this.connectedWorkers.delete(message.from);
    }
  }

  private startHeartbeat(socket: { on: EventHandler; send: (data: string) => void; close: () => void }, nodeId: string): void {
    const interval = setInterval(() => {
      const pingMsg: NetworkMessage = {
        protocolVersion: 1,
        messageId: generateUUID(),
        timestamp: Date.now(),
        type: 'heartbeat:ping',
        from: this.identity.id,
        to: nodeId,
        payload: { timestamp: Date.now() },
      };

      socket.send(serializeMessageToString(pingMsg, this.sharedKey, this.isCompressionEnabled()));
    }, this.config.heartbeat.intervalMs);

    this.heartbeatIntervals.set(nodeId, interval);

    const checkInterval = setInterval(() => {
      const worker = this.connectedWorkers.get(nodeId);
      if (!worker) {
        clearInterval(checkInterval);
        clearInterval(interval);
        return;
      }

      const timeSinceLastHeartbeat = Date.now() - worker.status.lastHeartbeat;
      const adaptiveTimeout = this._getAdaptiveTimeout(this.config.heartbeat.timeoutMs, nodeId);
      const missedThreshold = adaptiveTimeout * this.config.heartbeat.missedBeforeDisconnect;

      if (timeSinceLastHeartbeat > missedThreshold) {
        if (timeSinceLastHeartbeat > missedThreshold * 2) {
          clearInterval(checkInterval);
          clearInterval(interval);
          this.handleNodeDisconnect(nodeId, 'heartbeat timeout');
        } else {
          worker.status.degraded = true;
          this.emit('network:node-degraded', { nodeId, reason: 'missed heartbeats', timeSinceLastHeartbeat });
        }
      }
    }, this.config.heartbeat.intervalMs);

    this.heartbeatTimeouts.set(nodeId, checkInterval);
  }

  private handleNodeDisconnect(nodeId: string, reason: string): void {
    const worker = this.connectedWorkers.get(nodeId);
    if (!worker) return;

    worker.status.connectionState = 'disconnected';

    const interval = this.heartbeatIntervals.get(nodeId);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(nodeId);
    }

    const timeout = this.heartbeatTimeouts.get(nodeId);
    if (timeout) {
      clearInterval(timeout);
      this.heartbeatTimeouts.delete(nodeId);
    }

    this.emit('network:worker-disconnected', {
      nodeId,
      name: worker.status.identity.name,
      reason,
      activeTasks: worker.status.activeTasks,
    });

    this.connectedWorkers.delete(nodeId);
  }

  private isIPBanned(ip: string): boolean {
    const banExpiry = this.bannedIPs.get(ip);
    if (!banExpiry) return false;
    if (Date.now() > banExpiry) {
      this.bannedIPs.delete(ip);
      return false;
    }
    return true;
  }

  sendMessage(socket: unknown, type: NetworkMessageType, payload: unknown, to?: string): void {
    const ws = socket as { send: (data: string) => void };
    const message: NetworkMessage = {
      protocolVersion: 1,
      messageId: generateUUID(),
      timestamp: Date.now(),
      type,
      from: this.identity.id,
      to: to || '',
      payload,
    };

    ws.send(serializeMessageToString(
      message,
      this.config.security.requireSignedMessages ? this.sharedKey : undefined,
      this.isCompressionEnabled()
    ));
  }

  getConnectedWorkers(): NodeStatus[] {
    return Array.from(this.connectedWorkers.values()).map((w) => w.status);
  }

  getWorkerConnection(nodeId: string): WorkerConnection | null {
    return this.connectedWorkers.get(nodeId) || null;
  }

  hasWorkers(): boolean {
    return this.connectedWorkers.size > 0;
  }

  getNetworkCapacity(): NetworkCapacity {
    let totalModels = new Set<string>();
    let totalGPUs = 0;
    let totalRAM = 0;
    let totalSlots = 0;
    let usedSlots = 0;

    for (const worker of this.connectedWorkers.values()) {
      if (worker.status.connectionState !== 'ready' && worker.status.connectionState !== 'busy') {
        continue;
      }

      for (const model of worker.status.capabilities.models) {
        totalModels.add(model.modelId);
      }
      totalGPUs += worker.status.capabilities.gpus.filter((g) => g.available).length;
      totalRAM += worker.status.capabilities.availableRAMBytes;
      totalSlots += worker.status.capabilities.maxConcurrentTasks;
      usedSlots += worker.status.capabilities.currentLoad;
    }

    return {
      connectedNodes: this.connectedWorkers.size,
      readyNodes: Array.from(this.connectedWorkers.values()).filter(
        (w) => w.status.connectionState === 'ready'
      ).length,
      totalModels: Array.from(totalModels),
      totalGPUs,
      totalRAMBytes: totalRAM,
      totalTaskSlots: totalSlots,
      usedTaskSlots: usedSlots,
      availableTaskSlots: totalSlots - usedSlots,
    };
  }

  async shutdown(): Promise<void> {
    for (const [nodeId, worker] of this.connectedWorkers) {
      if (worker.socket) {
        this.sendMessage(worker.socket, 'control:disconnect', { reason: 'controller shutting down' }, nodeId);
      }
    }

    for (const interval of this.heartbeatIntervals.values()) {
      clearInterval(interval);
    }

    for (const timeout of this.heartbeatTimeouts.values()) {
      clearInterval(timeout);
    }

    this.heartbeatIntervals.clear();
    this.heartbeatTimeouts.clear();
    this.connectedWorkers.clear();
  }
}

let globalNetworkManager: NetworkManager | null = null;

export function initNetworkManager(
  role: NodeRole,
  identity: NodeIdentity,
  config: NetworkConfig
): NetworkManager {
  globalNetworkManager = new NetworkManager(role, identity, config);
  return globalNetworkManager;
}

export function getNetworkManager(): NetworkManager | null {
  return globalNetworkManager;
}

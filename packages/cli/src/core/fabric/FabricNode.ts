import { EventEmitter } from 'events';
import os from 'os';
import { join } from 'path';
import { FabricIdentityStore } from './IdentityStore.js';
import { FabricMembershipStore } from './FabricMembershipStore.js';
import { CapabilityRegistry } from './CapabilityRegistry.js';
import { createFabricMessage, fingerprintPublicKey, validateFabricMessage, verifyFabricMessage } from './FabricProtocol.js';
import type {
  FabricClusterConfig, FabricHeartbeatPayload, FabricMessage, FabricNodeCapabilities, FabricNodeRecord,
} from './types.js';

export class FabricNode extends EventEmitter {
  readonly identityStore: FabricIdentityStore;
  readonly membership: FabricMembershipStore;
  readonly capabilities = new CapabilityRegistry();
  private identity?: FabricNodeRecord['identity'];
  private privateKey?: string;
  private readonly trustedPeers = new Map<string, string>();
  private readonly trustedPeers: Map<string, string>;

  constructor(private readonly config: FabricClusterConfig) {
    super();
    this.identityStore = new FabricIdentityStore(join(config.rootDir, 'identity.json'));
    this.membership = new FabricMembershipStore(join(config.rootDir, 'membership.json'), config.clusterId);
    this.trustedPeers = new Map((config.trustedPeers ?? []).map((peer) => [peer.nodeId, peer.publicKey]));
  }

  async initialize(): Promise<FabricNodeRecord> {
    const stored = await this.identityStore.loadOrCreate(this.config.nodeName, this.config.eamilosVersion);
    this.identity = stored.identity;
    this.privateKey = stored.privateKey;
    const capabilities = await this.scanCapabilities();
    const record: FabricNodeRecord = {
      identity: stored.identity, capabilities, state: 'online', lastSeenAt: Date.now(), activeTasks: 0,
    };
    await this.membership.upsert(record);
    this.capabilities.upsert(record);
    this.emit('initialized', record);
    return record;
  }

  get nodeId(): string {
    if (!this.identity) throw new Error('FabricNode has not been initialized');
    return this.identity.nodeId;
  }

  get nodeIdentity(): FabricNodeRecord['identity'] {
    if (!this.identity) throw new Error('FabricNode has not been initialized');
    return this.identity;
  }

  async updateCapabilities(capabilities: FabricNodeCapabilities): Promise<FabricNodeRecord> {
    const current = this.capabilities.get(this.nodeId);
    if (!current) throw new Error('FabricNode has not been initialized');
    const record = { ...current, capabilities, lastSeenAt: Date.now() };
    await this.membership.upsert(record);
    this.capabilities.upsert(record);
    this.emit('capabilities:updated', record);
    return record;
  }

  trustPeer(nodeId: string, publicKey: string): void {
    this.trustedPeers.set(nodeId, publicKey);
  }

  isTrustedPeer(nodeId: string, publicKey: string): boolean {
    return this.trustedPeers.get(nodeId) === publicKey;
  }

  createMessage<T>(type: FabricMessage<T>['type'], payload: T, to?: string): FabricMessage<T> {
    if (!this.privateKey) throw new Error('FabricNode has not been initialized');
    return createFabricMessage(type, this.nodeId, this.privateKey, payload, to);
  }

  verifyPeerMessage(message: FabricMessage): boolean {
    const knownKey = this.capabilities.get(message.from)?.identity.publicKey ?? this.trustedPeers.get(message.from);
    return !!knownKey && validateFabricMessage(message).length === 0 &&
      verifyFabricMessage(message, knownKey);
  }

  heartbeatPayload(): FabricHeartbeatPayload {
    const record = this.capabilities.get(this.nodeId);
    if (!record) throw new Error('FabricNode has not been initialized');
    return { state: record.state, capabilities: record.capabilities, activeTasks: record.activeTasks };
  }

  publicKeyFingerprint(): string {
    return fingerprintPublicKey(this.nodeIdentity.publicKey);
  }

  private async scanCapabilities(): Promise<FabricNodeCapabilities> {
    return {
      platform: os.platform(), arch: os.arch(), cpuCores: os.cpus().length,
      totalRAMBytes: os.totalmem(), availableRAMBytes: os.freemem(),
      gpus: [], harnesses: [], models: [], providers: [], tools: [], maxConcurrentTasks: 1,
    };
  }
}

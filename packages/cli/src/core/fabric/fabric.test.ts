import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { FabricIdentityStore } from './IdentityStore.js';
import { FabricMembershipStore } from './FabricMembershipStore.js';
import { CapabilityRegistry } from './CapabilityRegistry.js';
import { createFabricMessage, validateFabricMessage, verifyFabricMessage } from './FabricProtocol.js';
import { FabricNode } from './FabricNode.js';
import { FabricTransport } from './FabricTransport.js';

describe('Phase 6 device fabric', () => {
  it('persists a stable node identity and private key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eamilos-fabric-'));
    try {
      const store = new FabricIdentityStore(join(root, 'identity.json'));
      const first = await store.loadOrCreate('node-a', '1.9.0');
      const second = await store.loadOrCreate('node-a', '1.9.0');
      expect(second.identity.nodeId).toBe(first.identity.nodeId);
      expect(second.identity.publicKey).toBe(first.identity.publicKey);
      expect(second.privateKey).toBe(first.privateKey);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('signs and verifies peer messages and rejects stale messages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eamilos-fabric-'));
    try {
      const store = new FabricIdentityStore(join(root, 'identity.json'));
      const identity = await store.loadOrCreate('node-a', '1.9.0');
      const message = createFabricMessage('cluster:heartbeat', identity.identity.nodeId, identity.privateKey, { ok: true });
      expect(validateFabricMessage(message)).toEqual([]);
      expect(verifyFabricMessage(message, identity.identity.publicKey)).toBe(true);
      expect(verifyFabricMessage({ ...message, payload: { ok: false } }, identity.identity.publicKey)).toBe(false);
      expect(validateFabricMessage({ ...message, timestamp: Date.now() - 31_000 })[0]).toContain('Message too old');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists membership and indexes capabilities', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eamilos-fabric-'));
    try {
      const identity = await new FabricIdentityStore(join(root, 'identity.json')).loadOrCreate('node-a', '1.9.0');
      const node = {
        identity: identity.identity,
        capabilities: {
          platform: 'linux', arch: 'x64', cpuCores: 8, totalRAMBytes: 100, availableRAMBytes: 50,
          gpus: [], harnesses: ['opencode'], models: ['laya'], providers: ['ollama'],
          tools: ['git'], maxConcurrentTasks: 2,
        },
        state: 'online' as const, lastSeenAt: Date.now(), activeTasks: 0,
      };
      const store = new FabricMembershipStore(join(root, 'membership.json'), 'cluster-a');
      await store.upsert(node);
      const state = await store.load();
      const registry = new CapabilityRegistry();
      registry.upsert(state.nodes[0]);
      expect(registry.findModel('laya')).toHaveLength(1);
      expect(registry.findHarness('opencode')).toHaveLength(1);
      expect(registry.findAvailable()).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('connects two trusted peers without a permanent controller role', async () => {
    const rootA = await mkdtemp(join(tmpdir(), 'eamilos-fabric-a-'));
    const rootB = await mkdtemp(join(tmpdir(), 'eamilos-fabric-b-'));
    try {
      const a = new FabricNode({ rootDir: rootA, clusterId: 'cluster-a', nodeName: 'A', eamilosVersion: '1.9.0' });
      const b = new FabricNode({ rootDir: rootB, clusterId: 'cluster-a', nodeName: 'B', eamilosVersion: '1.9.0' });
      await a.initialize();
      await b.initialize();
      a.trustPeer(b.nodeId, b.nodeIdentity.publicKey);
      b.trustPeer(a.nodeId, a.nodeIdentity.publicKey);

      const ta = new FabricTransport(a, [{ nodeId: b.nodeId, publicKey: b.nodeIdentity.publicKey, address: '' }]);
      const tb = new FabricTransport(b, [{ nodeId: a.nodeId, publicKey: a.nodeIdentity.publicKey, address: '' }]);
      const port = await tb.start(0);
      const received = new Promise<void>((resolve) => ta.on('peer:connected', () => resolve()));
      await ta.connect({ nodeId: b.nodeId, publicKey: b.nodeIdentity.publicKey, address: 'ws://127.0.0.1:' + port });
      await received;
      expect(ta.connectedPeers()).toContain(b.nodeId);
      expect(tb.connectedPeers()).toContain(a.nodeId);
      await ta.stop();
      await tb.stop();
    } finally {
      await rm(rootA, { recursive: true, force: true });
      await rm(rootB, { recursive: true, force: true });
    }
  });
});

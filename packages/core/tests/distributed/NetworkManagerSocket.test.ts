import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Server } from 'socket.io';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { CommsGround } from '../../src/collaboration/CommsGround.js';
import { NetworkManager } from '../../src/distributed/NetworkManager.js';
import type { NodeIdentity, NodeRole, NetworkConfig } from '../../src/distributed/types.js';

describe('NetworkManager Socket.IO', () => {
  let networkManager: NetworkManager;
  let commsGround: CommsGround;
  let ioServer: Server;
  let testPort = 0;

  const createTestConfig = (role: NodeRole): { config: NetworkConfig; identity: NodeIdentity } => ({
    config: {
      security: {
        sharedKey: 'test-secret-key',
        requireTLS: false,
        requireSignedMessages: false,
        sessionTimeoutMs: 30000
      },
      heartbeat: {
        enabled: true,
        intervalMs: 5000,
        timeoutMs: 10000,
        adaptive: false,
        missedBeforeDisconnect: 3
      },
      worker: { port: testPort },
      compression: { enabled: false }
    },
    identity: {
      id: 'test-node',
      name: `test-${role}`,
      role,
      version: '1.0.0',
      startedAt: Date.now()
    }
  });

  beforeEach(async () => {
    commsGround = new CommsGround();
    
    const { config, identity } = createTestConfig('controller');
    networkManager = new NetworkManager('controller', identity, config);
  });

  afterEach(async () => {
    await networkManager.shutdown();
  });

  it('should export required types', () => {
    expect(NetworkManager).toBeDefined();
  });

  it('should have Socket.IO dependencies installed', () => {
    expect(Server).toBeDefined();
    expect(io).toBeDefined();
  });
});
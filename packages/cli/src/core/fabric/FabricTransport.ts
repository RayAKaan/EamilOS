import { EventEmitter } from 'events';
import { WebSocket, WebSocketServer } from 'ws';
import type { AddressInfo } from 'net';
import { FabricNode } from './FabricNode.js';
import type { FabricMessage } from './types.js';

export interface FabricPeerConfig {
  nodeId: string;
  address: string;
  publicKey: string;
}

export class FabricTransport extends EventEmitter {
  private server?: WebSocketServer;
  private readonly sockets = new Map<string, WebSocket>();

  constructor(private readonly node: FabricNode, private readonly peers: FabricPeerConfig[] = []) {
    super();
  }

  async start(port = 0, host = '127.0.0.1'): Promise<number> {
    if (this.server) throw new Error('Fabric transport already started');
    this.server = new WebSocketServer({ port, host });
    this.server.on('connection', (socket) => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('listening', () => resolve());
      this.server!.once('error', reject);
    });
    return (this.server.address() as AddressInfo).port;
  }

  async connect(peer: FabricPeerConfig): Promise<void> {
    const socket = new WebSocket(peer.address);
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => { cleanup(); resolve(); };
      const onError = (error: Error) => { cleanup(); reject(error); };
      const cleanup = () => {
        socket.off('open', onOpen);
        socket.off('error', onError);
      };
      socket.once('open', onOpen);
      socket.once('error', onError);
    });
    this.bind(peer, socket);
    socket.send(JSON.stringify(this.node.createMessage('cluster:hello', {
      nodeId: this.node.nodeId,
      publicKey: this.node.nodeIdentity.publicKey,
    })));
  }

  send<T>(peerNodeId: string, message: FabricMessage<T>): void {
    const socket = this.sockets.get(peerNodeId);
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('Peer is not connected: ' + peerNodeId);
    }
    socket.send(JSON.stringify(message));
  }

  connectedPeers(): string[] {
    return [...this.sockets.keys()];
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets.values()) socket.close();
    this.sockets.clear();
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
  }

  private accept(socket: WebSocket): void {
    socket.once('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as FabricMessage<{ nodeId: string; publicKey: string }>;
        if (message.type !== 'cluster:hello') {
          socket.close(1008, 'hello required');
          return;
        }
        const peer = this.peers.find((candidate) => candidate.nodeId === message.from);
        if (!peer || peer.publicKey !== message.payload.publicKey || !this.node.verifyPeerMessage(message)) {
          socket.close(1008, 'untrusted peer');
          return;
        }
        this.bind(peer, socket);
        this.emit('peer:connected', peer.nodeId);
        socket.send(JSON.stringify(this.node.createMessage('cluster:welcome', {
          nodeId: this.node.nodeId,
          publicKey: this.node.nodeIdentity.publicKey,
        }, peer.nodeId)));
      } catch {
        socket.close(1008, 'invalid message');
      }
    });
  }

  private bind(peer: FabricPeerConfig, socket: WebSocket): void {
    this.sockets.set(peer.nodeId, socket);
    socket.on('message', (raw) => this.handleMessage(peer, raw.toString()));
    socket.on('close', () => {
      if (this.sockets.get(peer.nodeId) === socket) this.sockets.delete(peer.nodeId);
      this.emit('peer:disconnected', peer.nodeId);
    });
  }

  private handleMessage(peer: FabricPeerConfig, raw: string): void {
    try {
      const message = JSON.parse(raw) as FabricMessage;
      if (message.from !== peer.nodeId || !this.node.verifyPeerMessage(message)) {
        this.emit('message:rejected', { peer: peer.nodeId, message });
        return;
      }
      if (message.type === 'cluster:welcome' && message.to === this.node.nodeId) {
        this.emit('peer:connected', peer.nodeId);
      }
      this.emit('message', message);
    } catch {
      this.emit('message:rejected', { peer: peer.nodeId });
    }
  }
}

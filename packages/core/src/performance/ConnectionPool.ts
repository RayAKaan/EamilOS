import { EventEmitter } from 'events';

interface PooledConnection {
  key: string;
  instance: unknown;
  state: 'active' | 'idle';
  lastUsed: number;
  created: number;
}

export class ConnectionPool extends EventEmitter {
  private connections: Map<string, PooledConnection> = new Map();
  private maxSize: number;
  private idleTimeout: number;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(maxSize: number = 10, idleTimeout: number = 30000) {
    super();
    this.maxSize = maxSize;
    this.idleTimeout = idleTimeout;
    this.startCleanup();
  }

  async acquire<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.connections.get(key);

    if (existing && existing.state === 'idle') {
      existing.state = 'active';
      existing.lastUsed = Date.now();
      this.emit('connection:reused', { key });
      return existing.instance as T;
    }

    if (this.connections.size >= this.maxSize) {
      await this.evictLeastRecentlyUsed();
    }

    const instance = await factory();
    const conn: PooledConnection = {
      key,
      instance,
      state: 'active',
      lastUsed: Date.now(),
      created: Date.now()
    };

    this.connections.set(key, conn);
    this.emit('connection:acquired', { key });

    return instance;
  }

  release(key: string): void {
    const conn = this.connections.get(key);
    if (conn && conn.state === 'active') {
      conn.state = 'idle';
      this.emit('connection:released', { key });
    }
  }

  async remove(key: string): Promise<void> {
    const conn = this.connections.get(key);
    if (conn) {
      await this.destroyConnection(key, conn.instance);
      this.connections.delete(key);
      this.emit('connection:removed', { key });
    }
  }

  private async evictLeastRecentlyUsed(): Promise<void> {
    const idle = Array.from(this.connections.values())
      .filter(c => c.state === 'idle')
      .sort((a, b) => a.lastUsed - b.lastUsed);

    if (idle.length > 0) {
      const toEvict = idle[0];
      await this.destroyConnection(toEvict.key, toEvict.instance);
      this.connections.delete(toEvict.key);
      this.emit('connection:evicted', { key: toEvict.key });
    }
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();

      for (const [key, conn] of this.connections) {
        if (conn.state === 'idle' && now - conn.lastUsed > this.idleTimeout) {
          this.destroyConnection(key, conn.instance);
          this.connections.delete(key);
          this.emit('connection:expired', { key });
        }
      }
    }, this.idleTimeout);
  }

  protected async destroyConnection(_key: string, _instance: unknown): Promise<void> {
    // Override in subclass to close connections
  }

  getMetrics() {
    const active = Array.from(this.connections.values()).filter(c => c.state === 'active').length;
    const idle = this.connections.size - active;

    return {
      total: this.connections.size,
      maxSize: this.maxSize,
      active,
      idle,
      utilization: this.connections.size / this.maxSize
    };
  }

  getActiveConnections(): string[] {
    return Array.from(this.connections.entries())
      .filter(([, c]) => c.state === 'active')
      .map(([key]) => key);
  }

  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    for (const [key, conn] of this.connections) {
      await this.destroyConnection(key, conn.instance);
    }
    this.connections.clear();
    this.emit('pool:shutdown');
  }
}
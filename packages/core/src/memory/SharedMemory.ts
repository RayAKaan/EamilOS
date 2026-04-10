import type { AgentRole } from '../collaboration/AgentType.js';

export type ConflictResolution = 'last-write-wins' | 'version-merge' | 'reject-conflict' | 'notify';

export interface MemoryEntry<T = unknown> {
  key: string;
  value: T;
  version: number;
  timestamp: number;
  agentId: string;
  role?: AgentRole;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ConflictEvent {
  key: string;
  existing: MemoryEntry;
  incoming: MemoryEntry;
  resolution: ConflictResolution;
  resolvedValue?: unknown;
  timestamp: number;
}

export interface SharedMemoryConfig {
  conflictResolution: ConflictResolution;
  maxEntries: number;
  ttl?: number;
  onConflict?: (event: ConflictEvent) => void;
}

const DEFAULT_CONFIG: SharedMemoryConfig = {
  conflictResolution: 'last-write-wins',
  maxEntries: 1000,
};

export class SharedMemory<T = unknown> {
  private store: Map<string, MemoryEntry<T>> = new Map();
  private versionHistory: Map<string, MemoryEntry<T>[]> = new Map();
  private config: SharedMemoryConfig;
  private conflictListeners: Array<(event: ConflictEvent) => void> = [];

  constructor(config: Partial<SharedMemoryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  set(
    key: string,
    value: T,
    agentId: string,
    role?: AgentRole,
    metadata?: Record<string, unknown>
  ): MemoryEntry<T> {
    const existing = this.store.get(key);

    if (existing && existing.agentId !== agentId) {
      const conflict = this.resolveConflict(key, existing, {
        key,
        value,
        version: existing.version + 1,
        timestamp: Date.now(),
        agentId,
        role,
        metadata,
      });

      return conflict;
    }

    const entry: MemoryEntry<T> = {
      key,
      value,
      version: existing ? existing.version + 1 : 1,
      timestamp: Date.now(),
      agentId,
      role,
      metadata,
    };

    this.store.set(key, entry);
    this.addToHistory(entry);
    this.pruneIfNeeded();

    return entry;
  }

  get(key: string): MemoryEntry<T> | undefined {
    const entry = this.store.get(key);

    if (entry && this.config.ttl) {
      const age = Date.now() - entry.timestamp;
      if (age > this.config.ttl) {
        this.store.delete(key);
        return undefined;
      }
    }

    return entry;
  }

  getValue(key: string): T | undefined {
    return this.get(key)?.value;
  }

  delete(key: string, agentId?: string): boolean {
    const existing = this.store.get(key);

    if (!existing) {
      return false;
    }

    if (agentId && existing.agentId !== agentId) {
      return false;
    }

    this.store.delete(key);
    return true;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  keys(pattern?: string): string[] {
    const allKeys = Array.from(this.store.keys());

    if (!pattern) {
      return allKeys;
    }

    const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
    return allKeys.filter(k => regex.test(k));
  }

  entries(pattern?: string): MemoryEntry<T>[] {
    return this.keys(pattern).map(k => this.store.get(k)!).filter(Boolean);
  }

  getByTag(tag: string): MemoryEntry<T>[] {
    return Array.from(this.store.values()).filter(e => e.tags?.includes(tag));
  }

  getByAgent(agentId: string): MemoryEntry<T>[] {
    return Array.from(this.store.values()).filter(e => e.agentId === agentId);
  }

  getByRole(role: AgentRole): MemoryEntry<T>[] {
    return Array.from(this.store.values()).filter(e => e.role === role);
  }

  getVersion(key: string): number {
    return this.store.get(key)?.version || 0;
  }

  getHistory(key: string, limit?: number): MemoryEntry<T>[] {
    const history = this.versionHistory.get(key) || [];
    return limit ? history.slice(-limit) : history;
  }

  private resolveConflict(
    key: string,
    existing: MemoryEntry<T>,
    incoming: MemoryEntry<T>
  ): MemoryEntry<T> {
    const conflictEvent: ConflictEvent = {
      key,
      existing,
      incoming,
      resolution: this.config.conflictResolution,
      timestamp: Date.now(),
    };

    let resolved: MemoryEntry<T>;

    switch (this.config.conflictResolution) {
      case 'last-write-wins':
        resolved = incoming;
        break;

      case 'version-merge':
        resolved = this.mergeVersions(existing, incoming);
        break;

      case 'reject-conflict':
        resolved = { ...existing };
        conflictEvent.resolvedValue = existing.value;
        break;

      case 'notify':
        resolved = incoming;
        conflictEvent.resolvedValue = incoming.value;
        break;

      default:
        resolved = incoming;
    }

    conflictEvent.resolvedValue = resolved.value;
    this.emitConflict(conflictEvent);

    this.store.set(key, resolved);
    this.addToHistory(resolved);

    return resolved;
  }

  private mergeVersions(existing: MemoryEntry<T>, incoming: MemoryEntry<T>): MemoryEntry<T> {
    if (typeof existing.value === 'object' && existing.value !== null && typeof incoming.value === 'object' && incoming.value !== null) {
      return {
        ...incoming,
        value: {
          ...(existing.value as Record<string, unknown>),
          ...(incoming.value as Record<string, unknown>),
        } as T,
        version: Math.max(existing.version, incoming.version) + 1,
      };
    }

    return incoming.timestamp > existing.timestamp ? incoming : existing;
  }

  private addToHistory(entry: MemoryEntry<T>): void {
    const history = this.versionHistory.get(entry.key) || [];
    history.push(entry);

    if (history.length > 10) {
      history.shift();
    }

    this.versionHistory.set(entry.key, history);
  }

  private pruneIfNeeded(): void {
    if (this.store.size <= this.config.maxEntries) {
      return;
    }

    const entries = Array.from(this.store.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);

    const toRemove = entries.slice(0, Math.floor(this.config.maxEntries * 0.2));

    for (const [key] of toRemove) {
      this.store.delete(key);
      this.versionHistory.delete(key);
    }
  }

  private emitConflict(event: ConflictEvent): void {
    if (this.config.onConflict) {
      this.config.onConflict(event);
    }

    for (const listener of this.conflictListeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }

  onConflict(listener: (event: ConflictEvent) => void): () => void {
    this.conflictListeners.push(listener);
    return () => {
      const idx = this.conflictListeners.indexOf(listener);
      if (idx >= 0) {
        this.conflictListeners.splice(idx, 1);
      }
    };
  }

  clear(): void {
    this.store.clear();
    this.versionHistory.clear();
  }

  size(): number {
    return this.store.size;
  }

  snapshot(): Record<string, MemoryEntry<T>> {
    const snapshot: Record<string, MemoryEntry<T>> = {};
    for (const [key, entry] of this.store) {
      snapshot[key] = { ...entry };
    }
    return snapshot;
  }

  restore(snapshot: Record<string, MemoryEntry<T>>): void {
    this.store.clear();
    this.versionHistory.clear();

    for (const [key, entry] of Object.entries(snapshot)) {
      this.store.set(key, { ...entry });
      this.versionHistory.set(key, [{ ...entry }]);
    }
  }
}

let globalSharedMemory: SharedMemory<unknown> | null = null;

export function initSharedMemory<T = unknown>(config?: Partial<SharedMemoryConfig>): SharedMemory<T> {
  globalSharedMemory = new SharedMemory<T>(config) as SharedMemory<unknown>;
  return globalSharedMemory as SharedMemory<T>;
}

export function getSharedMemory<T = unknown>(): SharedMemory<T> {
  if (!globalSharedMemory) {
    globalSharedMemory = new SharedMemory<T>();
  }
  return globalSharedMemory as SharedMemory<T>;
}

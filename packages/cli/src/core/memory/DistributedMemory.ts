import type { AgentRole } from '../collaboration/AgentType.js';
import type { VectorClockSnapshot } from '../comms/VectorClock.js';

export type ConflictResolution = 'last-write-wins' | 'version-merge' | 'reject-conflict' | 'notify';
export type ConflictStrategy = 'version-wins' | 'merge' | 'fork';

export interface MemoryEntry<T = unknown> {
  key: string;
  value: T;
  version: number;
  timestamp: number;
  agentId: string;
  role?: AgentRole;
  tags?: string[];
  metadata?: Record<string, unknown>;
  vectorClock: VectorClockSnapshot;
}

export interface DistributedMemoryEntry<T = unknown> extends MemoryEntry<T> {
  causalRank: number;
  originatedFrom: string;
}

export interface ConflictVersion {
  version: number;
  node: string;
  value: unknown;
  vectorClock: VectorClockSnapshot;
  timestamp: number;
}

export interface ConflictedEntry {
  key: string;
  versions: ConflictVersion[];
  conflict: true;
  latestResolution?: 'version-wins' | 'merge' | 'fork';
}

export interface ConflictEvent {
  key: string;
  existing: DistributedMemoryEntry;
  incoming: DistributedMemoryEntry;
  resolution: ConflictResolution;
  resolvedValue?: unknown;
  timestamp: number;
  hasConflict?: boolean;
  conflictingVersions?: ConflictVersion[];
}

export interface DistributedMemoryConfig {
  conflictResolution: ConflictResolution;
  conflictStrategy: ConflictStrategy;
  maxEntries: number;
  ttl?: number;
  nodeId: string;
  causalWeight?: number;
  onConflict?: (event: ConflictEvent) => void;
}

const DEFAULT_CONFIG: Omit<DistributedMemoryConfig, 'nodeId'> = {
  conflictResolution: 'version-merge',
  conflictStrategy: 'version-wins',
  maxEntries: 1000,
  causalWeight: 0.3,
};

export class DistributedMemory<T = unknown> {
  private store: Map<string, DistributedMemoryEntry<T>> = new Map();
  private conflictedEntries: Map<string, ConflictedEntry> = new Map();
  private versionHistory: Map<string, DistributedMemoryEntry<T>[]> = new Map();
  private nodeClocks: Map<string, VectorClockSnapshot> = new Map();
  private config: DistributedMemoryConfig;
  private conflictListeners: Array<(event: ConflictEvent) => void> = [];

  constructor(config: DistributedMemoryConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config } as DistributedMemoryConfig;
  }

  set(
    key: string,
    value: T,
    agentId: string,
    vectorClock: VectorClockSnapshot,
    role?: AgentRole,
    metadata?: Record<string, unknown>
  ): DistributedMemoryEntry<T> {
    const existing = this.store.get(key);
    const incomingVersion = this.calculateVersion(key, vectorClock);

    if (existing) {
      const comparison = this.compareVectorClocks(existing.vectorClock, vectorClock);

      if (comparison === 'after' || comparison === 'equal') {
        return existing;
      }

      if (comparison === 'concurrent') {
        return this.handleConcurrentUpdate(key, value, agentId, vectorClock, incomingVersion, role, metadata);
      }
    }

    return this.createEntry(key, value, agentId, vectorClock, incomingVersion, role, metadata);
  }

  private handleConcurrentUpdate(
    key: string,
    value: T,
    agentId: string,
    vectorClock: VectorClockSnapshot,
    incomingVersion: number,
    role?: AgentRole,
    metadata?: Record<string, unknown>
  ): DistributedMemoryEntry<T> {
    const existing = this.store.get(key)!;

    const incomingEntry: DistributedMemoryEntry<T> = {
      key,
      value,
      version: incomingVersion,
      timestamp: Date.now(),
      agentId,
      role,
      tags: metadata?.tags as string[] | undefined,
      metadata,
      vectorClock,
      causalRank: this.calculateCausalRank(vectorClock),
      originatedFrom: this.extractOriginNode(vectorClock),
    };

    const hasConflict = this.detectConflict(existing, incomingEntry);
    const conflictingVersions: ConflictVersion[] = [];

    if (hasConflict) {
      conflictingVersions.push(
        {
          version: existing.version,
          node: existing.originatedFrom,
          value: existing.value,
          vectorClock: existing.vectorClock,
          timestamp: existing.timestamp,
        },
        {
          version: incomingVersion,
          node: incomingEntry.originatedFrom,
          value: value,
          vectorClock: vectorClock,
          timestamp: incomingEntry.timestamp,
        }
      );
    }

    const conflictEvent: ConflictEvent = {
      key,
      existing,
      incoming: incomingEntry,
      resolution: this.config.conflictResolution,
      timestamp: Date.now(),
      hasConflict,
      conflictingVersions: hasConflict ? conflictingVersions : undefined,
    };

    let resolved: DistributedMemoryEntry<T>;

    switch (this.config.conflictResolution) {
      case 'last-write-wins':
        resolved = incomingEntry;
        break;

      case 'version-merge':
        resolved = this.mergeVersions(existing, incomingEntry);
        break;

      case 'reject-conflict':
        resolved = existing;
        conflictEvent.resolvedValue = existing.value;
        break;

      case 'notify':
        resolved = incomingEntry;
        conflictEvent.resolvedValue = incomingEntry.value;
        break;

      default:
        resolved = incomingEntry;
    }

    if (hasConflict) {
      this.storeConflictedVersions(key, conflictingVersions);
    }

    conflictEvent.resolvedValue = resolved.value;
    this.emitConflict(conflictEvent);

    this.store.set(key, resolved);
    this.updateNodeClock(resolved.vectorClock);
    this.addToHistory(resolved);

    return resolved;
  }

  private detectConflict(existing: DistributedMemoryEntry<T>, incoming: DistributedMemoryEntry<T>): boolean {
    if (existing.version === incoming.version && existing.originatedFrom !== incoming.originatedFrom) {
      return true;
    }

    if (existing.vectorClock[incoming.originatedFrom] && incoming.vectorClock[existing.originatedFrom]) {
      return true;
    }

    return false;
  }

  private storeConflictedVersions(key: string, versions: ConflictVersion[]): void {
    const existingConflict = this.conflictedEntries.get(key);

    if (existingConflict) {
      const existingIds = new Set(existingConflict.versions.map(v => `${v.node}:${v.version}`));
      for (const v of versions) {
        const id = `${v.node}:${v.version}`;
        if (!existingIds.has(id)) {
          existingConflict.versions.push(v);
        }
      }
      existingConflict.versions.sort((a, b) => b.timestamp - a.timestamp);
    } else {
      this.conflictedEntries.set(key, {
        key,
        versions,
        conflict: true,
        latestResolution: this.config.conflictStrategy,
      });
    }
  }

  getConflictedEntry(key: string): ConflictedEntry | undefined {
    return this.conflictedEntries.get(key);
  }

  getAllConflictedKeys(): string[] {
    return Array.from(this.conflictedEntries.keys());
  }

  resolveConflict(
    key: string,
    strategy: 'version-wins' | 'merge' | 'fork',
    preferredVersion?: number
  ): DistributedMemoryEntry<T> | null {
    const conflict = this.conflictedEntries.get(key);
    if (!conflict) return null;

    conflict.latestResolution = strategy;

    switch (strategy) {
      case 'version-wins': {
        const preferred = preferredVersion
          ? conflict.versions.find(v => v.version === preferredVersion)
          : conflict.versions[0];
        if (preferred) {
          const entry = this.store.get(key);
          if (entry) {
            entry.value = preferred.value as T;
            entry.vectorClock = preferred.vectorClock;
            entry.timestamp = preferred.timestamp;
            return entry;
          }
        }
        break;
      }

      case 'merge': {
        const merged: Record<string, unknown> = {};
        for (const v of conflict.versions) {
          if (typeof v.value === 'object' && v.value !== null) {
            Object.assign(merged, v.value as Record<string, unknown>);
          }
        }
        const entry = this.store.get(key);
        if (entry) {
          entry.value = merged as T;
          return entry;
        }
        break;
      }

      case 'fork':
        return null;
    }

    return this.store.get(key) || null;
  }

  private createEntry(
    key: string,
    value: T,
    agentId: string,
    vectorClock: VectorClockSnapshot,
    version: number,
    role?: AgentRole,
    metadata?: Record<string, unknown>
  ): DistributedMemoryEntry<T> {
    const entry: DistributedMemoryEntry<T> = {
      key,
      value,
      version,
      timestamp: Date.now(),
      agentId,
      role,
      tags: metadata?.tags as string[] | undefined,
      metadata,
      vectorClock,
      causalRank: this.calculateCausalRank(vectorClock),
      originatedFrom: this.extractOriginNode(vectorClock),
    };

    this.store.set(key, entry);
    this.updateNodeClock(vectorClock);
    this.addToHistory(entry);
    this.pruneIfNeeded();

    return entry;
  }

  private calculateVersion(key: string, vectorClock: VectorClockSnapshot): number {
    const existing = this.store.get(key);
    if (existing) {
      const existingMax = Math.max(...Object.values(existing.vectorClock));
      const incomingMax = Math.max(...Object.values(vectorClock));
      return Math.max(existing.version, Math.max(existingMax, incomingMax)) + 1;
    }

    const clockSum = Object.values(vectorClock).reduce((sum, val) => sum + val, 0);
    return clockSum + 1;
  }

  private calculateCausalRank(vectorClock: VectorClockSnapshot): number {
    const causalWeight = this.config.causalWeight ?? 0.3;
    const clockSum = Object.values(vectorClock).reduce((sum, val) => sum + val, 0);
    const uniqueNodes = Object.keys(vectorClock).length;
    return clockSum * causalWeight + uniqueNodes * (1 - causalWeight);
  }

  private extractOriginNode(vectorClock: VectorClockSnapshot): string {
    const entries = Object.entries(vectorClock);
    if (entries.length === 0) return this.config.nodeId;

    const [origin] = entries.reduce((max, current) =>
      current[1] > max[1] ? current : max
    );
    return origin;
  }

  private compareVectorClocks(a: VectorClockSnapshot, b: VectorClockSnapshot): 'before' | 'after' | 'concurrent' | 'equal' {
    const allNodes = new Set([...Object.keys(a), ...Object.keys(b)]);

    let aLessOrEqual = true;
    let bLessOrEqual = true;
    let strictlyLess = false;
    let strictlyGreater = false;

    for (const node of allNodes) {
      const aVal = a[node] || 0;
      const bVal = b[node] || 0;

      if (aVal > bVal) {
        bLessOrEqual = false;
        strictlyGreater = true;
      }
      if (bVal > aVal) {
        aLessOrEqual = false;
        strictlyLess = true;
      }
    }

    if (aLessOrEqual && strictlyLess) return 'before';
    if (bLessOrEqual && strictlyGreater) return 'after';
    if (!strictlyLess && !strictlyGreater) return 'equal';
    return 'concurrent';
  }

  private mergeVersions(existing: DistributedMemoryEntry<T>, incoming: DistributedMemoryEntry<T>): DistributedMemoryEntry<T> {
    const mergedClock: VectorClockSnapshot = {};

    for (const node of new Set([...Object.keys(existing.vectorClock), ...Object.keys(incoming.vectorClock)])) {
      mergedClock[node] = Math.max(existing.vectorClock[node] || 0, incoming.vectorClock[node] || 0);
    }

    let mergedValue: T;
    if (
      typeof existing.value === 'object' &&
      existing.value !== null &&
      typeof incoming.value === 'object' &&
      incoming.value !== null
    ) {
      mergedValue = {
        ...(existing.value as Record<string, unknown>),
        ...(incoming.value as Record<string, unknown>),
      } as T;
    } else {
      mergedValue = incoming.value;
    }

    return {
      ...incoming,
      value: mergedValue,
      version: Math.max(existing.version, incoming.version) + 1,
      vectorClock: mergedClock,
      causalRank: this.calculateCausalRank(mergedClock),
      originatedFrom: this.extractOriginNode(mergedClock),
    };
  }

  private updateNodeClock(vectorClock: VectorClockSnapshot): void {
    for (const [nodeId, counter] of Object.entries(vectorClock)) {
      const existing = this.nodeClocks.get(nodeId) || {};
      this.nodeClocks.set(nodeId, {
        ...existing,
        [nodeId]: Math.max(existing[nodeId] || 0, counter),
      });
    }
  }

  private addToHistory(entry: DistributedMemoryEntry<T>): void {
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
      .sort((a, b) => a[1].causalRank - b[1].causalRank);

    const toRemove = entries.slice(0, Math.floor(this.config.maxEntries * 0.2));

    for (const [key] of toRemove) {
      this.store.delete(key);
      this.versionHistory.delete(key);
    }
  }

  private emitConflict(event: ConflictEvent): void {
    if (this.config.onConflict) {
      try {
        this.config.onConflict(event);
      } catch {
        // Ignore handler errors
      }
    }

    for (const listener of this.conflictListeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }

  get(key: string): DistributedMemoryEntry<T> | undefined {
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
    this.conflictedEntries.delete(key);
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

  entries(pattern?: string): DistributedMemoryEntry<T>[] {
    return this.keys(pattern).map(k => this.store.get(k)!).filter(Boolean);
  }

  getByTag(tag: string): DistributedMemoryEntry<T>[] {
    return Array.from(this.store.values()).filter(e => e.tags?.includes(tag));
  }

  getByAgent(agentId: string): DistributedMemoryEntry<T>[] {
    return Array.from(this.store.values()).filter(e => e.agentId === agentId);
  }

  getByRole(role: AgentRole): DistributedMemoryEntry<T>[] {
    return Array.from(this.store.values()).filter(e => e.role === role);
  }

  getByOrigin(nodeId: string): DistributedMemoryEntry<T>[] {
    return Array.from(this.store.values()).filter(e => e.originatedFrom === nodeId);
  }

  getVersion(key: string): number {
    return this.store.get(key)?.version || 0;
  }

  getVectorClock(key: string): VectorClockSnapshot | undefined {
    return this.store.get(key)?.vectorClock;
  }

  getCausalRank(key: string): number {
    return this.store.get(key)?.causalRank || 0;
  }

  getHistory(key: string, limit?: number): DistributedMemoryEntry<T>[] {
    const history = this.versionHistory.get(key) || [];
    return limit ? history.slice(-limit) : history;
  }

  getNodeClock(nodeId: string): VectorClockSnapshot | undefined {
    return this.nodeClocks.get(nodeId);
  }

  getAllNodeClocks(): Map<string, VectorClockSnapshot> {
    return new Map(this.nodeClocks);
  }

  receiveRemoteEntry(entry: DistributedMemoryEntry<T>): DistributedMemoryEntry<T> {
    if (this.isStale(entry)) {
      return this.store.get(entry.key) || entry;
    }

    const existing = this.store.get(entry.key);

    if (!existing) {
      this.store.set(entry.key, entry);
      this.updateNodeClock(entry.vectorClock);
      this.addToHistory(entry);
      this.pruneIfNeeded();
      return entry;
    }

    const comparison = this.compareVectorClocks(existing.vectorClock, entry.vectorClock);

    if (comparison === 'after' || comparison === 'equal') {
      return existing;
    }

    if (comparison === 'concurrent') {
      return this.handleConcurrentUpdate(
        entry.key,
        entry.value,
        entry.agentId,
        entry.vectorClock,
        entry.version,
        entry.role,
        entry.metadata
      );
    }

    return this.createEntry(
      entry.key,
      entry.value,
      entry.agentId,
      entry.vectorClock,
      entry.version,
      entry.role,
      entry.metadata
    );
  }

  isStale(entry: DistributedMemoryEntry<T>): boolean {
    const existing = this.store.get(entry.key);
    if (!existing) return false;

    const comparison = this.compareVectorClocks(existing.vectorClock, entry.vectorClock);
    return comparison === 'before' || comparison === 'equal';
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
    this.conflictedEntries.clear();
    this.versionHistory.clear();
    this.nodeClocks.clear();
  }

  size(): number {
    return this.store.size;
  }

  getConflictCount(): number {
    return this.conflictedEntries.size;
  }

  snapshot(): Record<string, DistributedMemoryEntry<T>> {
    const snapshot: Record<string, DistributedMemoryEntry<T>> = {};
    for (const [key, entry] of this.store) {
      snapshot[key] = { ...entry };
    }
    return snapshot;
  }

  restore(snapshot: Record<string, DistributedMemoryEntry<T>>): void {
    this.store.clear();
    this.versionHistory.clear();
    this.nodeClocks.clear();

    for (const [key, entry] of Object.entries(snapshot)) {
      const restored = { ...entry };
      this.store.set(key, restored);
      this.versionHistory.set(key, [restored]);
      this.updateNodeClock(restored.vectorClock);
    }
  }
}

let globalDistributedMemory: DistributedMemory<unknown> | null = null;

export function initDistributedMemory(config: DistributedMemoryConfig): DistributedMemory<unknown> {
  globalDistributedMemory = new DistributedMemory<unknown>(config);
  return globalDistributedMemory;
}

export function getDistributedMemory<T = unknown>(): DistributedMemory<T> | null {
  return globalDistributedMemory as DistributedMemory<T> | null;
}

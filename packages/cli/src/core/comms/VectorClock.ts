export type VectorClockSnapshot = Record<string, number>;

export type ClockComparison = 'before' | 'after' | 'concurrent' | 'equal';

export interface VectorClockConfig {
  maxNodes?: number;
  nodeTTL?: number;
  pruneInterval?: number;
}

const DEFAULT_CONFIG = {
  maxNodes: 20,
  nodeTTL: 10 * 60 * 1000,
  pruneInterval: 60000,
};

export class VectorClock {
  private clock: Map<string, number>;
  private nodeId: string;
  private lastSeen: Map<string, number> = new Map();
  private maxNodes: number;
  private nodeTTL: number;
  private pruneInterval: ReturnType<typeof setInterval> | null = null;
  private onPrune?: () => void;

  constructor(nodeId: string, config?: VectorClockConfig) {
    this.nodeId = nodeId;
    this.clock = new Map();
    this.maxNodes = config?.maxNodes ?? DEFAULT_CONFIG.maxNodes;
    this.nodeTTL = config?.nodeTTL ?? DEFAULT_CONFIG.nodeTTL;
    this.clock.set(nodeId, 0);
    this.lastSeen.set(nodeId, Date.now());
  }

  tick(): VectorClockSnapshot {
    const current = this.clock.get(this.nodeId) || 0;
    this.clock.set(this.nodeId, current + 1);
    this.lastSeen.set(this.nodeId, Date.now());
    return this.snapshot();
  }

  merge(incoming: VectorClockSnapshot): void {
    for (const [nodeId, counter] of Object.entries(incoming)) {
      const localCounter = this.clock.get(nodeId) || 0;
      this.clock.set(nodeId, Math.max(localCounter, counter));
      this.lastSeen.set(nodeId, Date.now());
    }

    const current = this.clock.get(this.nodeId) || 0;
    this.clock.set(this.nodeId, current + 1);
    this.lastSeen.set(this.nodeId, Date.now());

    this.prune();
  }

  prune(): void {
    const now = Date.now();

    for (const [nodeId, lastSeen] of this.lastSeen) {
      if (nodeId === this.nodeId) continue;

      if (now - lastSeen > this.nodeTTL) {
        this.clock.delete(nodeId);
        this.lastSeen.delete(nodeId);
      }
    }

    if (this.clock.size > this.maxNodes) {
      const sorted = [...this.lastSeen.entries()]
        .sort((a, b) => a[1] - b[1]);

      const toRemove = sorted.slice(0, this.clock.size - this.maxNodes);

      for (const [nodeId] of toRemove) {
        if (nodeId !== this.nodeId) {
          this.clock.delete(nodeId);
          this.lastSeen.delete(nodeId);
        }
      }
    }

    if (this.onPrune) {
      this.onPrune();
    }
  }

  startAutoPrune(): void {
    if (this.pruneInterval) return;

    this.pruneInterval = setInterval(() => {
      this.prune();
    }, this.maxNodes > 0 ? Math.min(this.nodeTTL, 60000) : 60000);
  }

  stopAutoPrune(): void {
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = null;
    }
  }

  onPruneEvent(callback: () => void): () => void {
    this.onPrune = callback;
    return () => {
      this.onPrune = undefined;
    };
  }

  static compare(a: VectorClockSnapshot, b: VectorClockSnapshot): ClockComparison {
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

  static isBefore(a: VectorClockSnapshot, b: VectorClockSnapshot): boolean {
    return VectorClock.compare(a, b) === 'before';
  }

  static causalSort<T extends { vectorClock: VectorClockSnapshot; timestamp: number; fromNode: string }>(
    messages: T[]
  ): T[] {
    return [...messages].sort((a, b) => {
      const comparison = VectorClock.compare(a.vectorClock, b.vectorClock);
      
      if (comparison === 'before') return -1;
      if (comparison === 'after') return 1;

      return a.timestamp - b.timestamp || a.fromNode.localeCompare(b.fromNode);
    });
  }

  static createCausalKey(
    vectorClock: VectorClockSnapshot,
    timestamp: number,
    nodeId: string
  ): { sum: number; timestamp: number; nodeId: string } {
    const sum = Object.values(vectorClock).reduce((s, v) => s + v, 0);
    return { sum, timestamp, nodeId };
  }

  isStale(incoming: VectorClockSnapshot): boolean {
    const comparison = VectorClock.compare(incoming, this.snapshot());
    return comparison === 'before' || comparison === 'equal';
  }

  snapshot(): VectorClockSnapshot {
    const snap: VectorClockSnapshot = {};
    for (const [nodeId, counter] of this.clock) {
      snap[nodeId] = counter;
    }
    return snap;
  }

  getLocalCounter(): number {
    return this.clock.get(this.nodeId) || 0;
  }

  getCounterFor(nodeId: string): number {
    return this.clock.get(nodeId) || 0;
  }

  getActiveNodes(): string[] {
    return Array.from(this.clock.keys());
  }

  getLastSeen(nodeId: string): number | undefined {
    return this.lastSeen.get(nodeId);
  }

  toString(): string {
    const entries = Array.from(this.clock.entries())
      .map(([id, count]) => `${id.slice(0, 8)}:${count}`)
      .join(', ');
    return `{${entries}}`;
  }

  getNodeId(): string {
    return this.nodeId;
  }

  getStats(): { nodeCount: number; maxNodes: number; ttl: number } {
    return {
      nodeCount: this.clock.size,
      maxNodes: this.maxNodes,
      ttl: this.nodeTTL,
    };
  }

  destroy(): void {
    this.stopAutoPrune();
    this.clock.clear();
    this.lastSeen.clear();
  }
}

let globalVectorClock: VectorClock | null = null;

export function initVectorClock(nodeId: string, config?: VectorClockConfig): VectorClock {
  globalVectorClock = new VectorClock(nodeId, config);
  return globalVectorClock;
}

export function getVectorClock(): VectorClock | null {
  return globalVectorClock;
}

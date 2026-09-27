import type { FabricNodeCapabilities, FabricNodeRecord } from './types.js';

export class CapabilityRegistry {
  private readonly nodes = new Map<string, FabricNodeRecord>();

  upsert(node: FabricNodeRecord): void { this.nodes.set(node.identity.nodeId, node); }
  remove(nodeId: string): void { this.nodes.delete(nodeId); }
  get(nodeId: string): FabricNodeRecord | undefined { return this.nodes.get(nodeId); }
  list(): FabricNodeRecord[] { return [...this.nodes.values()]; }

  findCapable(predicate: (capabilities: FabricNodeCapabilities) => boolean): FabricNodeRecord[] {
    return this.list().filter((node) => predicate(node.capabilities));
  }
  findModel(model: string): FabricNodeRecord[] {
    return this.findCapable((capabilities) => capabilities.models.includes(model));
  }
  findHarness(harness: string): FabricNodeRecord[] {
    return this.findCapable((capabilities) => capabilities.harnesses.includes(harness));
  }
  findAvailable(): FabricNodeRecord[] {
    return this.list().filter((node) => node.state === 'online' && node.activeTasks < node.capabilities.maxConcurrentTasks);
  }
}

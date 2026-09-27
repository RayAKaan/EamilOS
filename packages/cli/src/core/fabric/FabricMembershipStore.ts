import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { FabricClusterState, FabricNodeRecord } from './types.js';

export class FabricMembershipStore {
  constructor(private readonly filePath: string, private readonly clusterId: string) {}

  async load(): Promise<FabricClusterState> {
    try {
      const state = JSON.parse(await readFile(this.filePath, 'utf8')) as FabricClusterState;
      if (state.clusterId !== this.clusterId || !Array.isArray(state.nodes)) throw new Error('Invalid cluster state');
      return state;
    } catch {
      return { clusterId: this.clusterId, version: 0, updatedAt: Date.now(), nodes: [] };
    }
  }

  async upsert(node: FabricNodeRecord): Promise<FabricClusterState> {
    const state = await this.load();
    const index = state.nodes.findIndex((entry) => entry.identity.nodeId === node.identity.nodeId);
    if (index === -1) state.nodes.push(node); else state.nodes[index] = node;
    state.version += 1; state.updatedAt = Date.now();
    await this.save(state);
    return state;
  }

  async remove(nodeId: string): Promise<FabricClusterState> {
    const state = await this.load();
    state.nodes = state.nodes.filter((node) => node.identity.nodeId !== nodeId);
    state.version += 1; state.updatedAt = Date.now();
    await this.save(state);
    return state;
  }

  async save(state: FabricClusterState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = join(dirname(this.filePath), \`.1790547304015.tmp\`);
    await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temp, this.filePath);
  }
}

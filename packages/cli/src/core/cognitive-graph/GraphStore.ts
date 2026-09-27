import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { GraphSnapshot } from './types.js';
import { GraphSnapshotSchema } from './types.js';
import { GraphValidator } from './GraphValidator.js';

export interface GraphStore {
  load(missionId: string): Promise<GraphSnapshot | undefined>;
  save(snapshot: GraphSnapshot): Promise<void>;
}

export class FilesystemGraphStore implements GraphStore {
  constructor(private readonly root = join(process.cwd(), '.eamilos', 'cognitive-graph')) {}

  private path(missionId: string): string { return join(this.root, `${missionId}.json`); }

  async load(missionId: string): Promise<GraphSnapshot | undefined> {
    try {
      const parsed = GraphSnapshotSchema.parse(JSON.parse(await readFile(this.path(missionId), 'utf8')));
      new GraphValidator().assertValid(parsed);
      return parsed;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? (error as {code?: string}).code : undefined;
      if (code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async save(snapshot: GraphSnapshot): Promise<void> {
    new GraphValidator().assertValid(snapshot);
    await mkdir(dirname(this.path(snapshot.missionId)), { recursive: true });
    const path = this.path(snapshot.missionId);
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(snapshot, null, 2), 'utf8');
    await rename(temp, path);
  }
}

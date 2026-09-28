import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AutonomousLoopState } from './types.js';

export class LoopStateStore {
  constructor(private readonly root = join(process.cwd(), '.eamilos', 'loops')) {}

  private path(missionId: string): string {
    return join(this.root, `${missionId}.json`);
  }

  async load(missionId: string): Promise<AutonomousLoopState | undefined> {
    try {
      return JSON.parse(await readFile(this.path(missionId), 'utf8')) as AutonomousLoopState;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? (error as { code?: string }).code
        : undefined;
      if (code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async save(state: AutonomousLoopState): Promise<void> {
    await mkdir(dirname(this.path(state.missionId)), { recursive: true });
    const target = this.path(state.missionId);
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(state, null, 2), 'utf8');
    await rename(temp, target);
  }
}

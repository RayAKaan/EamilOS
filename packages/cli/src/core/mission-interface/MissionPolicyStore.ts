import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { MissionPolicySchema, type MissionPolicy } from './types.js';

export class MissionPolicyStore {
  constructor(private readonly root = join(process.cwd(), '.eamilos', 'mission-policies')) {}

  private path(missionId: string): string {
    return join(this.root, `${missionId}.json`);
  }

  async load(missionId: string): Promise<MissionPolicy | undefined> {
    try {
      return MissionPolicySchema.parse(JSON.parse(await readFile(this.path(missionId), 'utf8')));
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? (error as { code?: string }).code
        : undefined;
      if (code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async save(missionId: string, policy: MissionPolicy): Promise<void> {
    const parsed = MissionPolicySchema.parse(policy);
    await mkdir(dirname(this.path(missionId)), { recursive: true });
    const target = this.path(missionId);
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(parsed, null, 2), 'utf8');
    await rename(temp, target);
  }
}

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { CoordinationSnapshotSchema, type CoordinationSnapshot } from './types.js';

export class CoordinationStore {
  private readonly baseDir: string;

  constructor(baseDir = join(process.cwd(), '.eamilos', 'coordination')) {
    this.baseDir = baseDir;
    mkdirSync(this.baseDir, { recursive: true });
  }

  private path(missionId: string): string {
    return join(this.baseDir, `${missionId}.json`);
  }

  get(missionId: string): CoordinationSnapshot | null {
    const file = this.path(missionId);
    if (!existsSync(file)) return null;
    return CoordinationSnapshotSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  }

  save(snapshot: CoordinationSnapshot): void {
    const value = CoordinationSnapshotSchema.parse(snapshot);
    const target = this.path(value.version.missionId);
    const temp = `${target}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
    renameSync(temp, target);
  }

  list(): CoordinationSnapshot[] {
    if (!existsSync(this.baseDir)) return [];
    return readdirSync(this.baseDir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => {
        try {
          return CoordinationSnapshotSchema.parse(JSON.parse(readFileSync(join(this.baseDir, file), 'utf8')));
        } catch {
          return null;
        }
      })
      .filter((item): item is CoordinationSnapshot => item !== null);
  }
}

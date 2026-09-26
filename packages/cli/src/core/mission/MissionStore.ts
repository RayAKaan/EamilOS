import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  CheckpointSchema,
  EvidenceSchema,
  MissionSchema,
  TaskNodeSchema,
  type Mission,
  type MissionEvidence,
  type TaskCheckpoint,
  type TaskNode,
  type MissionEvent,
  type MissionSnapshot,
} from './types.js';

interface MissionFile {
  mission: Mission;
  tasks: TaskNode[];
  checkpoints: TaskCheckpoint[];
  evidence: MissionEvidence[];
  events: MissionEvent[];
}

export type { MissionSnapshot } from './types.js';

export class MissionStore {
  private readonly baseDir: string;

  constructor(baseDir = join(process.cwd(), '.eamilos', 'missions')) {
    this.baseDir = baseDir;
    mkdirSync(this.baseDir, { recursive: true });
  }

  private path(id: string): string {
    return join(this.baseDir, `${id}.json`);
  }

  create(mission: Mission): void {
    if (existsSync(this.path(mission.id))) {
      throw new Error(`Mission already exists: ${mission.id}`);
    }
    this.write({
      mission,
      tasks: [],
      checkpoints: [],
      evidence: [],
      events: [],
    });
  }

  get(id: string): MissionSnapshot | null {
    const file = this.path(id);
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as MissionFile;
    return {
      mission: MissionSchema.parse(raw.mission),
      tasks: raw.tasks.map((x) => TaskNodeSchema.parse(x)),
      checkpoints: raw.checkpoints.map((x) => CheckpointSchema.parse(x)),
      evidence: raw.evidence.map((x) => EvidenceSchema.parse(x)),
      events: raw.events ?? [],
    };
  }

  save(snapshot: MissionSnapshot): void {
    this.write({
      mission: MissionSchema.parse(snapshot.mission),
      tasks: snapshot.tasks.map((x) => TaskNodeSchema.parse(x)),
      checkpoints: snapshot.checkpoints.map((x) => CheckpointSchema.parse(x)),
      evidence: snapshot.evidence.map((x) => EvidenceSchema.parse(x)),
      events: snapshot.events,
    });
  }

  delete(id: string): void {
    const file = this.path(id);
    if (existsSync(file)) renameSync(file, `${file}.deleted.${Date.now()}`);
  }

  list(): Mission[] {
    if (!existsSync(this.baseDir)) return [];
    return readdirSync(this.baseDir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => {
        try {
          const raw = JSON.parse(readFileSync(join(this.baseDir, file), 'utf8')) as MissionFile;
          return MissionSchema.parse(raw.mission);
        } catch {
          return null;
        }
      })
      .filter((mission): mission is Mission => mission !== null);
  }

  private write(data: MissionFile): void {
    const target = this.path(data.mission.id);
    const temp = `${target}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
    renameSync(temp, target);
  }
}

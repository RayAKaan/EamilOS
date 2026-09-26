import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
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
} from './types.js';

interface MissionFile {
  mission: Mission;
  tasks: TaskNode[];
  checkpoints: TaskCheckpoint[];
  evidence: MissionEvidence[];
  events: MissionEvent[];
}

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
    if (existsSync(file)) {
      // Keep this store intentionally filesystem-only and dependency-free.
      // eslint/typecheck does not require fs.rmSync in older Node typings.
      renameSync(file, `${file}.deleted.${Date.now()}`);
    }
  }

  list(): Mission[] {
    if (!existsSync(this.baseDir)) return [];
    return [];
  }

  private write(data: MissionFile): void {
    const target = this.path(data.mission.id);
    const temp = `${target}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
    renameSync(temp, target);
  }
}

export interface MissionSnapshot {
  mission: Mission;
  tasks: TaskNode[];
  checkpoints: TaskCheckpoint[];
  evidence: MissionEvidence[];
  events: MissionEvent[];
}

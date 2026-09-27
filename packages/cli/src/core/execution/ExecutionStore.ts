import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import {
  ExecutionCheckpointSchema,
  ExecutionRecordSchema,
  ExecutionSnapshotSchema,
  type ExecutionCheckpoint,
  type ExecutionRecord,
  type ExecutionSnapshot,
} from './types.js';

export class ExecutionStore {
  private readonly baseDir: string;

  constructor(baseDir = join(process.cwd(), '.eamilos', 'executions')) {
    this.baseDir = baseDir;
    mkdirSync(this.baseDir, { recursive: true });
  }

  private path(missionId: string): string {
    return join(this.baseDir, `${missionId}.json`);
  }

  get(missionId: string): ExecutionSnapshot | null {
    const file = this.path(missionId);
    if (!existsSync(file)) return null;

    return ExecutionSnapshotSchema.parse(
      JSON.parse(readFileSync(file, 'utf8')),
    );
  }

  getOrCreate(missionId: string): ExecutionSnapshot {
    return this.get(missionId) ?? {
      version: 1,
      missionId,
      executions: [],
      checkpoints: [],
      updatedAt: new Date().toISOString(),
    };
  }

  save(snapshot: ExecutionSnapshot): void {
    const value = ExecutionSnapshotSchema.parse({
      ...snapshot,
      version: snapshot.version > 0 ? snapshot.version : 1,
      updatedAt: new Date().toISOString(),
    });

    const target = this.path(value.missionId);
    const temp = `${target}.tmp.${process.pid}.${Date.now()}`;

    writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
    renameSync(temp, target);
  }

  saveExecution(record: ExecutionRecord): ExecutionRecord {
    const value = ExecutionRecordSchema.parse(record);
    const snapshot = this.getOrCreate(value.missionId);
    const index = snapshot.executions.findIndex(
      (item) => item.executionId === value.executionId,
    );

    if (index >= 0) {
      snapshot.executions[index] = value;
    } else {
      snapshot.executions.push(value);
    }

    snapshot.version += 1;
    this.save(snapshot);
    return value;
  }

  saveCheckpoint(checkpoint: ExecutionCheckpoint): ExecutionCheckpoint {
    const value = ExecutionCheckpointSchema.parse(checkpoint);
    const snapshot = this.getOrCreate(value.missionId);
    const index = snapshot.checkpoints.findIndex(
      (item) => item.id === value.id,
    );

    if (index >= 0) {
      snapshot.checkpoints[index] = value;
    } else {
      snapshot.checkpoints.push(value);
    }

    snapshot.version += 1;
    this.save(snapshot);
    return value;
  }

  getExecution(missionId: string, executionId: string): ExecutionRecord | null {
    return this.get(missionId)?.executions.find(
      (execution) => execution.executionId === executionId,
    ) ?? null;
  }

  getLatestExecutionForTask(
    missionId: string,
    taskId: string,
  ): ExecutionRecord | null {
    const executions = this.get(missionId)?.executions.filter(
      (execution) => execution.taskId === taskId,
    ) ?? [];

    return executions.sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    )[0] ?? null;
  }

  getCheckpoint(
    missionId: string,
    checkpointId: string,
  ): ExecutionCheckpoint | null {
    return this.get(missionId)?.checkpoints.find(
      (checkpoint) => checkpoint.id === checkpointId,
    ) ?? null;
  }

  getLatestCheckpoint(
    missionId: string,
    taskId: string,
  ): ExecutionCheckpoint | null {
    const checkpoints = this.get(missionId)?.checkpoints.filter(
      (checkpoint) => checkpoint.taskId === taskId,
    ) ?? [];

    return checkpoints.sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )[0] ?? null;
  }

  list(): ExecutionSnapshot[] {
    if (!existsSync(this.baseDir)) return [];

    return readdirSync(this.baseDir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => {
        try {
          return ExecutionSnapshotSchema.parse(
            JSON.parse(readFileSync(join(this.baseDir, file), 'utf8')),
          );
        } catch {
          return null;
        }
      })
      .filter((item): item is ExecutionSnapshot => item !== null);
  }

  findInterrupted(): ExecutionRecord[] {
    const activeStates = new Set([
      'CREATED',
      'RESERVED',
      'STARTING',
      'RUNNING',
      'CHECKPOINTING',
      'VALIDATING',
    ]);

    return this.list()
      .flatMap((snapshot) => snapshot.executions)
      .filter((execution) => activeStates.has(execution.state));
  }
}

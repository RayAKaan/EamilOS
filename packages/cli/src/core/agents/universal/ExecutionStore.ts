import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AgentResponse } from '../types.js';

export interface ExecutionRecord {
  id: string;
  taskId: string;
  agentId: string;
  sessionId?: string;
  startedAt: number;
  finishedAt?: number;
  status: 'running' | 'completed' | 'failed' | 'stopped' | 'recovering';
  prompt: string;
  response?: AgentResponse;
  checkpoint?: { output: string; createdAt: number };
  evidence?: { outputBytes: number; exitCode?: number; validated: boolean };
}

export class ExecutionStore {
  private records = new Map<string, ExecutionRecord>();
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath = join(process.cwd(), '.eamilos', 'executions.json')) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as ExecutionRecord[];
      if (!Array.isArray(parsed)) throw new Error('Execution store must contain an array');
      this.records = new Map(parsed.filter(record => record?.id).map(record => [record.id, record]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // A corrupt store must not silently replace valid in-memory state.
        this.records = new Map();
      }
    }
    this.loaded = true;
  }

  isLoaded(): boolean { return this.loaded; }
  get(id: string): ExecutionRecord | undefined { return this.records.get(id); }
  list(): ExecutionRecord[] { return [...this.records.values()]; }

  async upsert(record: ExecutionRecord): Promise<void> {
    this.records.set(record.id, record);
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify([...this.records.values()], null, 2), 'utf8');
      await rename(temp, this.filePath);
    });
    await this.writeChain;
  }

  async checkpoint(id: string, output: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;
    record.status = 'recovering';
    record.checkpoint = { output: output.slice(-20000), createdAt: Date.now() };
    await this.upsert(record);
  }

  getCheckpoint(id: string): string | undefined {
    return this.records.get(id)?.checkpoint?.output;
  }
}

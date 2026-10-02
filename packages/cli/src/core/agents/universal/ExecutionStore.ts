import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
  constructor(private readonly filePath = join(process.cwd(), '.eamilos', 'executions.json')) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as ExecutionRecord[];
      this.records = new Map(parsed.map(record => [record.id, record]));
    } catch { /* first run / unavailable persistence is non-fatal */ }
  }

  get(id: string): ExecutionRecord | undefined { return this.records.get(id); }
  list(): ExecutionRecord[] { return [...this.records.values()]; }

  async upsert(record: ExecutionRecord): Promise<void> {
    this.records.set(record.id, record);
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify([...this.records.values()], null, 2), 'utf8');
    } catch { /* runtime must remain usable when persistence is read-only */ }
  }

  async checkpoint(id: string, output: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;
    record.status = 'recovering';
    record.checkpoint = { output, createdAt: Date.now() };
    await this.upsert(record);
  }
}

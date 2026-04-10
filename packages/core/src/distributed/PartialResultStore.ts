import fs from 'fs';
import path from 'path';
import type { PartialResult } from './types.js';

export class PartialResultStore {
  private filePath: string;
  private results: Map<string, PartialResult> = new Map();

  constructor(persistPath?: string) {
    const dir = persistPath || '.eamilos';
    const resolvedPath = path.resolve(process.cwd(), dir);

    if (!fs.existsSync(resolvedPath)) {
      fs.mkdirSync(resolvedPath, { recursive: true });
    }

    this.filePath = path.join(resolvedPath, 'partial-results.json');
    this.load();
  }

  save(result: PartialResult): void {
    this.results.set(result.taskId, result);
    this.persist();
  }

  get(taskId: string): PartialResult | undefined {
    return this.results.get(taskId);
  }

  delete(taskId: string): void {
    this.results.delete(taskId);
    this.persist();
  }

  clear(): void {
    this.results.clear();
    this.persist();
  }

  private persist(): void {
    const tempPath = this.filePath + '.tmp';
    try {
      const data = Object.fromEntries(this.results);
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
      fs.renameSync(tempPath, this.filePath);
    } catch (error) {
      console.error('Failed to persist partial results:', error);
    }
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) {
      return;
    }

    try {
      const content = fs.readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(content) as Record<string, PartialResult>;
      for (const [taskId, result] of Object.entries(data)) {
        this.results.set(taskId, result);
      }
    } catch {
      this.results.clear();
    }
  }

  getAll(): PartialResult[] {
    return Array.from(this.results.values());
  }

  has(taskId: string): boolean {
    return this.results.has(taskId);
  }
}

let globalPartialResultStore: PartialResultStore | null = null;

export function initPartialResultStore(persistPath?: string): PartialResultStore {
  globalPartialResultStore = new PartialResultStore(persistPath);
  return globalPartialResultStore;
}

export function getPartialResultStore(): PartialResultStore | null {
  return globalPartialResultStore;
}

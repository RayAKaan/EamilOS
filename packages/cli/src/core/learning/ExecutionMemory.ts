import * as fs from 'fs';
import * as path from 'path';
import type { ExecutionRecord } from './types.js';

export interface MemoryConfig {
  dataDir: string;
  maxFileSizeMB: number;
  maxRecordsInMemory: number;
  flushIntervalMs: number;
  compressOldFiles: boolean;
  retentionDays: number;
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  dataDir: '.eamilos/memory',
  maxFileSizeMB: 10,
  maxRecordsInMemory: 1000,
  flushIntervalMs: 30000,
  compressOldFiles: true,
  retentionDays: 90,
};

export class ExecutionMemory {
  private config: MemoryConfig;
  private currentFile: string;
  private currentFileSize: number = 0;
  private records: ExecutionRecord[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isInitialized: boolean = false;

  constructor(config: Partial<MemoryConfig> = {}) {
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
    this.currentFile = this.getNewFilePath();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    const dataDir = path.resolve(this.config.dataDir);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    const existingFiles = this.findExistingFiles();
    if (existingFiles.length > 0) {
      const latestFile = existingFiles.sort().pop()!;
      const stats = fs.statSync(latestFile);
      if (stats.size < this.config.maxFileSizeMB * 1024 * 1024) {
        this.currentFile = latestFile;
        this.currentFileSize = stats.size;
      }
    }
    
    this.scheduleFlush();
    this.isInitialized = true;
  }

  async record(record: ExecutionRecord): Promise<void> {
    this.records.push(record);
    
    if (this.records.length >= this.config.maxRecordsInMemory) {
      await this.flush();
    }
    
    if (this.currentFileSize >= this.config.maxFileSizeMB * 1024 * 1024) {
      await this.rotateFile();
    }
  }

  async flush(): Promise<void> {
    if (this.records.length === 0) return;
    
    const data = this.records.map(r => JSON.stringify(r)).join('\n') + '\n';
    fs.appendFileSync(this.currentFile, data, 'utf8');
    this.currentFileSize += Buffer.byteLength(data, 'utf8');
    this.records = [];
  }

  query(filters: {
    startTime?: number;
    endTime?: number;
    sessionId?: string;
    taskDomains?: string[];
    strategy?: string;
    success?: boolean;
    minTokens?: number;
    maxTokens?: number;
  }): ExecutionRecord[] {
    let results = this.loadAllRecords();
    
    if (filters.startTime !== undefined) {
      results = results.filter(r => r.timestamp >= filters.startTime!);
    }
    if (filters.endTime !== undefined) {
      results = results.filter(r => r.timestamp <= filters.endTime!);
    }
    if (filters.sessionId) {
      results = results.filter(r => r.sessionId === filters.sessionId);
    }
    if (filters.taskDomains && filters.taskDomains.length > 0) {
      results = results.filter(r => 
        filters.taskDomains!.some(d => r.taskDomains.includes(d))
      );
    }
    if (filters.strategy) {
      results = results.filter(r => r.strategy === filters.strategy);
    }
    if (filters.success !== undefined) {
      results = results.filter(r => r.success === filters.success);
    }
    if (filters.minTokens !== undefined) {
      results = results.filter(r => r.totalTokensIn >= filters.minTokens!);
    }
    if (filters.maxTokens !== undefined) {
      results = results.filter(r => r.totalTokensIn <= filters.maxTokens!);
    }
    
    return results;
  }

  getRecordsByModel(modelId: string): ExecutionRecord[] {
    return this.query({}).filter(r => r.modelsUsed.includes(modelId));
  }

  getRecordsBySession(sessionId: string): ExecutionRecord[] {
    return this.query({ sessionId });
  }

  getRecentRecords(limit: number = 100): ExecutionRecord[] {
    const records = this.loadAllRecords();
    return records.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  getStats(timeRange?: { start: number; end: number }): {
    totalRecords: number;
    successRate: number;
    avgLatencyMs: number;
    avgCostUSD: number;
    avgTokensIn: number;
    avgTokensOut: number;
    totalRetries: number;
  } {
    let records = this.loadAllRecords();
    
    if (timeRange) {
      records = records.filter(r => 
        r.timestamp >= timeRange.start && r.timestamp <= timeRange.end
      );
    }
    
    if (records.length === 0) {
      return {
        totalRecords: 0,
        successRate: 0,
        avgLatencyMs: 0,
        avgCostUSD: 0,
        avgTokensIn: 0,
        avgTokensOut: 0,
        totalRetries: 0,
      };
    }
    
    const successes = records.filter(r => r.success).length;
    
    return {
      totalRecords: records.length,
      successRate: successes / records.length,
      avgLatencyMs: records.reduce((sum, r) => sum + r.totalLatencyMs, 0) / records.length,
      avgCostUSD: records.reduce((sum, r) => sum + r.totalCostUSD, 0) / records.length,
      avgTokensIn: records.reduce((sum, r) => sum + r.totalTokensIn, 0) / records.length,
      avgTokensOut: records.reduce((sum, r) => sum + r.totalTokensOut, 0) / records.length,
      totalRetries: records.reduce((sum, r) => sum + r.retryCount, 0),
    };
  }

  async cleanup(): Promise<void> {
    await this.flush();
    
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    
    const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;
    const files = this.findExistingFiles();
    
    for (const file of files) {
      const stats = fs.statSync(file);
      if (stats.mtimeMs < cutoff) {
        fs.unlinkSync(file);
      }
    }
  }

  async shutdown(): Promise<void> {
    await this.cleanup();
    this.isInitialized = false;
  }

  private getNewFilePath(): string {
    const date = new Date().toISOString().split('T')[0];
    const timestamp = Date.now();
    return path.join(
      this.config.dataDir,
      `executions_${date}_${timestamp}.jsonl`
    );
  }

  private findExistingFiles(): string[] {
    const dataDir = path.resolve(this.config.dataDir);
    if (!fs.existsSync(dataDir)) return [];
    
    return fs.readdirSync(dataDir)
      .filter(f => f.startsWith('executions_') && f.endsWith('.jsonl'))
      .map(f => path.join(dataDir, f));
  }

  private async rotateFile(): Promise<void> {
    await this.flush();
    this.currentFile = this.getNewFilePath();
    this.currentFileSize = 0;
  }

  private scheduleFlush(): void {
    this.flushTimer = setInterval(async () => {
      try {
        await this.flush();
      } catch (error) {
        console.error('Failed to flush memory:', error);
      }
    }, this.config.flushIntervalMs);
  }

  private loadAllRecords(): ExecutionRecord[] {
    const records: ExecutionRecord[] = [];
    const files = this.findExistingFiles();
    
    for (const file of files.sort()) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split('\n').filter(l => l.trim());
        for (const line of lines) {
          try {
            records.push(JSON.parse(line));
          } catch {
            // Skip malformed records
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }
    
    return records;
  }

  getRecordCount(): number {
    return this.loadAllRecords().length;
  }

  exportToJson(): string {
    return JSON.stringify(this.loadAllRecords(), null, 2);
  }

  async importFromJson(jsonData: string): Promise<number> {
    const records: ExecutionRecord[] = JSON.parse(jsonData);
    let imported = 0;
    
    for (const record of records) {
      try {
        await this.record(record);
        imported++;
      } catch {
        // Skip invalid records
      }
    }
    
    return imported;
  }
}

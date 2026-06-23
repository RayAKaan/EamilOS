import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { nanoid } from 'nanoid';

export interface ModelMetrics {
  modelId: string;
  provider: string;
  overallSuccessRate: number;
  codeSuccessRate: number;
  jsonComplianceRate: number;
  multiFileSuccessRate: number;
  reasoningSuccessRate: number;
  firstAttemptSuccessRate: number;
  averageRetriesNeeded: number;
  failureRate: number;
  timeoutRate: number;
  parseFailureRate: number;
  validationFailureRate: number;
  averageLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  averageTokensPerResponse: number;
  averageCostPerTask: number;
  totalCostUsd: number;
  totalTasks: number;
  totalSuccesses: number;
  totalFailures: number;
  firstSeen: string;
  lastUsed: string;
  lastUpdated: string;
  categoryMetrics: Record<string, {
    successRate: number;
    avgLatencyMs: number;
    avgRetries: number;
    totalTasks: number;
  }>;
}

export interface ExecutionRecord {
  id: string;
  modelId: string;
  provider: string;
  taskCategory: string;
  instruction: string;
  success: boolean;
  retriesUsed: number;
  latencyMs: number;
  tokensUsed: number;
  costUsd: number;
  parseSucceeded: boolean;
  validationSucceeded: boolean;
  failureReason?: string;
  timestamp: string;
}

interface DbExecutionRecord {
  id: string;
  model_id: string;
  provider: string;
  task_category: string;
  instruction: string;
  success: number;
  retries_used: number;
  latency_ms: number;
  tokens_used: number;
  cost_usd: number;
  parse_succeeded: number;
  validation_succeeded: number;
  failure_reason: string | null;
  timestamp: string;
}

interface CachedMetrics {
  metrics_json: string;
  computed_at: string;
}

export class MetricsStore {
  private dbPath: string;
  private db: Database.Database;

  constructor(dbPath: string = '.eamilos/metrics.db') {
    this.dbPath = dbPath;
    this.db = this.initializeDatabase();
  }

  private initializeDatabase(): Database.Database {
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const db = new Database(this.dbPath);
    db.pragma('journal_mode = WAL');

    db.exec(`
      CREATE TABLE IF NOT EXISTS execution_records (
        id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        task_category TEXT NOT NULL,
        instruction TEXT,
        success INTEGER NOT NULL,
        retries_used INTEGER NOT NULL,
        latency_ms REAL NOT NULL,
        tokens_used INTEGER NOT NULL,
        cost_usd REAL NOT NULL DEFAULT 0,
        parse_succeeded INTEGER NOT NULL,
        validation_succeeded INTEGER NOT NULL,
        failure_reason TEXT,
        timestamp TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS model_metrics_cache (
        model_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        metrics_json TEXT NOT NULL,
        computed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS benchmark_results (
        id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        benchmark_suite TEXT NOT NULL,
        results_json TEXT NOT NULL,
        run_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_records_model ON execution_records(model_id);
      CREATE INDEX IF NOT EXISTS idx_records_category ON execution_records(task_category);
      CREATE INDEX IF NOT EXISTS idx_records_timestamp ON execution_records(timestamp);
      CREATE INDEX IF NOT EXISTS idx_records_model_category ON execution_records(model_id, task_category);
    `);

    return db;
  }

  recordExecution(record: ExecutionRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO execution_records
        (id, model_id, provider, task_category, instruction, success,
         retries_used, latency_ms, tokens_used, cost_usd,
         parse_succeeded, validation_succeeded, failure_reason, timestamp)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.id || nanoid(),
      record.modelId,
      record.provider,
      record.taskCategory,
      record.instruction.substring(0, 500),
      record.success ? 1 : 0,
      record.retriesUsed,
      record.latencyMs,
      record.tokensUsed,
      record.costUsd,
      record.parseSucceeded ? 1 : 0,
      record.validationSucceeded ? 1 : 0,
      record.failureReason || null,
      record.timestamp
    );

    this.invalidateCache(record.modelId);
  }

  getMetrics(modelId: string): ModelMetrics | null {
    const cached = this.getCachedMetrics(modelId);
    if (cached) return cached;

    const records = this.db.prepare(`
      SELECT * FROM execution_records
      WHERE model_id = ?
      ORDER BY timestamp DESC
    `).all(modelId) as DbExecutionRecord[];

    if (records.length === 0) return null;

    const recentRecords = records.slice(0, 200);
    const metrics = this.computeMetrics(modelId, recentRecords, records);
    this.cacheMetrics(modelId, metrics);

    return metrics;
  }

  private computeMetrics(
    modelId: string,
    recentRecords: DbExecutionRecord[],
    allRecords: DbExecutionRecord[]
  ): ModelMetrics {
    const total = recentRecords.length;
    const successes = recentRecords.filter(r => r.success === 1);
    const failures = recentRecords.filter(r => r.success === 0);

    const categories = new Map<string, DbExecutionRecord[]>();
    for (const r of recentRecords) {
      const cat = r.task_category;
      if (!categories.has(cat)) categories.set(cat, []);
      categories.get(cat)!.push(r);
    }

    const latencies = recentRecords.map(r => r.latency_ms).sort((a, b) => a - b);
    const p50Index = Math.floor(latencies.length * 0.5);
    const p95Index = Math.floor(latencies.length * 0.95);

    const categoryMetrics: Record<string, {
      successRate: number;
      avgLatencyMs: number;
      avgRetries: number;
      totalTasks: number;
    }> = {};

    for (const [cat, catRecords] of categories) {
      const catSuccesses = catRecords.filter(r => r.success === 1);
      categoryMetrics[cat] = {
        successRate: catRecords.length > 0 ? catSuccesses.length / catRecords.length : 0,
        avgLatencyMs: catRecords.length > 0
          ? catRecords.reduce((sum, r) => sum + r.latency_ms, 0) / catRecords.length
          : 0,
        avgRetries: catRecords.length > 0
          ? catRecords.reduce((sum, r) => sum + r.retries_used, 0) / catRecords.length
          : 0,
        totalTasks: catRecords.length
      };
    }

    const codeRecords = recentRecords.filter(r => r.task_category === 'code');
    const codeSuccesses = codeRecords.filter(r => r.success === 1);
    const jsonParseSuccesses = recentRecords.filter(r => r.parse_succeeded === 1);
    const multiFileRecords = recentRecords.filter(r => r.task_category === 'multi_file');
    const multiFileSuccesses = multiFileRecords.filter(r => r.success === 1);
    const reasoningRecords = recentRecords.filter(r => r.task_category === 'reasoning');
    const reasoningSuccesses = reasoningRecords.filter(r => r.success === 1);
    const firstAttemptSuccess = recentRecords.filter(r => r.success === 1 && r.retries_used === 0);
    const timeouts = recentRecords.filter(r =>
      r.failure_reason && r.failure_reason.toLowerCase().includes('timeout')
    );
    const validationFailures = recentRecords.filter(r => r.validation_succeeded === 0);

    return {
      modelId,
      provider: recentRecords[0]?.provider || 'unknown',
      overallSuccessRate: total > 0 ? successes.length / total : 0,
      codeSuccessRate: codeRecords.length > 0 ? codeSuccesses.length / codeRecords.length : 0,
      jsonComplianceRate: total > 0 ? jsonParseSuccesses.length / total : 0,
      multiFileSuccessRate: multiFileRecords.length > 0 ? multiFileSuccesses.length / multiFileRecords.length : 0,
      reasoningSuccessRate: reasoningRecords.length > 0 ? reasoningSuccesses.length / reasoningRecords.length : 0,
      firstAttemptSuccessRate: total > 0 ? firstAttemptSuccess.length / total : 0,
      averageRetriesNeeded: total > 0
        ? recentRecords.reduce((sum, r) => sum + r.retries_used, 0) / total
        : 0,
      failureRate: total > 0 ? failures.length / total : 0,
      timeoutRate: total > 0 ? timeouts.length / total : 0,
      parseFailureRate: total > 0
        ? recentRecords.filter(r => r.parse_succeeded === 0).length / total
        : 0,
      validationFailureRate: total > 0 ? validationFailures.length / total : 0,
      averageLatencyMs: total > 0
        ? recentRecords.reduce((sum, r) => sum + r.latency_ms, 0) / total
        : 0,
      p50LatencyMs: latencies[p50Index] || 0,
      p95LatencyMs: latencies[p95Index] || 0,
      averageTokensPerResponse: total > 0
        ? recentRecords.reduce((sum, r) => sum + r.tokens_used, 0) / total
        : 0,
      averageCostPerTask: total > 0
        ? recentRecords.reduce((sum, r) => sum + r.cost_usd, 0) / total
        : 0,
      totalCostUsd: allRecords.reduce((sum, r) => sum + r.cost_usd, 0),
      totalTasks: allRecords.length,
      totalSuccesses: allRecords.filter(r => r.success === 1).length,
      totalFailures: allRecords.filter(r => r.success === 0).length,
      firstSeen: allRecords[allRecords.length - 1]?.timestamp || new Date().toISOString(),
      lastUsed: allRecords[0]?.timestamp || new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      categoryMetrics
    };
  }

  getAllModelMetrics(): ModelMetrics[] {
    const modelIds = this.db.prepare(`
      SELECT DISTINCT model_id FROM execution_records
    `).all() as { model_id: string }[];

    return modelIds
      .map(row => this.getMetrics(row.model_id))
      .filter((m): m is ModelMetrics => m !== null);
  }

  storeBenchmarkResults(
    modelId: string,
    provider: string,
    suite: string,
    results: Record<string, unknown>
  ): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO benchmark_results
        (id, model_id, provider, benchmark_suite, results_json, run_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      nanoid(),
      modelId,
      provider,
      suite,
      JSON.stringify(results),
      new Date().toISOString()
    );
  }

  private getCachedMetrics(modelId: string): ModelMetrics | null {
    const cached = this.db.prepare(`
      SELECT metrics_json, computed_at FROM model_metrics_cache
      WHERE model_id = ?
    `).get(modelId) as CachedMetrics | undefined;

    if (!cached) return null;

    const cacheAge = Date.now() - new Date(cached.computed_at).getTime();
    if (cacheAge > 5 * 60 * 1000) return null;

    return JSON.parse(cached.metrics_json);
  }

  private cacheMetrics(modelId: string, metrics: ModelMetrics): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO model_metrics_cache
        (model_id, provider, metrics_json, computed_at)
      VALUES (?, ?, ?, ?)
    `).run(
      modelId,
      metrics.provider,
      JSON.stringify(metrics),
      new Date().toISOString()
    );
  }

  private invalidateCache(modelId: string): void {
    this.db.prepare(`
      DELETE FROM model_metrics_cache WHERE model_id = ?
    `).run(modelId);
  }

  getRecentExecutions(modelId: string, limit: number = 50): ExecutionRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM execution_records
      WHERE model_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(modelId, limit) as DbExecutionRecord[];

    return rows.map(r => this.mapToExecutionRecord(r));
  }

  getExecutionsByCategory(
    modelId: string,
    category: string,
    limit: number = 50
  ): ExecutionRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM execution_records
      WHERE model_id = ? AND task_category = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(modelId, category, limit) as DbExecutionRecord[];

    return rows.map(r => this.mapToExecutionRecord(r));
  }

  private mapToExecutionRecord(r: DbExecutionRecord): ExecutionRecord {
    return {
      id: r.id,
      modelId: r.model_id,
      provider: r.provider,
      taskCategory: r.task_category,
      instruction: r.instruction,
      success: r.success === 1,
      retriesUsed: r.retries_used,
      latencyMs: r.latency_ms,
      tokensUsed: r.tokens_used,
      costUsd: r.cost_usd,
      parseSucceeded: r.parse_succeeded === 1,
      validationSucceeded: r.validation_succeeded === 1,
      failureReason: r.failure_reason || undefined,
      timestamp: r.timestamp
    };
  }

  pruneOldRecords(maxAgeDays: number = 90): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxAgeDays);

    const result = this.db.prepare(`
      DELETE FROM execution_records WHERE timestamp < ?
    `).run(cutoff.toISOString());

    return result.changes;
  }

  close(): void {
    this.db.close();
  }
}

let globalMetricsStore: MetricsStore | null = null;

export function initMetricsStore(dbPath?: string): MetricsStore {
  globalMetricsStore = new MetricsStore(dbPath);
  return globalMetricsStore;
}

export function getMetricsStore(): MetricsStore {
  if (!globalMetricsStore) {
    return initMetricsStore();
  }
  return globalMetricsStore;
}

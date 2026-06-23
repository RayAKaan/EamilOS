import Database from 'better-sqlite3';
import { ExecutionOutcome, HistoricalMatch, OutcomeAggregation } from './prediction-types.js';
import { FailureType } from './stateful-types.js';
import { PredictionSignals } from './prediction-types.js';
import { calculateContextSimilarity } from './signal-extractor.js';

export interface ProfilerConfig {
  dbPath: string;
  maxOutcomes: number;
  retentionDays: number;
}

const DEFAULT_CONFIG: ProfilerConfig = {
  dbPath: './eamilos-predictions.db',
  maxOutcomes: 10000,
  retentionDays: 90,
};

export class HistoryProfiler {
  private db: Database.Database;
  private config: ProfilerConfig;

  constructor(config: Partial<ProfilerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.db = new Database(this.config.dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS execution_outcomes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        strategy_used TEXT NOT NULL,
        failure_type TEXT,
        target_model TEXT NOT NULL,
        file_extensions TEXT NOT NULL,
        outcome TEXT NOT NULL,
        time_to_complete_ms INTEGER,
        timestamp INTEGER NOT NULL,
        UNIQUE(session_id, node_id)
      );

      CREATE INDEX IF NOT EXISTS idx_outcomes_profile
      ON execution_outcomes(failure_type, target_model, outcome);

      CREATE INDEX IF NOT EXISTS idx_outcomes_strategy
      ON execution_outcomes(strategy_used, outcome);

      CREATE INDEX IF NOT EXISTS idx_outcomes_timestamp
      ON execution_outcomes(timestamp);
    `);
  }

  recordOutcome(outcome: ExecutionOutcome): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO execution_outcomes
      (session_id, node_id, strategy_used, failure_type, target_model, file_extensions, outcome, time_to_complete_ms, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      outcome.sessionId,
      outcome.nodeId,
      outcome.strategyUsed,
      outcome.failureType || null,
      outcome.targetModel,
      outcome.fileExtensions,
      outcome.outcome,
      outcome.timeToCompleteMs || null,
      outcome.timestamp
    );

    this.enforceRetention();
  }

  private enforceRetention(): void {
    const cutoffTime = Date.now() - (this.config.retentionDays * 24 * 60 * 60 * 1000);

    const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM execution_outcomes');
    const count = (countStmt.get() as { count: number }).count;

    if (count > this.config.maxOutcomes) {
      const deleteStmt = this.db.prepare(`
        DELETE FROM execution_outcomes WHERE id IN (
          SELECT id FROM execution_outcomes ORDER BY timestamp ASC LIMIT ?
        )
      `);
      deleteStmt.run(count - this.config.maxOutcomes);
    }

    const deleteOldStmt = this.db.prepare('DELETE FROM execution_outcomes WHERE timestamp < ?');
    deleteOldStmt.run(cutoffTime);
  }

  queryOutcomes(
    failureType?: FailureType,
    targetModel?: string,
    limit: number = 100
  ): ExecutionOutcome[] {
    let sql = 'SELECT * FROM execution_outcomes WHERE 1=1';
    const params: unknown[] = [];

    if (failureType) {
      sql += ' AND failure_type = ?';
      params.push(failureType);
    }

    if (targetModel) {
      sql += ' AND target_model = ?';
      params.push(targetModel);
    }

    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      id: number;
      session_id: string;
      node_id: string;
      strategy_used: string;
      failure_type: string | null;
      target_model: string;
      file_extensions: string;
      outcome: string;
      time_to_complete_ms: number | null;
      timestamp: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      sessionId: row.session_id,
      nodeId: row.node_id,
      strategyUsed: row.strategy_used,
      failureType: row.failure_type as FailureType | undefined,
      targetModel: row.target_model,
      fileExtensions: row.file_extensions,
      outcome: row.outcome as 'success' | 'failed',
      timeToCompleteMs: row.time_to_complete_ms || undefined,
      timestamp: row.timestamp,
    }));
  }

  findSimilarOutcomes(
    signals: PredictionSignals,
    limit: number = 50
  ): HistoricalMatch[] {
    let sql = 'SELECT * FROM execution_outcomes WHERE 1=1';
    const params: unknown[] = [];

    if (signals.failureType) {
      sql += ' AND failure_type = ?';
      params.push(signals.failureType);
    }

    if (signals.targetModel) {
      sql += ' AND target_model = ?';
      params.push(signals.targetModel);
    }

    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit * 2);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      session_id: string;
      node_id: string;
      strategy_used: string;
      failure_type: string | null;
      target_model: string;
      file_extensions: string;
      outcome: string;
      time_to_complete_ms: number | null;
      timestamp: number;
    }>;

    const currentExtensions = new Set(signals.fileExtensions);
    const matches: HistoricalMatch[] = [];

    for (const row of rows) {
      if (matches.length >= limit) break;

      const historicalExtensions = JSON.parse(row.file_extensions) as string[];
      const historicalSet = new Set(historicalExtensions);

      let extensionOverlap = 0;
      if (currentExtensions.size > 0 && historicalSet.size > 0) {
        for (const ext of currentExtensions) {
          if (historicalSet.has(ext)) extensionOverlap++;
        }
        extensionOverlap = extensionOverlap / Math.max(currentExtensions.size, historicalSet.size);
      }

      const similarity = calculateContextSimilarity(signals, {
        failureType: row.failure_type as FailureType | undefined,
        targetModel: row.target_model,
        fileExtensions: historicalExtensions,
      });

      matches.push({
        sessionId: row.session_id,
        nodeId: row.node_id,
        strategyUsed: row.strategy_used,
        outcome: row.outcome as 'success' | 'failed',
        similarity,
        failureType: row.failure_type as FailureType | undefined,
        targetModel: row.target_model,
        fileExtensions: historicalExtensions,
        timeToCompleteMs: row.time_to_complete_ms || undefined,
        timestamp: row.timestamp,
      });
    }

    return matches.sort((a, b) => b.similarity - a.similarity);
  }

  aggregateByStrategy(
    failureType?: FailureType,
    targetModel?: string
  ): OutcomeAggregation[] {
    let sql = `
      SELECT
        strategy_used,
        COUNT(*) as total_attempts,
        SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) as failure_count,
        AVG(time_to_complete_ms) as avg_time
      FROM execution_outcomes
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (failureType) {
      sql += ' AND failure_type = ?';
      params.push(failureType);
    }

    if (targetModel) {
      sql += ' AND target_model = ?';
      params.push(targetModel);
    }

    sql += ' GROUP BY strategy_used ORDER BY success_count DESC';

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      strategy_used: string;
      total_attempts: number;
      success_count: number;
      failure_count: number;
      avg_time: number | null;
    }>;

    return rows.map(row => ({
      strategyUsed: row.strategy_used,
      totalAttempts: row.total_attempts,
      successCount: row.success_count,
      failureCount: row.failure_count,
      successRate: row.total_attempts > 0 ? row.success_count / row.total_attempts : 0,
      avgTimeToCompleteMs: row.avg_time || undefined,
    }));
  }

  getStrategySuccessRate(
    strategy: string,
    failureType?: FailureType,
    targetModel?: string
  ): { rate: number; count: number } {
    let sql = `
      SELECT
        COUNT(*) as count,
        SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as successes
      FROM execution_outcomes
      WHERE strategy_used = ?
    `;
    const params: unknown[] = [strategy];

    if (failureType) {
      sql += ' AND failure_type = ?';
      params.push(failureType);
    }

    if (targetModel) {
      sql += ' AND target_model = ?';
      params.push(targetModel);
    }

    const stmt = this.db.prepare(sql);
    const row = stmt.get(...params) as { count: number; successes: number };

    return {
      rate: row.count > 0 ? row.successes / row.count : 0,
      count: row.count,
    };
  }

  hasDataForContext(failureType?: FailureType, targetModel?: string): boolean {
    let sql = 'SELECT COUNT(*) as count FROM execution_outcomes WHERE 1=1';
    const params: unknown[] = [];

    if (failureType) {
      sql += ' AND failure_type = ?';
      params.push(failureType);
    }

    if (targetModel) {
      sql += ' AND target_model = ?';
      params.push(targetModel);
    }

    const stmt = this.db.prepare(sql);
    const row = stmt.get(...params) as { count: number };
    return row.count > 0;
  }

  getOutcomeCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM execution_outcomes');
    const row = stmt.get() as { count: number };
    return row.count;
  }

  close(): void {
    this.db.close();
  }
}

let globalProfiler: HistoryProfiler | null = null;

export function initHistoryProfiler(config?: Partial<ProfilerConfig>): HistoryProfiler {
  if (globalProfiler) {
    return globalProfiler;
  }
  globalProfiler = new HistoryProfiler(config);
  return globalProfiler;
}

export function getHistoryProfiler(): HistoryProfiler {
  if (!globalProfiler) {
    return initHistoryProfiler();
  }
  return globalProfiler;
}

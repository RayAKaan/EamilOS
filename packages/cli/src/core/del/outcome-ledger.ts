import { ExecutionOutcome, PredictionSignals } from './prediction-types.js';
import { HistoryProfiler } from './history-profiler.js';

export interface OutcomeLedgerConfig {
  autoRecord: boolean;
  recordFailures: boolean;
  recordSuccesses: boolean;
}

const DEFAULT_CONFIG: OutcomeLedgerConfig = {
  autoRecord: true,
  recordFailures: true,
  recordSuccesses: true,
};

export class OutcomeLedger {
  private profiler: HistoryProfiler;
  private config: OutcomeLedgerConfig;
  private pendingOutcomes: ExecutionOutcome[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushIntervalMs: number = 1000;

  constructor(profiler: HistoryProfiler, config?: Partial<OutcomeLedgerConfig>) {
    this.profiler = profiler;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  record(
    sessionId: string,
    nodeId: string,
    strategyUsed: string,
    signals: PredictionSignals,
    outcome: 'success' | 'failed',
    timeToCompleteMs?: number
  ): void {
    if (outcome === 'failed' && !this.config.recordFailures) {
      return;
    }

    if (outcome === 'success' && !this.config.recordSuccesses) {
      return;
    }

    const executionOutcome: ExecutionOutcome = {
      sessionId,
      nodeId,
      strategyUsed,
      failureType: signals.failureType,
      targetModel: signals.targetModel,
      fileExtensions: JSON.stringify(signals.fileExtensions),
      outcome,
      timeToCompleteMs,
      timestamp: Date.now(),
    };

    this.pendingOutcomes.push(executionOutcome);

    if (this.config.autoRecord) {
      this.scheduleFlush();
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flush();
    }, this.flushIntervalMs);
  }

  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const outcomes = this.pendingOutcomes;
    this.pendingOutcomes = [];

    for (const outcome of outcomes) {
      try {
        this.profiler.recordOutcome(outcome);
      } catch (error) {
        console.error('Failed to record outcome:', error);
        this.pendingOutcomes.push(outcome);
      }
    }
  }

  recordSuccess(
    sessionId: string,
    nodeId: string,
    strategyUsed: string,
    signals: PredictionSignals,
    timeToCompleteMs?: number
  ): void {
    this.record(sessionId, nodeId, strategyUsed, signals, 'success', timeToCompleteMs);
  }

  recordFailure(
    sessionId: string,
    nodeId: string,
    strategyUsed: string,
    signals: PredictionSignals,
    timeToCompleteMs?: number
  ): void {
    this.record(sessionId, nodeId, strategyUsed, signals, 'failed', timeToCompleteMs);
  }

  getPendingCount(): number {
    return this.pendingOutcomes.length;
  }

  setFlushInterval(ms: number): void {
    this.flushIntervalMs = ms;
  }

  enableAutoRecord(): void {
    this.config.autoRecord = true;
  }

  disableAutoRecord(): void {
    this.config.autoRecord = false;
  }

  close(): void {
    this.flush();
  }
}

export function createOutcomeLedger(
  profiler: HistoryProfiler,
  config?: Partial<OutcomeLedgerConfig>
): OutcomeLedger {
  return new OutcomeLedger(profiler, config);
}

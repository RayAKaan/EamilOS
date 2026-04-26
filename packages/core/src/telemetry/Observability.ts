import { EventEmitter } from 'events';

export interface MetricsData {
  taskDuration: number;
  taskFailures: number;
  agentExecutions: number;
  tokenUsage: number;
  nodeHealth: number;
}

export class Observability extends EventEmitter {
  private histograms: Map<string, number[]> = new Map();
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private startTime: number;

  constructor(private serviceName: string = 'eamilos-core') {
    super();
    this.startTime = Date.now();
    this.initializeMetrics();
  }

  private initializeMetrics(): void {
    this.counters.set('task_executions_total', 0);
    this.counters.set('task_failures_total', 0);
    this.counters.set('agent_executions_total', 0);
    this.counters.set('tokens_used_total', 0);

    this.gauges.set('node_health_score', 100);
    this.gauges.set('active_tasks', 0);
    this.gauges.set('memory_usage_bytes', 0);
    this.gauges.set('cpu_usage_percent', 0);

    this.histograms.set('task_duration_ms', []);
  }

  recordTaskExecution(
    agentId: string,
    durationMs: number,
    success: boolean,
    tokens?: number
  ): void {
    this.incrementCounter('task_executions_total');
    this.addToHistogram('task_duration_ms', durationMs);

    if (!success) {
      this.incrementCounter('task_failures_total');
      this.emit('task:failed', { agentId, durationMs });
    }

    if (tokens) {
      this.incrementCounter('tokens_used_total', tokens);
    }

    this.emit('task:recorded', {
      agentId,
      durationMs,
      success,
      tokens
    });
  }

  recordNodeHealth(nodeId: string, score: number): void {
    const key = `node_health_${nodeId}`;
    this.gauges.set(key, score);
    this.emit('node:health', { nodeId, score });
  }

  recordAgentCommunication(
    from: string,
    to: string,
    messageType: string
  ): void {
    this.emit('agent:communication', {
      from,
      to,
      type: messageType,
      timestamp: Date.now()
    });
  }

  updateResourceUsage(): void {
    const memUsage = process.memoryUsage();
    this.gauges.set('memory_usage_bytes', memUsage.heapUsed);

    const cpuUsage = process.cpuUsage();
    this.gauges.set('cpu_usage_percent', cpuUsage.user / 1000000);
  }

  incrementCounter(name: string, value: number = 1): void {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + value);
  }

  addToHistogram(name: string, value: number): void {
    const histogram = this.histograms.get(name) || [];
    histogram.push(value);
    if (histogram.length > 1000) {
      histogram.shift();
    }
    this.histograms.set(name, histogram);
  }

  getMetric(name: string): number | undefined {
    return this.counters.get(name) ?? this.gauges.get(name);
  }

  getHistogramStats(name: string): {
    count: number;
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  } | null {
    const values = this.histograms.get(name);
    if (!values || values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      count: sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / sorted.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }

  getAllMetrics(): Record<string, number> {
    const result: Record<string, number> = {};

    this.counters.forEach((value, key) => {
      result[key] = value;
    });

    this.gauges.forEach((value, key) => {
      result[key] = value;
    });

    return result;
  }

  getPrometheusMetrics(): string {
    const lines: string[] = [
      `# HELP eamilos_task_executions_total Total task executions`,
      `# TYPE eamilos_task_executions_total counter`
    ];

    for (const [key, value] of this.counters) {
      if (key.includes('total')) {
        lines.push(`eamilos_${key} ${value}`);
      }
    }

    lines.push(
      `# HELP eamilos_task_duration_ms Task duration histogram`,
      `# TYPE eamilos_task_duration_ms histogram`
    );

    const durationStats = this.getHistogramStats('task_duration_ms');
    if (durationStats) {
      lines.push(`eamilos_task_duration_ms_count ${durationStats.count}`);
      lines.push(`eamilos_task_duration_ms_sum ${durationStats.avg * durationStats.count}`);
    }

    lines.push(`# HELP eamilos_uptime_seconds Service uptime`);
    lines.push(`# TYPE eamilos_uptime_seconds gauge`);
    lines.push(`eamilos_uptime_seconds ${Math.floor((Date.now() - this.startTime) / 1000)}`);

    return lines.join('\n');
  }

  start(): void {
    this.emit('started', { serviceName: this.serviceName });
    console.log(`Observability started for ${this.serviceName}`);
  }

  shutdown(): void {
    this.emit('shutdown');
  }

  getUptime(): number {
    return Date.now() - this.startTime;
  }
}
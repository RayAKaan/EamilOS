import { createServer, Server, IncomingMessage, ServerResponse } from 'http';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'critical';
  timestamp: number;
  uptime: number;
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  cpu: {
    user: number;
    system: number;
  };
  nodes: {
    connected: number;
    ready: number;
  };
}

export class HealthEndpoint {
  private server?: Server;
  private customChecks: Map<string, () => Promise<boolean>> = new Map();

  constructor(
    private port: number = 8080,
    private getNodeCount?: () => number,
    private getHealthyNodeCount?: () => number
  ) {}

  start(): void {
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const start = Date.now();

      if (req.url === '/health') {
        this.handleHealthCheck(res);
      } else if (req.url === '/metrics') {
        this.handleMetrics(res);
      } else if (req.url === '/ready') {
        this.handleReadyCheck(res);
      } else if (req.url === '/live') {
        this.handleLivenessCheck(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
      }

      const duration = Date.now() - start;
      res.setHeader('X-Response-Time', `${duration}ms`);
    });

    this.server.listen(this.port, () => {
      console.log(`Health endpoint listening on :${this.port}`);
    });
  }

  private handleHealthCheck(res: ServerResponse): void {
    const status = this.getStatus();
    const code = status.status === 'healthy' ? 200 : status.status === 'degraded' ? 200 : 503;

    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
  }

  private handleMetrics(res: ServerResponse): void {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    const metrics = {
      process_uptime_seconds: process.uptime(),
      process_memory_heap_used_bytes: memUsage.heapUsed,
      process_memory_heap_total_bytes: memUsage.heapTotal,
      process_memory_rss_bytes: memUsage.rss,
      process_cpu_user_seconds: cpuUsage.user / 1000000,
      process_cpu_system_seconds: cpuUsage.system / 1000000,
      node_count: this.getNodeCount?.() ?? 0,
      healthy_node_count: this.getHealthyNodeCount?.() ?? 0
    };

    const lines = Object.entries(metrics)
      .map(([key, value]) => `eamilos_${key} ${value}`)
      .join('\n');

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(lines);
  }

  private async handleReadyCheck(res: ServerResponse): Promise<void> {
    let ready = true;

    for (const [, checkFn] of this.customChecks) {
      try {
        const result = await checkFn();
        if (!result) ready = false;
      } catch {
        ready = false;
      }
    }

    res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ready }));
  }

  private handleLivenessCheck(res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ alive: true }));
  }

  private getStatus(): HealthStatus {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const nodeCount = this.getNodeCount?.() ?? 0;
    const healthyCount = this.getHealthyNodeCount?.() ?? 0;

    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
    const memoryPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

    let status: 'healthy' | 'degraded' | 'critical' = 'healthy';
    if (memoryPercent > 90 || nodeCount === 0) {
      status = 'critical';
    } else if (memoryPercent > 75 || healthyCount === 0) {
      status = 'degraded';
    }

    return {
      status,
      timestamp: Date.now(),
      uptime: process.uptime(),
      memory: {
        heapUsed: Math.round(heapUsedMB),
        heapTotal: Math.round(heapTotalMB),
        external: Math.round(memUsage.external / 1024 / 1024),
        rss: Math.round(memUsage.rss / 1024 / 1024)
      },
      cpu: {
        user: Math.round(cpuUsage.user / 1000000),
        system: Math.round(cpuUsage.system / 1000000)
      },
      nodes: {
        connected: nodeCount,
        ready: healthyCount
      }
    };
  }

  registerCheck(name: string, checkFn: () => Promise<boolean>): void {
    this.customChecks.set(name, checkFn);
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
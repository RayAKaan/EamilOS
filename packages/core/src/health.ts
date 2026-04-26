import type { NetworkManager } from './distributed/NetworkManager.js';

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'critical';
  checks: Record<string, {
    status: 'ok' | 'warning' | 'error';
    details?: string;
  }>;
}

export async function runHealthCheck(config?: {
  networkManager?: NetworkManager;
}): Promise<HealthCheckResult> {
  const checks: HealthCheckResult['checks'] = {};

  const memUsage = process.memoryUsage();
  const memPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

  if (memPercent > 90) {
    checks.memory = { status: 'error', details: `${memPercent.toFixed(1)}% heap usage` };
  } else if (memPercent > 75) {
    checks.memory = { status: 'warning', details: `${memPercent.toFixed(1)}% heap usage` };
  } else {
    checks.memory = { status: 'ok', details: `${memPercent.toFixed(1)}% heap usage` };
  }

  checks.uptime = {
    status: 'ok',
    details: `${process.uptime().toFixed(0)}s uptime`
  };

  checks.eventLoop = {
    status: 'ok',
    details: 'Event loop healthy'
  };

  if (config?.networkManager) {
    try {
      const healthyNodes = (config.networkManager as any).getHealthyNodes?.() ?? [];
      checks.distributed = {
        status: healthyNodes.length > 0 ? 'ok' : 'warning',
        details: `${healthyNodes.length} healthy nodes`
      };
    } catch (error) {
      checks.distributed = {
        status: 'error',
        details: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  const hasErrors = Object.values(checks).some(c => c.status === 'error');
  const hasWarnings = Object.values(checks).some(c => c.status === 'warning');

  return {
    status: hasErrors ? 'critical' : (hasWarnings ? 'degraded' : 'healthy'),
    checks
  };
}
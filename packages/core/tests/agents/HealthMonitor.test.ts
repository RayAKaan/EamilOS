import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HealthMonitor, AgentHealthState } from '../../src/agents/HealthMonitor.js';

describe('HealthMonitor', () => {
  let monitor: HealthMonitor;

  beforeEach(() => {
    monitor = new HealthMonitor({
      checkInterval: 10000,
      failureThreshold: 2,
      recoveryThreshold: 70,
      failoverEnabled: true,
    });
  });

  afterEach(() => {
    monitor.stop();
  });

  it('creates with default config', () => {
    const defaultMonitor = new HealthMonitor();
    expect(defaultMonitor).toBeDefined();
    defaultMonitor.stop();
  });

  it('starts and stops cleanly', () => {
    monitor.start();
    expect(monitor).toBeDefined();
    monitor.stop();
    monitor.stop();
  });

  it('does not double-start', () => {
    monitor.start();
    monitor.start();
    monitor.stop();
  });

  it('returns empty health report initially', () => {
    const report = monitor.getHealthReport();
    expect(report.total).toBe(0);
    expect(report.healthy).toBe(0);
    expect(report.degraded).toBe(0);
    expect(report.unhealthy).toBe(0);
    expect(report.offline).toBe(0);
    expect(report.averageScore).toBe(0);
    expect(report.timestamp).toBeDefined();
  });

  it('returns null for unknown agent health', () => {
    const health = monitor.getAgentHealth('unknown-agent');
    expect(health).toBeNull();
  });

  it('updates health state for tracked agents', () => {
    const events: any[] = [];
    monitor.on('agent:health-degraded', (data) => events.push(data));

    monitor['updateHealthState']('test-agent', {
      healthy: false,
      score: 70,
      error: 'Connection refused',
      lastCheck: Date.now(),
    });

    expect(events.length).toBe(1);
    expect(events[0].agentId).toBe('test-agent');
    expect(events[0].failures).toBe(1);

    const state = monitor.getAgentHealth('test-agent');
    expect(state).not.toBeNull();
    expect(state!.status).toBe('degraded');
    expect(state!.consecutiveFailures).toBe(1);
  });

  it('tracks consecutive failures', () => {
    monitor['updateHealthState']('agent-1', {
      healthy: false,
      score: 70,
      error: 'err1',
      lastCheck: Date.now(),
    });

    monitor['updateHealthState']('agent-1', {
      healthy: false,
      score: 40,
      error: 'err2',
      lastCheck: Date.now(),
    });

    const state = monitor.getAgentHealth('agent-1');
    expect(state!.consecutiveFailures).toBe(2);
    expect(state!.status).toBe('unhealthy');
  });

  it('resets failure count on recovery', () => {
    monitor['updateHealthState']('agent-2', {
      healthy: false,
      score: 70,
      error: 'err',
      lastCheck: Date.now(),
    });

    const recoveryEvents: any[] = [];
    monitor.on('agent:recovered', (data) => recoveryEvents.push(data));

    monitor['updateHealthState']('agent-2', {
      healthy: true,
      score: 100,
      lastCheck: Date.now(),
    });

    expect(recoveryEvents.length).toBe(1);
    expect(recoveryEvents[0].agentId).toBe('agent-2');

    const state = monitor.getAgentHealth('agent-2');
    expect(state!.consecutiveFailures).toBe(0);
    expect(state!.status).toBe('healthy');
  });

  it('triggers failover on threshold reached', () => {
    const failoverEvents: any[] = [];
    monitor.on('agent:failover', (data) => failoverEvents.push(data));
    monitor.on('agent:failover-failed', (data) => failoverEvents.push(data));

    for (let i = 0; i < 3; i++) {
      monitor['updateHealthState']('failing-agent', {
        healthy: false,
        score: 100 - (i + 1) * 30,
        error: `err-${i}`,
        lastCheck: Date.now(),
      });
    }

    expect(failoverEvents.length).toBe(2);
    expect(failoverEvents[1]).toHaveProperty('agentId', 'failing-agent');

    const state = monitor.getAgentHealth('failing-agent');
    expect(state!.consecutiveFailures).toBe(3);
    expect(state!.score).toBe(10);
  });

  it('tracks pending tasks for agents', () => {
    monitor.markTaskPending('agent-a', 'task-1');
    monitor.markTaskPending('agent-a', 'task-2');
    monitor.markTaskPending('agent-b', 'task-3');

    expect(monitor.getPendingTasksForAgent('agent-a')).toEqual(['task-1', 'task-2']);
    expect(monitor.getPendingTasksForAgent('agent-b')).toEqual(['task-3']);
    expect(monitor.getPendingTasksForAgent('agent-c')).toEqual([]);
  });

  it('removes pending tasks', () => {
    monitor.markTaskPending('agent-a', 'task-1');
    monitor.markTaskPending('agent-a', 'task-2');
    monitor.removePendingTask('agent-a', 'task-1');

    expect(monitor.getPendingTasksForAgent('agent-a')).toEqual(['task-2']);
  });

  it('reassigns pending tasks during failover', () => {
    monitor.markTaskPending('agent-a', 'task-1');
    monitor.markTaskPending('agent-a', 'task-2');

    const count = monitor.reassignPendingTasks('agent-a', 'agent-b');
    expect(count).toBe(2);
    expect(monitor.getPendingTasksForAgent('agent-a')).toEqual([]);
    expect(monitor.getPendingTasksForAgent('agent-b')).toEqual(['task-1', 'task-2']);
  });

  it('generates health report with mixed states', () => {
    monitor['updateHealthState']('healthy-1', { healthy: true, score: 100, lastCheck: Date.now() });
    monitor['updateHealthState']('degraded-1', { healthy: false, score: 70, error: 'slow', lastCheck: Date.now() });

    for (let i = 0; i < 3; i++) {
      monitor['updateHealthState']('unhealthy-1', {
        healthy: false,
        score: 0,
        error: 'down',
        lastCheck: Date.now(),
      });
    }

    const report = monitor.getHealthReport();
    expect(report.healthy).toBeGreaterThanOrEqual(1);
    expect(report.degraded).toBeGreaterThanOrEqual(1);
    expect(report.unhealthy).toBeGreaterThanOrEqual(1);
    expect(report.total).toBeGreaterThanOrEqual(3);
    expect(report.averageScore).toBeGreaterThan(0);
  });

  it('emits health-degraded event with correct data', () => {
    const events: any[] = [];
    monitor.on('agent:health-degraded', (data) => events.push(data));

    monitor['updateHealthState']('test', {
      healthy: false,
      score: 70,
      error: 'timeout',
      lastCheck: Date.now(),
    });

    expect(events.length).toBe(1);
    expect(events[0].agentId).toBe('test');
    expect(events[0].score).toBe(70);
    expect(events[0].error).toBe('timeout');
  });

  it('returns all health states', () => {
    monitor['updateHealthState']('a', { healthy: true, score: 100, lastCheck: Date.now() });
    monitor['updateHealthState']('b', { healthy: false, score: 70, lastCheck: Date.now() });

    const states = monitor.getAllHealthStates();
    expect(states.size).toBe(2);
    expect(states.has('a')).toBe(true);
    expect(states.has('b')).toBe(true);
  });

  it('no-op on reassigning from agent with no tasks', () => {
    const count = monitor.reassignPendingTasks('empty-agent', 'target-agent');
    expect(count).toBe(0);
  });
});

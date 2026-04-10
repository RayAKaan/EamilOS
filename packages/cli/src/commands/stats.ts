import chalk from 'chalk';
import { getNetworkManager, getTaskStore } from '@eamilos/core';

interface NodeStats {
  name: string;
  state: string;
  load: string;
  latency: string;
  successRate: string;
  score: number;
}

export async function statsCommand(): Promise<void> {
  const networkManager = getNetworkManager();
  const taskStore = getTaskStore();

  console.log(chalk.bold('\n╭─ EamilOS Stats ──────────────────────────────────────────╮'));

  if (networkManager) {
    const workers = networkManager.getConnectedWorkers();
    const capacity = networkManager.getNetworkCapacity();
    const nodeStats: NodeStats[] = [];

    for (const worker of workers) {
      const metrics = networkManager.getNodeMetrics(worker.identity.id);

      const loadPercent = worker.capabilities.maxConcurrentTasks > 0
        ? Math.round((worker.capabilities.currentLoad / worker.capabilities.maxConcurrentTasks) * 100)
        : 0;

      nodeStats.push({
        name: worker.identity.name,
        state: worker.degraded ? 'degraded' : worker.connectionState,
        load: `${worker.capabilities.currentLoad}/${worker.capabilities.maxConcurrentTasks} (${loadPercent}%)`,
        latency: metrics ? `${metrics.avgLatencyMs}ms` : 'n/a',
        successRate: metrics ? `${Math.round(metrics.successRate * 100)}%` : 'n/a',
        score: worker.score,
      });
    }

    console.log('│'.padEnd(62) + '│');
    console.log(`│  ${chalk.bold('Nodes')} ${workers.length} connected · ${capacity.totalGPUs} GPUs`.padEnd(60) + '│');
    console.log('│'.padEnd(62) + '│');

    if (nodeStats.length > 0) {
      console.log(`│  ${chalk.dim('NODE').padEnd(15)} ${chalk.dim('STATE').padEnd(10)} ${chalk.dim('LOAD').padEnd(12)} ${chalk.dim('LATENCY').padEnd(10)} ${chalk.dim('SUCCESS').padEnd(10)} ${chalk.dim('SCORE')}`.padEnd(60) + '│');
      console.log('│  ' + '─'.repeat(58).padEnd(60) + '│');

      for (const stat of nodeStats) {
        const stateColor = stat.state === 'ready' ? chalk.green
          : stat.state === 'busy' ? chalk.yellow
          : stat.state === 'degraded' ? chalk.red
          : chalk.dim;
        const scoreColor = stat.score >= 70 ? chalk.green
          : stat.score >= 40 ? chalk.yellow
          : chalk.red;

        console.log(
          `│  ${stat.name.padEnd(15)} ${stateColor(stat.state.padEnd(10))} ${stat.load.padEnd(12)} ${stat.latency.padEnd(10)} ${stat.successRate.padEnd(10)} ${scoreColor(stat.score.toString().padEnd(5))}`
            .padEnd(60) + '│'
        );
      }
    } else {
      console.log(`│  ${chalk.dim('No remote nodes connected')}`.padEnd(60) + '│');
    }

    console.log('│'.padEnd(62) + '│');
    console.log(`│  ${chalk.bold('Capacity')} ${capacity.availableTaskSlots} slots free / ${capacity.totalTaskSlots} total`.padEnd(60) + '│');
    console.log(`│  Models: ${capacity.totalModels.slice(0, 5).join(', ')}${capacity.totalModels.length > 5 ? '...' : ''}`.padEnd(60) + '│');
  } else {
    console.log('│'.padEnd(62) + '│');
    console.log(`│  ${chalk.yellow('Network manager not initialized')}`.padEnd(60) + '│');
  }

  if (taskStore) {
    const storeStats = taskStore.getStats();
    console.log('│'.padEnd(62) + '│');
    console.log(`│  ${chalk.bold('Tasks')} ${storeStats.total} total`.padEnd(60) + '│');
    console.log(`│    ${chalk.green('●')} ${storeStats.pending} pending  ${chalk.yellow('◐')} ${storeStats.running} running  ${chalk.green('✓')} ${storeStats.completed} done  ${chalk.red('✗')} ${storeStats.failed} failed`.padEnd(60) + '│');

    const priorityTasks = storeStats.byPriority;
    if (priorityTasks.high > 0 || priorityTasks.normal > 0 || priorityTasks.low > 0) {
      console.log(`│  ${chalk.bold('By Priority')} high:${priorityTasks.high} normal:${priorityTasks.normal} low:${priorityTasks.low}`.padEnd(60) + '│');
    }
  }

  console.log(chalk.bold('╰─────────────────────────────────────────────────────────╯\n'));
}

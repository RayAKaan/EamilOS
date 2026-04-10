import chalk from 'chalk';
import { getNetworkManager } from '@eamilos/core';

export async function nodesCommand(): Promise<void> {
  const networkManager = getNetworkManager();

  console.log(chalk.bold('\n╭─ Network Nodes ────────────────────────────────────────╮'));

  console.log(`│  ${chalk.green('●')} ${chalk.white('local'.padEnd(18))} ${chalk.green('ready'.padEnd(14))} this machine`.padEnd(58) + '│');

  if (networkManager) {
    const workers = networkManager.getConnectedWorkers();
    const capacity = networkManager.getNetworkCapacity();

    for (const worker of workers) {
      const icon = worker.connectionState === 'ready' ? chalk.green('●')
        : worker.connectionState === 'busy' ? chalk.yellow('●')
        : chalk.red('●');

      const models = worker.capabilities.models.slice(0, 3).map((m: { modelId: string }) => m.modelId).join(', ') || 'none';
      const gpu = worker.capabilities.gpus.length > 0
        ? chalk.magenta(` [GPU: ${worker.capabilities.gpus[0].name}]`)
        : '';

      console.log(`│  ${icon} ${chalk.white(worker.identity.name.padEnd(18))} ${worker.connectionState.padEnd(14)} ${models}${gpu}`.padEnd(58) + '│');
    }

    console.log('│'.padEnd(58) + '│');
    console.log(`│  Network: ${capacity.connectedNodes} nodes · ${capacity.totalModels.length} models · ${capacity.totalGPUs} GPUs`.padEnd(58) + '│');
    console.log(`│  Capacity: ${capacity.availableTaskSlots}/${capacity.totalTaskSlots} slots available`.padEnd(58) + '│');
  } else {
    console.log('│'.padEnd(58) + '│');
    console.log(`│  ${chalk.yellow('Network manager not initialized')}`.padEnd(58) + '│');
    console.log(`│  Run 'eamilos connect <address>' to connect to workers`.padEnd(58) + '│');
  }

  console.log(chalk.bold('╰────────────────────────────────────────────────────────╯\n'));
}

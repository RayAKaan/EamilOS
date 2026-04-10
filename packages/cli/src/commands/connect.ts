import chalk from 'chalk';
import { initNetworkManager } from '@eamilos/core';

interface ConnectArgs {
  address: string;
  key?: string;
  name?: string;
}

export async function connectCommand(args: ConnectArgs): Promise<void> {
  const { address, key, name } = args;

  const networkKey = key || process.env.EAMILOS_NETWORK_KEY;
  if (!networkKey) {
    console.error(chalk.red('Error: Network key required'));
    console.log(chalk.dim('Provide a key: eamilos connect <address> --key your_secret'));
    console.log(chalk.dim('Or set environment variable: export EAMILOS_NETWORK_KEY=your_secret'));
    process.exit(1);
  }

  console.log(chalk.cyan(`Connecting to ${address}...`));

  const identity = {
    id: `controller_${Date.now()}`,
    name: `controller-${process.env.COMPUTERNAME || 'local'}`,
    role: 'controller' as const,
    version: '1.0.0',
    startedAt: Date.now(),
  };

  const networkConfig = {
    security: {
      sharedKey: networkKey,
      sessionTimeoutMs: 3600000,
      requireSignedMessages: true,
      maxConnectionAttempts: 5,
      banDurationMs: 300000,
    },
    heartbeat: {
      intervalMs: 10000,
      timeoutMs: 30000,
      missedBeforeDisconnect: 3,
    },
    execution: {
      taskTimeoutMs: 300000,
      retryOnNodeFailure: true,
      maxTaskRetries: 2,
      preferLocalExecution: true,
      mode: 'hybrid' as const,
    },
  };

  const networkManager = initNetworkManager('controller', identity, networkConfig);

  try {
    const nodeStatus = await networkManager.connectToWorker(address, name);

    console.log(chalk.green(`\n✔ Connected to ${nodeStatus.identity.name}`));
    console.log(chalk.dim(`  Node ID: ${nodeStatus.identity.id}`));
    console.log(chalk.dim(`  Models: ${nodeStatus.capabilities.models.map((m: { modelId: string }) => m.modelId).join(', ') || 'none'}`));
    console.log(chalk.dim(`  GPUs: ${nodeStatus.capabilities.gpus.map((g: { name: string }) => g.name).join(', ') || 'none'}`));
    console.log(chalk.dim(`  Score: ${nodeStatus.score}/100`));
    console.log('');
  } catch (error) {
    console.log(chalk.red(`\n✗ Failed to connect`));
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}

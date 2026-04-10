import chalk from 'chalk';
import { initNetworkManager, NodeCapabilityScanner } from '@eamilos/core';

interface WorkerArgs {
  port?: number;
  key?: string;
}

export async function workerStartCommand(args: WorkerArgs): Promise<void> {
  const port = args.port || 7890;
  const key = args.key || process.env.EAMILOS_NETWORK_KEY;

  if (!key) {
    console.error(chalk.red('Error: Network key required'));
    console.log(chalk.dim('Provide a key: eamilos worker start --key your_secret'));
    console.log(chalk.dim('Or set environment variable: export EAMILOS_NETWORK_KEY=your_secret'));
    console.log(chalk.dim('Generate a key: openssl rand -hex 32'));
    process.exit(1);
  }

  console.log(chalk.bold('\n🔧 EamilOS Worker Node\n'));

  const capabilities = await NodeCapabilityScanner.scan();

  console.log(chalk.bold('╭─ Worker Status ──────────────────────────────────────╮'));
  console.log(`│  Port: ${port}`.padEnd(55) + '│');
  console.log(`│  CPU Cores: ${capabilities.cpuCores}`.padEnd(55) + '│');
  console.log(`│  RAM: ${(capabilities.availableRAMBytes / (1024 ** 3)).toFixed(1)}GB free`.padEnd(55) + '│');
  console.log(`│  Models: ${capabilities.models.length > 0 ? capabilities.models.map(m => m.modelId).join(', ') : 'none'}`.padEnd(55) + '│');
  console.log(`│  GPUs: ${capabilities.gpus.length > 0 ? capabilities.gpus.map(g => g.name).join(', ') : 'none'}`.padEnd(55) + '│');
  console.log(`│  Max Concurrent: ${capabilities.maxConcurrentTasks}`.padEnd(55) + '│');
  console.log(chalk.bold('╰──────────────────────────────────────────────────────╯'));
  console.log('');
  console.log(chalk.green(`✔ Worker listening on port ${port}`));
  console.log(chalk.dim(`  Waiting for controller connections...`));
  console.log(chalk.dim(`  Press Ctrl+C to stop\n`));

  const identity = {
    id: `worker_${Date.now()}`,
    name: `worker-${process.env.COMPUTERNAME || 'local'}`,
    role: 'worker' as const,
    version: '1.0.0',
    startedAt: Date.now(),
  };

  const networkConfig = {
    security: {
      sharedKey: key,
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
    worker: {
      port,
      host: '0.0.0.0',
    },
  };

  const networkManager = initNetworkManager('worker', identity, networkConfig);

  networkManager.on('network:worker-started', () => {
    console.log(chalk.green('  ✔ Server started'));
  });

  networkManager.on('network:connected-to-controller', (data: unknown) => {
    const info = data as { controllerId: string };
    console.log(chalk.green(`  ✔ Connected to controller: ${info.controllerId}`));
  });

  networkManager.on('worker:task-started', (data: unknown) => {
    const info = data as { taskId: string; agentId: string; model: string };
    console.log(chalk.cyan(`  ⟳ [${info.agentId}] executing (${info.model})...`));
  });

  networkManager.on('worker:task-completed', (data: unknown) => {
    const info = data as { taskId: string; agentId: string; durationMs: number };
    console.log(chalk.green(`  ✔ [${info.agentId}] completed (${(info.durationMs / 1000).toFixed(1)}s)`));
  });

  networkManager.on('worker:task-failed', (data: unknown) => {
    const info = data as { taskId: string; agentId: string; error: string };
    console.log(chalk.red(`  ✗ [${info.agentId}] failed: ${info.error}`));
  });

  try {
    await networkManager.startWorker(port);
  } catch (error) {
    console.error(chalk.red('Failed to start worker:'), error);
    process.exit(1);
  }

  let shutdown = false;

  const cleanup = async () => {
    if (shutdown) return;
    shutdown = true;
    console.log(chalk.dim('\n  Shutting down worker...'));
    await networkManager.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

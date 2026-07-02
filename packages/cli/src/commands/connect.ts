import chalk from 'chalk';
import { initNetworkManager } from '../core/index.js';
import { TailscaleDiscovery } from '../core/distributed/TailscaleDiscovery.js';

interface ConnectArgs {
  address?: string;
  key?: string;
  name?: string;
  tailscale?: boolean;
}

export async function connectCommand(args: ConnectArgs): Promise<void> {
  const { address, key, name, tailscale } = args;

  const networkKey = key || process.env.EAMILOS_NETWORK_KEY;
  if (!networkKey) {
    console.error(chalk.red('Error: Network key required'));
    console.log(chalk.dim('Provide a key: eamilos connect <address> --key your_secret'));
    console.log(chalk.dim('Or set environment variable: export EAMILOS_NETWORK_KEY=your_secret'));
    return;
  }

  // ── Tailscale auto-discovery mode ──
  if (tailscale) {
    const isAvailable = await TailscaleDiscovery.isAvailable();
    if (!isAvailable) {
      console.error(chalk.red('Error: Tailscale is not installed or not authenticated'));
      console.log(chalk.dim('Install: https://tailscale.com/download'));
      console.log(chalk.dim('Authenticate: tailscale up'));
      return;
    }

    console.log(chalk.cyan('Discovering Tailscale peers...'));
    const peers = await TailscaleDiscovery.discoverPeers();
    const selfIP = await TailscaleDiscovery.getSelfIP();

    if (peers.length === 0) {
      console.log(chalk.yellow('No online Tailscale peers found.'));
      console.log(chalk.dim('Make sure other devices are on the same Tailscale network.'));
      return;
    }

    console.log(chalk.green(`Found ${peers.length} peer(s):\n`));
    for (const peer of peers) {
      console.log(chalk.bold(`  ${peer.hostname}`));
      console.log(chalk.dim(`    IP: ${peer.tailscaleIP} | OS: ${peer.os}`));
    }

    if (selfIP) {
      console.log(chalk.dim(`\n  Your Tailscale IP: ${selfIP}`));
    }

    // Connect to all online peers
    console.log(chalk.cyan('\nConnecting to peers...\n'));

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

    let connected = 0;
    for (const peer of peers) {
      const address = `ws://${peer.tailscaleIP}:7890`;
      try {
        const nodeStatus = await networkManager.connectToWorker(address, peer.hostname);
        connected++;
        console.log(chalk.green(`  ✔ ${peer.hostname} (${peer.tailscaleIP})`));
        console.log(chalk.dim(`    Models: ${nodeStatus.capabilities.models.map((m: { modelId: string }) => m.modelId).join(', ') || 'none'}`));
        console.log(chalk.dim(`    Score: ${nodeStatus.score}/100`));
      } catch {
        console.log(chalk.red(`  ✗ ${peer.hostname} (${peer.tailscaleIP}) — connection failed`));
      }
    }

    console.log(chalk.bold(`\nConnected to ${connected}/${peers.length} workers\n`));
    return;
  }

  // ── Direct address mode ──
  if (!address) {
    console.error(chalk.red('Error: Address required'));
    console.log(chalk.dim('Usage: eamilos connect <address> --key your_secret'));
    console.log(chalk.dim('Or:    eamilos connect --tailscale --key your_secret'));
    return;
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
  }
}

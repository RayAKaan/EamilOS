#!/usr/bin/env node
import { WorkerRuntime } from './WorkerRuntime.js';

async function main() {
  const config = {
    nodeId: process.env.EAMILOS_NODE_ID || `worker_${process.pid}`,
    controllerHost: process.env.EAMILOS_CONTROLLER_HOST || 'localhost',
    controllerPort: parseInt(process.env.EAMILOS_CONTROLLER_PORT || '3000',),
    capabilities: (process.env.EAMILOS_CAPABILITIES || 'ollama,cli').split(',').filter(Boolean),
    hmacSecret: process.env.EAMILOS_HMAC_SECRET
  };

  const worker = new WorkerRuntime(config);

  process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down...');
    await worker.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down...');
    await worker.stop();
    process.exit(0);
  });

  try {
    await worker.start();
    console.log(`Worker ${config.nodeId} connected to ${config.controllerHost}:${config.controllerPort}`);
  } catch (error) {
    console.error('Failed to start worker:', error);
    process.exit(1);
  }
}

main();
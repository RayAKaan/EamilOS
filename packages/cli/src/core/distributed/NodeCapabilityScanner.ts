import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { NodeCapabilities, GPUInfo, ProviderSummary, ModelCapability } from './types.js';

const execAsync = promisify(exec);

export class NodeCapabilityScanner {
  static async scan(
    getProviderStatuses?: () => Array<{ id: string; type: string; engine: string; available: boolean; models: Array<{ name: string }> }>,
    getModelMetadata?: (modelName: string) => { contextWindow: number; tags: string[] } | undefined
  ): Promise<NodeCapabilities> {
    const [gpus, providers, models] = await Promise.all([
      this.scanGPUs(),
      this.scanProviders(getProviderStatuses),
      this.scanModels(getProviderStatuses, getModelMetadata),
    ]);

    return {
      cpuCores: os.cpus().length,
      totalRAMBytes: os.totalmem(),
      availableRAMBytes: os.freemem(),
      gpus,
      providers,
      models,
      maxConcurrentTasks: this.calculateMaxConcurrency(os.freemem(), gpus),
      currentLoad: 0,
      platform: os.platform(),
      arch: os.arch(),
    };
  }

  private static async scanGPUs(): Promise<GPUInfo[]> {
    const gpus: GPUInfo[] = [];

    if (os.platform() === 'win32' || os.platform() === 'linux') {
      try {
        const { stdout } = await execAsync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', {
          timeout: 5000,
        });

        for (const line of stdout.trim().split('\n')) {
          if (!line.trim()) continue;
          const parts = line.split(',').map((s) => s.trim());
          const [name, memoryMB] = parts;
          if (name && memoryMB) {
            gpus.push({
              name,
              vendor: 'nvidia',
              memoryBytes: parseInt(memoryMB, 10) * 1024 * 1024,
              available: true,
              cudaVersion: await this.getCudaVersion(),
            });
          }
        }
      } catch {
        // No NVIDIA GPU or nvidia-smi not installed
      }
    }

    if (os.platform() === 'darwin' && os.arch() === 'arm64') {
      try {
        const memsize = os.cpus()[0]?.model || 'Apple Silicon';
        gpus.push({
          name: memsize,
          vendor: 'apple',
          memoryBytes: os.totalmem(),
          available: true,
        });
      } catch {
        // Fallback
      }
    }

    return gpus;
  }

  private static async scanProviders(
    getStatuses?: () => Array<{ id: string; type: string; engine: string; available: boolean }>
  ): Promise<ProviderSummary[]> {
    if (getStatuses) {
      const statuses = getStatuses();
      return statuses.map((s) => ({
        id: s.id,
        type: s.type,
        engine: s.engine,
        available: s.available,
      }));
    }

    return [];
  }

  private static async scanModels(
    getStatuses?: () => Array<{ id: string; available: boolean; models: Array<{ name: string }> }>,
    getMetadata?: (modelName: string) => { contextWindow: number; tags: string[] } | undefined
  ): Promise<ModelCapability[]> {
    const models: ModelCapability[] = [];

    if (getStatuses) {
      const statuses = getStatuses();

      for (const status of statuses) {
        if (!status.available) continue;

        for (const model of status.models) {
          const meta = getMetadata?.(model.name);
          models.push({
            modelId: model.name,
            provider: status.id,
            loaded: false,
            estimatedTokensPerSecond: undefined,
            maxContextLength: meta?.contextWindow,
            tags: meta?.tags,
          });
        }
      }
    }

    return models;
  }

  private static calculateMaxConcurrency(freeRAM: number, gpus: GPUInfo[]): number {
    const freeGB = freeRAM / (1024 * 1024 * 1024);

    let cpuSlots = Math.max(1, Math.floor(freeGB / 8));

    const gpuSlots = gpus.filter((g) => g.available).length;

    return Math.min(cpuSlots + gpuSlots, 8);
  }

  private static async getCudaVersion(): Promise<string | undefined> {
    try {
      const { stdout } = await execAsync('nvcc --version', { timeout: 3000 });
      const match = stdout.match(/release (\d+\.\d+)/);
      return match ? match[1] : undefined;
    } catch {
      return undefined;
    }
  }
}

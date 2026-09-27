import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { LayaModelAdapter, LayaRequest, LayaPlan } from './types.js';

export interface LayaProcessOptions {
  command: string;
  args?: string[];
  timeoutMs?: number;
  cwd?: string;
  environment?: Record<string, string>;
}

export class LayaProcessAdapter implements LayaModelAdapter {
  readonly id = 'laya-local';

  constructor(private readonly options: LayaProcessOptions) {
    if (!options.command) throw new Error('Laya command is required');
  }

  async load(): Promise<void> {
    await this.health();
  }

  async unload(): Promise<void> {
    // Laya is launched per inference; there is no resident process to unload.
  }

  async generate(request: LayaRequest): Promise<LayaPlan> {
    const payload = JSON.stringify(request);
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(this.options.command, this.options.args ?? [], {
        cwd: this.options.cwd,
        env: { ...process.env, ...(this.options.environment ?? {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });

      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const timer = setTimeout(() => {
        child.kill();
        finish(() => reject(new Error('Laya inference timed out')));
      }, this.options.timeoutMs ?? 120_000);

      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on('error', (error) => {
        clearTimeout(timer);
        finish(() => reject(error));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        finish(() => {
          if (code !== 0) reject(new Error(`Laya exited with code ${code}: ${stderr.slice(0, 500)}`));
          else resolve(stdout);
        });
      });

      child.stdin.write(payload);
      child.stdin.end();
    });

    const raw = JSON.parse(output) as LayaPlan;
    return {
      ...raw,
      planId: raw.planId || `laya_plan_${randomUUID()}`,
      missionId: request.missionId,
      parentTaskId: request.parentTaskId,
      objective: request.objective,
      tasks: raw.tasks ?? [],
      dependencies: raw.dependencies ?? [],
      assumptions: raw.assumptions ?? [],
      risks: raw.risks ?? [],
      createdAt: raw.createdAt ?? new Date().toISOString(),
    };
  }

  async health(): Promise<{ healthy: boolean; error?: string }> {
    return new Promise((resolve) => {
      const child = spawn(this.options.command, [...(this.options.args ?? []), '--health'], {
        cwd: this.options.cwd,
        env: { ...process.env, ...(this.options.environment ?? {}) },
        stdio: ['ignore', 'ignore', 'pipe'],
        shell: false,
      });
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        resolve({ healthy: false, error: 'Laya health check timed out' });
      }, Math.min(this.options.timeoutMs ?? 120_000, 10_000));
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on('error', (error) => {
        clearTimeout(timer);
        resolve({ healthy: false, error: error.message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code === 0 ? { healthy: true } : { healthy: false, error: stderr.slice(0, 500) || `exit ${code}` });
      });
    });
  }
}

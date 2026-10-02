import { spawn } from 'node:child_process';
import type { LayaDecisionAdapter, LayaPredictRequest, LayaPredictResponse } from './LayaDecisionTypes.js';
export interface LayaProcessDecisionOptions { command: string; args?: string[]; timeoutMs?: number; cwd?: string; environment?: Record<string, string>; }
export class LayaProcessDecisionAdapter implements LayaDecisionAdapter {
  readonly id = 'laya-local';
  constructor(private readonly options: LayaProcessDecisionOptions) { if (!options.command) throw new Error('Laya command is required'); }
  async predict(request: LayaPredictRequest): Promise<LayaPredictResponse> {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(this.options.command, this.options.args ?? [], { cwd: this.options.cwd, env: { ...process.env, ...(this.options.environment ?? {}) }, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
      let stdout = ''; let stderr = ''; let settled = false; const finish = (fn: () => void) => { if (settled) return; settled = true; fn(); };
      const timer = setTimeout(() => { child.kill(); finish(() => reject(new Error('Laya local inference timed out'))); }, this.options.timeoutMs ?? 120_000);
      child.stdout.on('data', chunk => { stdout += chunk.toString(); }); child.stderr.on('data', chunk => { stderr += chunk.toString(); });
      child.on('error', error => { clearTimeout(timer); finish(() => reject(error)); });
      child.on('close', code => { clearTimeout(timer); finish(() => code === 0 ? resolve(stdout) : reject(new Error('Laya exited with code ' + code + ': ' + stderr.slice(0, 500)))); });
      child.stdin.write(JSON.stringify(request)); child.stdin.end();
    });
    return JSON.parse(output) as LayaPredictResponse;
  }
  async health() { return { healthy: true }; }
}

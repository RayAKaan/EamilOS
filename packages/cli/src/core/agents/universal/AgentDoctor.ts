import { spawn } from 'node:child_process';
import { UniversalAgentRegistry } from './UniversalAgentRegistry.js';
import type { AgentDoctorOptions, AgentHealthResult, UniversalAgentDefinition } from './types.js';

function probe(executable: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/c', executable, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      : spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let settled = false;
    const finish = (value: { ok: boolean; detail: string }) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish({ ok: false, detail: 'probe timed out' }); }, timeoutMs);
    child.stdout?.on('data', (d: Buffer) => { output += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { output += d.toString(); });
    child.once('error', (e) => finish({ ok: false, detail: e.message }));
    child.once('close', (code) => finish({ ok: code === 0, detail: output.trim().split(/\r?\n/)[0] || `exit code ${code ?? 'unknown'}` }));
  });
}

export class AgentDoctor {
  constructor(private readonly registry: UniversalAgentRegistry) {}

  async check(id: string, options: AgentDoctorOptions = {}): Promise<AgentHealthResult> {
    const health = await this.registry.health(id, options.timeoutMs ?? 3000);
    if (options.deep && health.installed && health.executable) {
      const definition = this.registry.get(id) as UniversalAgentDefinition;
      const version = await probe(health.executable, definition.versionArgs.length ? definition.versionArgs : ['--version'], options.timeoutMs ?? 3000);
      health.checks.push({ name: 'version-probe', ok: version.ok, detail: version.detail });
      const help = await probe(health.executable, ['--help'], options.timeoutMs ?? 3000);
      health.checks.push({ name: 'help-probe', ok: help.ok, detail: help.detail });
      health.ready = health.checks.every((check) => check.ok);
    }
    return health;
  }

  async checkAll(options: AgentDoctorOptions = {}): Promise<AgentHealthResult[]> {
    return Promise.all(this.registry.list().map((agent) => this.check(agent.id, options)));
  }
}

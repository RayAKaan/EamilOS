import { spawn } from 'node:child_process';
import type { UniversalAgentDefinition, AgentDetectionResult, AgentHealthResult } from './types.js';
import { UNIVERSAL_AGENT_CATALOG } from './catalog.js';
import { UniversalAgentRuntime } from './AgentRuntime.js';

function commandExists(command: string, timeoutMs = 3000): Promise<{ ok: boolean; version?: string; error?: string }> {
  return new Promise((resolve) => {
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/c', command, '--version'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      : spawn(command, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let settled = false;
    const finish = (result: { ok: boolean; version?: string; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({ ok: false, error: 'timeout after ' + timeoutMs + 'ms' });
    }, timeoutMs);
    child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { err += d.toString(); });
    child.once('error', (e) => finish({ ok: false, error: e.message }));
    child.once('close', (code) => {
      if (code === 0) finish({ ok: true, version: (out || err).trim().split(/\r?\n/)[0] || 'installed' });
      else finish({ ok: false, error: err.trim() || 'exit code ' + (code ?? 'unknown') });
    });
  });
}

export class UniversalAgentRegistry {
  private definitions = new Map<string, UniversalAgentDefinition>();
  private detections = new Map<string, AgentDetectionResult>();

  constructor(definitions: UniversalAgentDefinition[] = UNIVERSAL_AGENT_CATALOG) {
    for (const definition of definitions) this.definitions.set(definition.id, definition);
  }

  list(): UniversalAgentDefinition[] { return [...this.definitions.values()]; }
  get(id: string): UniversalAgentDefinition | undefined { return this.definitions.get(id); }

  detectOne(id: string, timeoutMs = 3000): Promise<AgentDetectionResult> {
    const definition = this.get(id);
    if (!definition) return Promise.resolve({ id, installed: false, error: 'Unknown agent' });
    return (async () => {
      let lastError = 'not found';
      for (const executable of definition.executableCandidates) {
        const result = await commandExists(executable, timeoutMs);
        if (result.ok) {
          const detection = { id, installed: true, executable, version: result.version };
          this.detections.set(id, detection);
          return detection;
        }
        lastError = result.error ?? lastError;
      }
      const detection = { id, installed: false, error: lastError };
      this.detections.set(id, detection);
      return detection;
    })();
  }

  async detectAll(options: { timeoutMs?: number } = {}): Promise<AgentDetectionResult[]> {
    return Promise.all(this.list().map((agent) => this.detectOne(agent.id, options.timeoutMs ?? 3000)));
  }

  async health(id: string, timeoutMs = 3000): Promise<AgentHealthResult> {
    const definition = this.get(id);
    if (!definition) return { id, installed: false, authenticated: false, ready: false, checks: [{ name: 'definition', ok: false, detail: 'Unknown agent' }] };
    const detection = await this.detectOne(id, timeoutMs);
    const checks = [{ name: 'installed', ok: detection.installed, detail: detection.version ?? detection.error }];
    if (!detection.installed) return { ...detection, authenticated: false, ready: false, checks };
    checks.push({ name: 'protocol', ok: definition.protocols.length > 0, detail: definition.protocols.join(', ') });
    const authEnv = definition.authentication.environmentVariables ?? [];
    const hasEnvAuth = authEnv.length === 0 || authEnv.some((key) => Boolean(process.env[key]));
    checks.push({ name: 'authentication', ok: hasEnvAuth, detail: authEnv.length ? (hasEnvAuth ? 'credential detected' : 'credential not detected') : 'agent-managed' });
    const authenticated: boolean | 'unknown' = authEnv.length === 0 ? 'unknown' : hasEnvAuth;
    return { ...detection, authenticated, ready: detection.installed && authenticated !== false, checks };
  }

  getDetection(id: string): AgentDetectionResult | undefined { return this.detections.get(id); }
  getInstalled(): UniversalAgentDefinition[] { return this.list().filter((agent) => this.detections.get(agent.id)?.installed); }

  createRuntime(id: string, options: { workingDir: string; timeoutMs?: number }): UniversalAgentRuntime {
    const definition = this.get(id);
    if (!definition) throw new Error('Unknown agent: ' + id);
    return new UniversalAgentRuntime(definition, options);
  }
}

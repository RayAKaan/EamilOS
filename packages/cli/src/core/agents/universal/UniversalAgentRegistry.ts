import { spawn } from 'node:child_process';
import type { UniversalAgentDefinition, AgentDetectionResult, AgentHealthResult, UniversalCapabilities } from './types.js';
import { UNIVERSAL_AGENT_CATALOG } from './catalog.js';
import { UniversalAgentRuntime } from './AgentRuntime.js';
import { AuthenticationManager } from './AuthenticationManager.js';
import type { UniversalAgentEventBus } from './AgentEventBus.js';
import type { ExecutionStore } from './ExecutionStore.js';

function commandExists(command: string, args: string[], timeoutMs = 3000): Promise<{ ok: boolean; version?: string; error?: string }> {
  return new Promise((resolve) => {
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/c', command, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      : spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = ''; let settled = false;
    const finish = (result: { ok: boolean; version?: string; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish({ ok: false, error: 'timeout after ' + timeoutMs + 'ms' }); }, timeoutMs);
    child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { err += d.toString(); });
    child.once('error', (e) => finish({ ok: false, error: e.message }));
    child.once('close', (code) => finish(code === 0
      ? { ok: true, version: (out || err).trim().split(/\r?\n/)[0] || 'installed' }
      : { ok: false, error: err.trim() || 'exit code ' + (code ?? 'unknown') }));
  });
}

export class UniversalAgentRegistry {
  private definitions = new Map<string, UniversalAgentDefinition>();
  private detections = new Map<string, AgentDetectionResult>();
  private readonly auth = new AuthenticationManager();

  constructor(definitions: UniversalAgentDefinition[] = UNIVERSAL_AGENT_CATALOG) {
    for (const definition of definitions) this.definitions.set(definition.id, definition);
  }

  list(): UniversalAgentDefinition[] { return [...this.definitions.values()]; }
  get(id: string): UniversalAgentDefinition | undefined { return this.definitions.get(id); }

  async detectOne(id: string, timeoutMs = 3000): Promise<AgentDetectionResult> {
    const definition = this.get(id);
    if (!definition) return { id, installed: false, error: 'Unknown agent' };
    let lastError = 'not found';
    for (const executable of definition.executableCandidates) {
      const result = await commandExists(executable, definition.versionArgs.length ? definition.versionArgs : ['--version'], timeoutMs);
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
  }

  async detectAll(options: { timeoutMs?: number } = {}): Promise<AgentDetectionResult[]> {
    return Promise.all(this.list().map((agent) => this.detectOne(agent.id, options.timeoutMs ?? 3000)));
  }

  async health(id: string, timeoutMs = 3000): Promise<AgentHealthResult> {
    const definition = this.get(id);
    if (!definition) return { id, installed: false, authenticated: false, ready: false, checks: [{ name: 'definition', ok: false, detail: 'Unknown agent' }] };
    const detection = await this.detectOne(id, timeoutMs);
    const checks: AgentHealthResult['checks'] = [
      { name: 'platform', ok: definition.platforms.includes(process.platform), detail: process.platform },
      { name: 'installed', ok: detection.installed, detail: detection.version ?? detection.error },
    ];
    if (!detection.installed) return { ...detection, authenticated: false, ready: false, checks };
    checks.push({ name: 'protocol', ok: definition.protocols.length > 0, detail: definition.protocols.join(', ') });
    const auth = this.auth.inspect(definition);
    checks.push({ name: 'authentication', ok: auth.status !== 'missing', detail: auth.detail });
    const authenticated: boolean | 'unknown' = auth.status === 'authenticated' ? true : auth.status === 'missing' ? false : 'unknown';
    return { ...detection, authenticated, ready: detection.installed && checks.every((check) => check.ok), checks };
  }

  async healthAll(timeoutMs = 3000): Promise<AgentHealthResult[]> {
    return Promise.all(this.list().map((agent) => this.health(agent.id, timeoutMs)));
  }

  getDetection(id: string): AgentDetectionResult | undefined { return this.detections.get(id); }
  getInstalled(): UniversalAgentDefinition[] { return this.list().filter((agent) => this.detections.get(agent.id)?.installed); }

  getByCapabilities(requirements: Partial<Record<keyof UniversalCapabilities, boolean>>): UniversalAgentDefinition[] {
    return this.list().filter((agent) => Object.entries(requirements).every(([key, required]) => !required || agent.capabilities[key as keyof UniversalCapabilities]));
  }

  createRuntime(id: string, options: { workingDir: string; timeoutMs?: number; events?: UniversalAgentEventBus; store?: ExecutionStore }): UniversalAgentRuntime {
    const definition = this.get(id);
    if (!definition) throw new Error('Unknown agent: ' + id);
    return new UniversalAgentRuntime(definition, options);
  }
}

import { spawn } from 'child_process';
import { createConnection } from 'net';
import type { RegisteredAgent, AgentKind, AgentCapabilities, AgentMode, AgentStatus, ExecutionStrategy } from './types.js';

export interface AgentDetectionConfig {
  id: string;
  name: string;
  kind: AgentKind;
  provider: string;
  supportedModes: AgentMode[];
  priority: number;
  capabilities: AgentCapabilities;
  detect: () => Promise<{ available: boolean; version?: string; error?: string }>;
}

function runCommand(cmd: string, args: string[], timeoutMs: number = 3000): Promise<{ available: boolean; version?: string; error?: string }> {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const child = isWindows
      ? spawn('cmd.exe', ['/d', '/c', cmd, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      : spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let settled = false;
    let stdout = '';
    let stderr = '';

    const finish = (result: { available: boolean; version?: string; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({ available: false, error: `Detection timeout after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });
    child.once('error', (err) => finish({ available: false, error: err.message }));
    child.once('close', (code) => {
      if (code === 0) {
        const version = (stdout || stderr).trim().split(/\r?\n/)[0] || 'CLI';
        finish({ available: true, version });
      } else {
        finish({ available: false, error: stderr.trim() || `Exit code ${code ?? 'unknown'}` });
      }
    });
  });
}

async function runCommandCandidates(
  candidates: Array<{ cmd: string; args: string[] }>,
  timeoutMs = 2500,
): Promise<{ available: boolean; version?: string; error?: string }> {
  let lastError = 'not found';
  for (const candidate of candidates) {
    const result = await runCommand(candidate.cmd, candidate.args, timeoutMs);
    if (result.available) return result;
    lastError = result.error ?? lastError;
  }
  return { available: false, error: lastError };
}

function checkTcpPort(port: number, host: string = 'localhost', timeoutMs: number = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(port, host, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(timeoutMs, () => { socket.destroy(); resolve(false); });
  });
}

export class AgentRegistry {
  private agents: Map<string, RegisteredAgent> = new Map();
  private detectors: AgentDetectionConfig[] = [];
  private _isDetecting = false;
  private detectionPromise: Promise<AgentRegistry> | null = null;

  registerDetector(detector: AgentDetectionConfig): void {
    this.detectors.push(detector);
  }

  async detect(options?: { force?: boolean; timeoutMs?: number; onAgent?: (agent: RegisteredAgent) => void }): Promise<AgentRegistry> {
    if (this._isDetecting && !options?.force) return this.detectionPromise!;
    this._isDetecting = true;
    const timeoutMs = options?.timeoutMs ?? 30000;

    this.detectionPromise = (async () => {
      try {
        const work = this.detectors.map(async (d) => {
          const status = await Promise.race([
            d.detect(),
            new Promise<{ available: boolean; error?: string }>(resolve =>
              setTimeout(() => resolve({ available: false, error: `Detection timeout after ${timeoutMs}ms` }), timeoutMs)
            ),
          ]);
          const agent: RegisteredAgent = {
            id: d.id,
            name: d.name,
            kind: d.kind,
            provider: d.provider,
            status: status.available ? 'available' : 'not_installed',
            version: status.version,
            capabilities: d.capabilities,
            supportedModes: d.supportedModes,
            priority: d.priority,
            error: status.error,
          };
          this.agents.set(agent.id, agent);
          options?.onAgent?.(agent);
          return agent;
        });
        await Promise.allSettled(work);
      } finally {
        this._isDetecting = false;
      }
      return this;
    })();

    return this.detectionPromise;
  }

  getSnapshot(): RegisteredAgent[] {
    return Array.from(this.agents.values());
  }

  isDetecting(): boolean {
    return this._isDetecting;
  }

  async refresh(): Promise<AgentRegistry> {
    this.agents.clear();
    return this.detect({ force: true });
  }

  async detectWithOptions(options?: { force?: boolean; timeoutMs?: number }): Promise<AgentRegistry> {
    return this.detect(options);
  }

  getAvailableAgents(mode?: AgentMode): RegisteredAgent[] {
    const available = Array.from(this.agents.values())
      .filter(a => a.status === 'available');
    if (mode) {
      return available.filter(a => a.supportedModes.includes(mode));
    }
    return available;
  }

  getAgent(id: string): RegisteredAgent | undefined {
    return this.agents.get(id);
  }

  getAllAgents(): RegisteredAgent[] {
    return Array.from(this.agents.values());
  }

  getBestAgent(mode?: AgentMode, preferId?: string): RegisteredAgent | null {
    const available = this.getAvailableAgents(mode).sort((a, b) => a.priority - b.priority);

    if (preferId) {
      const preferred = available.find(a => a.id === preferId);
      if (preferred) return preferred;
    }

    return available[0] ?? null;
  }

  getAgentInfoMap(): Record<string, { status: string; version?: string; error?: string }> {
    const map: Record<string, { status: string; version?: string; error?: string }> = {};
    for (const [id, agent] of this.agents) {
      map[id] = {
        status: agent.status === 'available' ? 'ready' : 'offline',
        version: agent.version,
        error: agent.error,
      };
    }
    return map;
  }

  suggestStrategy(goal: string): ExecutionStrategy {
    const lower = goal.toLowerCase();
    const isSimple = lower.length < 100;
    const isResearch = /\b(analyze|research|explain|find|search|what is|how does|compare)\b/i.test(goal);
    const isComplex = /\b(build|create|implement|full|complete|system|platform|framework)\b/i.test(goal);

    if (isSimple && !isComplex) return 'single';
    if (isResearch && !isComplex) return 'single';
    if (isComplex) return 'fallback';
    return 'fallback';
  }

  static async detect(): Promise<AgentRegistry> {
    const registry = new AgentRegistry();
    registry.registerBuiltinDetectors();
    return registry.detect();
  }

  static create(): AgentRegistry {
    const registry = new AgentRegistry();
    registry.registerBuiltinDetectors();
    return registry;
  }

  private registerBuiltinDetectors(): void {
    this.registerDetector({
      id: 'opencode',
      name: 'OpenCode AI',
      kind: 'cli',
      provider: 'opencode',
      supportedModes: ['communication', 'execution'],
      priority: 1,
      capabilities: { codeGeneration: true, fileEditing: true, commandExecution: true, webResearch: true, longContext: true, local: true, cloud: true, multimodal: false },
      detect: async () => {
        const result = await runCommandCandidates([{ cmd: 'opencode', args: ['--version'] }, { cmd: 'npx', args: ['--no-install', 'opencode-ai', '--version'] }]);
        if (!result.available) {
          result.error = 'opencode-ai not installed. Run: npm install -g opencode-ai';
        }
        return result;
      },
    });

    this.registerDetector({
      id: 'claude-code',
      name: 'Claude Code',
      kind: 'cli',
      provider: 'anthropic',
      supportedModes: ['communication', 'execution'],
      priority: 2,
      capabilities: { codeGeneration: true, fileEditing: true, commandExecution: true, webResearch: true, longContext: true, local: false, cloud: true, multimodal: false },
      detect: async () => {
        const result = await runCommandCandidates([{ cmd: 'claude', args: ['--version'] }, { cmd: 'npx', args: ['--no-install', '@anthropic-ai/claude-code', '--version'] }]);
        if (!result.available) {
          result.error = '@anthropic-ai/claude-code not installed';
        }
        return result;
      },
    });

    this.registerDetector({
      id: 'gemini-cli',
      name: 'Gemini CLI',
      kind: 'cli',
      provider: 'google',
      supportedModes: ['communication', 'execution'],
      priority: 3,
      capabilities: { codeGeneration: false, fileEditing: false, commandExecution: true, webResearch: true, longContext: true, local: false, cloud: true, multimodal: true },
      detect: async () => {
        const result = await runCommandCandidates([{ cmd: 'gemini', args: ['--version'] }, { cmd: 'npx', args: ['--no-install', '@google/gemini-cli', '--version'] }]);
        if (!result.available) {
          result.error = '@google/gemini-cli not installed';
        }
        return result;
      },
    });

    this.registerDetector({
      id: 'aider',
      name: 'Aider',
      kind: 'cli',
      provider: 'aider',
      supportedModes: ['communication', 'execution'],
      priority: 4,
      capabilities: { codeGeneration: true, fileEditing: true, commandExecution: true, webResearch: false, longContext: false, local: true, cloud: false, multimodal: false },
      detect: async () => {
        const result = await runCommandCandidates([{ cmd: 'aider', args: ['--version'] }]);
        if (!result.available) {
          result.error = 'aider not installed. Run: pip install aider-chat';
        }
        return result;
      },
    });

    this.registerDetector({
      id: 'goose',
      name: 'Goose',
      kind: 'cli',
      provider: 'block',
      supportedModes: ['communication', 'execution'],
      priority: 5,
      capabilities: { codeGeneration: true, fileEditing: true, commandExecution: true, webResearch: false, longContext: false, local: true, cloud: false, multimodal: false },
      detect: async () => {
        let result = await runCommandCandidates([{ cmd: 'goose', args: ['--version'] }, { cmd: 'npx', args: ['--no-install', '@block/goose', '--version'] }]);
        if (!result.available) {
          result = await runCommand('goose', ['--version'], 2500);
        }
        if (!result.available) {
          result.error = 'goose not installed';
        }
        return result;
      },
    });

    this.registerDetector({
      id: 'codex-cli',
      name: 'Codex CLI',
      kind: 'cli',
      provider: 'openai',
      supportedModes: ['communication', 'execution'],
      priority: 3,
      capabilities: { codeGeneration: true, fileEditing: true, commandExecution: true, webResearch: false, longContext: true, local: true, cloud: false, multimodal: false },
      detect: async () => {
        const result = await runCommandCandidates([{ cmd: 'codex', args: ['--version'] }]);
        if (!result.available) {
          result.error = 'codex not installed. Run: npm install -g @openai/codex';
        }
        return result;
      },
    });

    this.registerDetector({
      id: 'ollama',
      name: 'Ollama (Local)',
      kind: 'local',
      provider: 'ollama',
      supportedModes: ['communication'],
      priority: 6,
      capabilities: { codeGeneration: true, fileEditing: false, commandExecution: false, webResearch: false, longContext: true, local: true, cloud: false, multimodal: false },
      detect: async () => {
        try {
          const open = await checkTcpPort(11434);
          return open ? { available: true, version: 'running' } : { available: false, error: 'Ollama not running on port 11434' };
        } catch {
          return { available: false, error: 'Ollama check failed' };
        }
      },
    });

    this.registerDetector({
      id: 'openai-api',
      name: 'OpenAI API',
      kind: 'api',
      provider: 'openai',
      supportedModes: ['communication'],
      priority: 7,
      capabilities: { codeGeneration: true, fileEditing: false, commandExecution: false, webResearch: false, longContext: true, local: false, cloud: true, multimodal: true },
      detect: async () => {
        const key = process.env.OPENAI_API_KEY;
        return key
          ? { available: true, version: 'api' }
          : { available: false, error: 'OPENAI_API_KEY not set' };
      },
    });

    this.registerDetector({
      id: 'anthropic-api',
      name: 'Anthropic API',
      kind: 'api',
      provider: 'anthropic',
      supportedModes: ['communication'],
      priority: 8,
      capabilities: { codeGeneration: true, fileEditing: false, commandExecution: false, webResearch: false, longContext: true, local: false, cloud: true, multimodal: false },
      detect: async () => {
        const key = process.env.ANTHROPIC_API_KEY;
        return key
          ? { available: true, version: 'api' }
          : { available: false, error: 'ANTHROPIC_API_KEY not set' };
      },
    });
  }
}
import { execSync } from 'child_process';
import { createConnection } from 'net';
import type { RegisteredAgent, AgentKind, AgentCapabilities, AgentMode, AgentStatus, ExecutionStrategy } from './types.js';

interface AgentDetectionConfig {
  id: string;
  name: string;
  kind: AgentKind;
  provider: string;
  supportedModes: AgentMode[];
  priority: number;
  capabilities: AgentCapabilities;
  detect: () => Promise<{ available: boolean; version?: string; error?: string }>;
}

export class AgentRegistry {
  private agents: Map<string, RegisteredAgent> = new Map();
  private detectors: AgentDetectionConfig[] = [];

  registerDetector(detector: AgentDetectionConfig): void {
    this.detectors.push(detector);
  }

  async detect(): Promise<AgentRegistry> {
    const results = await Promise.allSettled(
      this.detectors.map(async (d) => {
        const status = await d.detect();
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
        return agent;
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const agent = result.value;
        this.agents.set(agent.id, agent);
      }
    }

    return this;
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
        try {
          execSync('npx --no-install opencode-ai --version', { timeout: 10000, stdio: 'pipe', windowsHide: true });
          return { available: true, version: 'CLI' };
        } catch {
          return { available: false, error: 'opencode-ai not installed. Run: npm install -g opencode-ai' };
        }
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
        try {
          execSync('npx --no-install @anthropic-ai/claude-code --version', { timeout: 10000, stdio: 'pipe', windowsHide: true });
          return { available: true, version: 'CLI' };
        } catch {
          return { available: false, error: '@anthropic-ai/claude-code not installed' };
        }
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
        try {
          execSync('npx --no-install @google/gemini-cli --version', { timeout: 10000, stdio: 'pipe', windowsHide: true });
          return { available: true, version: 'CLI' };
        } catch {
          return { available: false, error: '@google/gemini-cli not installed' };
        }
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
        try {
          execSync('aider --version', { timeout: 10000, stdio: 'pipe', windowsHide: true });
          return { available: true, version: 'CLI' };
        } catch {
          return { available: false, error: 'aider not installed. Run: pip install aider-chat' };
        }
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
        try {
          execSync('npx --no-install @block/goose --version', { timeout: 10000, stdio: 'pipe', windowsHide: true });
          return { available: true, version: 'CLI' };
        } catch {
          try {
            execSync('goose --version', { timeout: 10000, stdio: 'pipe', windowsHide: true });
            return { available: true, version: 'CLI' };
          } catch {
            return { available: false, error: 'goose not installed' };
          }
        }
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
        try {
          execSync('codex --version', { timeout: 10000, stdio: 'pipe', windowsHide: true });
          return { available: true, version: 'CLI' };
        } catch {
          return { available: false, error: 'codex not installed. Run: npm install -g @openai/codex' };
        }
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
          const open = await new Promise<boolean>((resolve) => {
            const socket = createConnection(11434, 'localhost', () => {
              socket.destroy();
              resolve(true);
            });
            socket.on('error', () => resolve(false));
            socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
          });
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

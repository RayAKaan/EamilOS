import { execSync } from 'child_process';
import { createConnection } from 'net';

export interface ProviderStatus {
  id: string;
  name: string;
  available: boolean;
  reason?: string;
  priority: number;
}

function commandExists(command: string): boolean {
  try {
    const isWindows = process.platform === 'win32';
    let result: Buffer;
    
    if (isWindows) {
      result = execSync(`where ${command}`, { stdio: 'pipe' });
    } else {
      result = execSync(`which ${command}`, { stdio: 'pipe' });
    }
    return result.length > 0;
  } catch {
    return false;
  }
}

function isPortOpen(port: number, host = 'localhost'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(port, host, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export async function detectAllProviders(): Promise<ProviderStatus[]> {
  const providers: ProviderStatus[] = [];

  // 1. Claude CLI
  const claudeExists = commandExists('claude');
  providers.push({
    id: 'claude-cli',
    name: 'Claude CLI',
    available: claudeExists,
    reason: claudeExists ? undefined : 'not installed',
    priority: 2,
  });

  // 1b. OpenCode CLI (highest priority)
  const opencodeExists = commandExists('opencode');
  providers.push({
    id: 'opencode-cli',
    name: 'OpenCode CLI',
    available: opencodeExists,
    reason: opencodeExists ? undefined : 'not installed',
    priority: 1,
  });

  // 2. Codex CLI  
  const codexExists = commandExists('codex');
  providers.push({
    id: 'codex-cli',
    name: 'CodeX CLI',
    available: codexExists,
    reason: codexExists ? undefined : 'not installed',
    priority: 4,
  });

  // 3. Ollama (local)
  const ollamaRunning = await isPortOpen(11434);
  providers.push({
    id: 'ollama',
    name: 'Ollama',
    available: ollamaRunning,
    reason: ollamaRunning ? undefined : 'not running',
    priority: 2,
  });

  // 4. OpenAI API
  const openaiKey = process.env.OPENAI_API_KEY;
  providers.push({
    id: 'openai-api',
    name: 'OpenAI API',
    available: !!openaiKey,
    reason: openaiKey ? undefined : 'missing API key',
    priority: 3,
  });

  // 5. Anthropic API
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  providers.push({
    id: 'anthropic-api',
    name: 'Anthropic API',
    available: !!anthropicKey,
    reason: anthropicKey ? undefined : 'missing API key',
    priority: 3,
  });

  return providers;
}

export function selectBestProvider(providers: ProviderStatus[]): ProviderStatus | null {
  const available = providers.filter(p => p.available).sort((a, b) => a.priority - b.priority);
  return available[0] || null;
}

export function formatProviders(providers: ProviderStatus[]): string {
  const lines: string[] = ['Detected providers:', ''];
  
  for (const p of providers) {
    if (p.available) {
      lines.push(`✅ ${p.name}`);
    } else {
      lines.push(`❌ ${p.name} (${p.reason})`);
    }
  }
  
  return lines.join('\n');
}
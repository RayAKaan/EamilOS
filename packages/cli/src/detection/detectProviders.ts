import { execSync } from 'child_process';
import { createConnection } from 'net';

export interface ProviderStatus {
  id: string;
  name: string;
  available: boolean;
  reason?: string;
  priority: number;
  installCommand?: string;
}

function commandExists(command: string): boolean {
  try {
    const isWindows = process.platform === 'win32';
    
    if (isWindows) {
      execSync(`where ${command}`, { stdio: 'pipe' });
      execSync(`${command} --version`, { stdio: 'pipe', shell: true } as any);
    } else {
      execSync(`which ${command}`, { stdio: 'pipe' });
      execSync(`${command} --version`, { stdio: 'pipe' });
    }
    return true;
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

export async function installProvider(providerId: string): Promise<boolean> {
  const installCommands: Record<string, string> = {
    'claude-cli': 'npm install -g @anthropic-ai/claude-code',
    'opencode-cli': 'npm install -g opencode-ai',
    'codex-cli': 'npm install -g @openai/codex',
  };
  
  const installCmds: Record<string, string> = {
    'claude-cli': 'claude',
    'opencode-cli': 'opencode',
    'codex-cli': 'codex',
  };
  
  const cmd = installCommands[providerId];
  const binaryCmd = installCmds[providerId];
  
  if (!cmd || !binaryCmd) {
    return false;
  }
  
  try {
    execSync(`${binaryCmd} --version`, { stdio: 'pipe', shell: true } as any);
    return true;
  } catch {
    console.log(`Installing ${providerId}...`);
    try {
      execSync(cmd, { stdio: 'inherit', shell: true } as any);
      return true;
    } catch {
      return false;
    }
  }
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
    installCommand: 'npm install -g @anthropic-ai/claude-cli',
  });

  // 1b. OpenCode CLI (highest priority)
  const opencodeExists = commandExists('opencode');
  providers.push({
    id: 'opencode-cli',
    name: 'OpenCode CLI',
    available: opencodeExists,
    reason: opencodeExists ? undefined : 'not installed',
    priority: 1,
    installCommand: 'npm install -g opencode-ai',
  });

  // 2. Codex CLI  
  const codexExists = commandExists('codex');
  providers.push({
    id: 'codex-cli',
    name: 'CodeX CLI',
    available: codexExists,
    reason: codexExists ? undefined : 'not installed',
    priority: 4,
    installCommand: 'npm install -g @anthropic-ai/codex-cli',
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

export async function detectAndAutoInstall(): Promise<ProviderStatus[]> {
  const providers = await detectAllProviders();
  const missing = providers.filter(p => !p.available && p.installCommand);
  
  for (const provider of missing) {
    if (provider.installCommand) {
      console.log(`\n${provider.name} not found. Installing...`);
      const success = await installProvider(provider.id);
      if (success) {
        provider.available = true;
        provider.reason = undefined;
        console.log(`✅ ${provider.name} installed successfully!`);
      } else {
        console.log(`❌ Failed to install ${provider.name}`);
      }
    }
  }
  
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
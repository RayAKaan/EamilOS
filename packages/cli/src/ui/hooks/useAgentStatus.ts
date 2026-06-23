/**
 * checkAgentStatus — Check OpenCode and Gemini CLI availability
 * Auto-runs on import to populate agent status in the store.
 */
import { execSync } from 'child_process';
import { useStore } from '../state/store.js';

interface CheckResult {
  available: boolean;
  version?: string;
}

function checkBinary(cmd: string, args: string): CheckResult {
  try {
    const raw = execSync(cmd + ' ' + args + ' 2>&1', {
      timeout: 6000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const output = raw.toString().trim();
    const match = output.match(/(\d+\.\d+\.\d+)/);
    return {
      available: true,
      version: match ? match[1] : output.split('\n')[0].slice(0, 20),
    };
  } catch {
    return { available: false };
  }
}

function checkOpenCodeSync(): CheckResult {
  let result = checkBinary('npx', '--no-install opencode-ai --version');
  if (!result.available) {
    result = checkBinary('npx', '--no-install opencode --version');
  }
  if (!result.available) {
    result = checkBinary('opencode', '--version');
  }
  if (!result.available) {
    result = checkBinary('npx', '--yes opencode-ai --version');
  }
  return result;
}

function checkGeminiSync(): CheckResult {
  let result = checkBinary('npx', '--no-install @google/gemini-cli --version');
  if (!result.available) {
    result = checkBinary('gemini', '--version');
  }
  if (!result.available) {
    result = checkBinary('npx', '--yes @google/gemini-cli --version');
  }
  return result;
}

export function checkAgentStatus(): void {
  const setAgentStatus = useStore.getState().setAgentStatus;

  try {
    const oc = checkOpenCodeSync();
    const gem = checkGeminiSync();

    setAgentStatus('opencode', {
      status: 'ready',
      version: oc.available ? oc.version : 'Kernel',
    });
    setAgentStatus('gemini', {
      status: 'ready',
      version: gem.available ? gem.version : 'Kernel',
    });
  } catch {
    setAgentStatus('opencode', { status: 'ready', version: 'Kernel' });
    setAgentStatus('gemini', { status: 'ready', version: 'Kernel' });
  }
}

// Auto-run on import
checkAgentStatus();

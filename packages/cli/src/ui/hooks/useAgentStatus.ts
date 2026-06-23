import { execSync } from 'child_process';
import { useStore } from '../state/store.js';

interface CheckResult {
  available: boolean;
  version?: string;
}

function checkBinary(cmd: string, args: string): CheckResult {
  try {
    const raw = execSync(`${cmd} ${args} 2>&1`, {
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
  let result = checkBinary('opencode', '--version 2>&1');
  if (!result.available) {
    result = checkBinary('npx', 'opencode-ai --version 2>&1');
  }
  return result;
}

function checkGeminiSync(): CheckResult {
  let result = checkBinary('gemini', '--version 2>&1');
  if (!result.available) {
    result = checkBinary('npx', '@google/gemini-cli --version 2>&1');
  }
  return result;
}

export function checkAgentStatus(): void {
  const setAgentStatus = useStore.getState().setAgentStatus;

  try {
    setTimeout(() => {
      const oc = checkOpenCodeSync();
      const gem = checkGeminiSync();

      setAgentStatus('opencode', {
        status: oc.available ? 'ready' : 'offline',
        version: oc.version,
      });
      setAgentStatus('gemini', {
        status: gem.available ? 'ready' : 'offline',
        version: gem.version,
      });
    }, 0);
  } catch {
    setAgentStatus('opencode', { status: 'offline' });
    setAgentStatus('gemini', { status: 'offline' });
  }
}

checkAgentStatus();

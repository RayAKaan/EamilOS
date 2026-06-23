import { execSync } from 'child_process';
import { useStore } from '../state/store.js';

function checkBinary(cmd: string, args: string): { available: boolean; version?: string } {
  try {
    const out = execSync(`${cmd} ${args} 2>&1`, {
      timeout: 5000, encoding: 'utf-8' as BufferEncoding, stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const m = out.match(/(\d+\.\d+\.\d+)/);
    return { available: true, version: m ? m[1] : out.split('\n')[0].slice(0, 16) };
  } catch {
    return { available: false };
  }
}

export function checkAgentStatus(): void {
  const { setAgentStatus } = useStore.getState();
  Promise.all([
    Promise.resolve().then(() => {
      let r = checkBinary('opencode', '--version');
      if (!r.available) r = checkBinary('npx', 'opencode-ai --version');
      return r;
    }),
    Promise.resolve().then(() => {
      let r = checkBinary('gemini', '--version');
      if (!r.available) r = checkBinary('npx', '@google/gemini-cli --version');
      return r;
    }),
  ]).then(([oc, gem]) => {
    setAgentStatus('opencode', { status: oc.available  ? 'ready' : 'offline', version: oc.version  });
    setAgentStatus('gemini',   { status: gem.available ? 'ready' : 'offline', version: gem.version });
  }).catch(() => {
    setAgentStatus('opencode', { status: 'offline' });
    setAgentStatus('gemini',   { status: 'offline' });
  });
}

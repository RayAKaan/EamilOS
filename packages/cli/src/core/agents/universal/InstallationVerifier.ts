import { spawn } from 'node:child_process';
import type { UniversalAgentDefinition, AgentDetectionResult } from './types.js';

function probe(command: string, args: string[], timeoutMs: number): Promise<AgentDetectionResult> {
  return new Promise((resolve) => {
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/c', command, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      : spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let done = false;
    const finish = (value: AgentDetectionResult) => { if (done) return; done = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish({ id: command, installed: false, error: 'verification timeout' }); }, timeoutMs);
    child.stdout?.on('data', d => { output += d.toString(); });
    child.stderr?.on('data', d => { output += d.toString(); });
    child.once('error', e => finish({ id: command, installed: false, error: e.message }));
    child.once('close', code => finish({ id: command, installed: code === 0, version: output.trim().split(/\r?\n/)[0] || undefined, error: code === 0 ? undefined : output.trim() || 'verification failed' }));
  });
}

export class InstallationVerifier {
  async verify(definition: UniversalAgentDefinition, executable?: string, timeoutMs = 5000): Promise<AgentDetectionResult> {
    const command = executable ?? definition.executableCandidates[0];
    if (!command) return { id: definition.id, installed: false, error: 'No executable candidate configured' };
    return probe(command, definition.versionArgs.length ? definition.versionArgs : ['--version'], timeoutMs);
  }
}

import { spawn } from 'node:child_process';
import type { AgentInstallationResult, UniversalAgentDefinition } from './types.js';

function run(command: string, args: string[] = [], timeoutMs = 120000): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/c', command, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      : spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout?.on('data', (d: Buffer) => { output += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { output += d.toString(); });
    const timer = setTimeout(() => { try { child.kill(); } catch {} reject(new Error(`installation timeout after ${timeoutMs}ms`)); }, timeoutMs);
    child.once('error', (e) => { clearTimeout(timer); reject(e); });
    child.once('close', (code) => { clearTimeout(timer); resolve({ code, output: output.trim() }); });
  });
}

export class AgentInstaller {
  async install(definition: UniversalAgentDefinition): Promise<AgentInstallationResult> {
    const spec = definition.installation;
    if (spec.strategy === 'existing' || spec.strategy === 'manual' || spec.strategy === 'provider') {
      return { id: definition.id, success: false, changed: false, message: spec.notes ?? 'This agent requires provider-specific/manual installation.' };
    }

    if (spec.strategy === 'npm') {
      const packageName = spec.package;
      if (!packageName) return { id: definition.id, success: false, changed: false, message: 'npm package is not configured.' };
      const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const args = ['install', '-g', packageName];
      const result = await run(command, args);
      return { id: definition.id, success: result.code === 0, changed: result.code === 0, message: result.output || (result.code === 0 ? 'installed' : 'installation failed'), command: `${command} ${args.join(' ')}` };
    }

    if (spec.strategy === 'pip') {
      if (!spec.package) return { id: definition.id, success: false, changed: false, message: 'Python package is not configured.' };
      const result = await run(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'pip', 'install', spec.package]);
      return { id: definition.id, success: result.code === 0, changed: result.code === 0, message: result.output || (result.code === 0 ? 'installed' : 'installation failed'), command: `python -m pip install ${spec.package}` };
    }

    if (spec.strategy === 'uv') {
      if (!spec.package) return { id: definition.id, success: false, changed: false, message: 'uv package is not configured.' };
      const result = await run(process.platform === 'win32' ? 'uv.exe' : 'uv', ['tool', 'install', spec.package]);
      return { id: definition.id, success: result.code === 0, changed: result.code === 0, message: result.output || (result.code === 0 ? 'installed' : 'installation failed'), command: `uv tool install ${spec.package}` };
    }

    if (spec.strategy === 'brew') {
      if (process.platform !== 'darwin') return { id: definition.id, success: false, changed: false, message: 'Homebrew installation is only supported on macOS in this installer.' };
      if (!spec.package) return { id: definition.id, success: false, changed: false, message: 'brew package is not configured.' };
      const result = await run('brew', ['install', spec.package]);
      return { id: definition.id, success: result.code === 0, changed: result.code === 0, message: result.output || (result.code === 0 ? 'installed' : 'installation failed'), command: `brew install ${spec.package}` };
    }

    if (spec.strategy === 'binary') {
      return { id: definition.id, success: false, changed: false, message: spec.notes ?? 'Binary installation requires a verified platform release.' };
    }

    if (spec.strategy === 'script') {
      return { id: definition.id, success: false, changed: false, message: 'Official installer must be explicitly reviewed and approved before EamilOS executes it.' };
    }

    return { id: definition.id, success: false, changed: false, message: `Unsupported installation strategy: ${spec.strategy}` };
  }
}

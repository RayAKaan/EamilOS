import { spawn } from 'node:child_process';
import type { AgentInstallationResult, AgentInstallOptions, AgentRemovalResult, UniversalAgentDefinition } from './types.js';

function run(command: string, args: string[] = [], timeoutMs = 120000): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/c', command, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      : spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let settled = false;
    const finish = (value: { code: number | null; output: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    child.stdout?.on('data', (d: Buffer) => { output += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { output += d.toString(); });
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      if (!settled) { settled = true; reject(new Error(`command timeout after ${timeoutMs}ms`)); }
    }, timeoutMs);
    child.once('error', (e) => { clearTimeout(timer); reject(e); });
    child.once('close', (code) => finish({ code, output: output.trim() }));
  });
}

function toolCommand(strategy: string): string {
  if (strategy === 'npm') return process.platform === 'win32' ? 'npm.cmd' : 'npm';
  if (strategy === 'pip') return process.platform === 'win32' ? 'python' : 'python3';
  if (strategy === 'uv') return process.platform === 'win32' ? 'uv.exe' : 'uv';
  return strategy;
}

export class AgentInstaller {
  async install(definition: UniversalAgentDefinition, options: AgentInstallOptions = {}): Promise<AgentInstallationResult> {
    const spec = definition.installation;
    if (options.dryRun) {
      return { id: definition.id, success: true, changed: false, skipped: true, message: this.plan(definition), reason: 'dry-run' };
    }
    if (spec.strategy === 'existing') return { id: definition.id, success: true, changed: false, skipped: true, message: 'Uses an existing executable on PATH.' };
    if (spec.strategy === 'manual' || spec.strategy === 'provider') {
      return { id: definition.id, success: false, changed: false, message: spec.notes ?? 'Provider-specific/manual installation is required.' };
    }

    if (spec.strategy === 'npm') {
      if (!spec.package) return this.invalid(definition, 'npm package is not configured');
      const command = toolCommand('npm');
      const args = ['install', '-g', spec.package];
      return this.execute(definition, command, args, options.timeoutMs, options.force ? 'npm install -g' : 'npm install -g');
    }
    if (spec.strategy === 'pip') {
      if (!spec.package) return this.invalid(definition, 'Python package is not configured');
      const command = toolCommand('pip');
      const args = ['-m', 'pip', 'install', spec.package];
      return this.execute(definition, command, args, options.timeoutMs);
    }
    if (spec.strategy === 'uv') {
      if (!spec.package) return this.invalid(definition, 'uv package is not configured');
      const command = toolCommand('uv');
      const args = ['tool', 'install', spec.package];
      return this.execute(definition, command, args, options.timeoutMs);
    }
    if (spec.strategy === 'brew') {
      if (process.platform !== 'darwin') return { id: definition.id, success: false, changed: false, message: 'Homebrew installation is only supported on macOS.' };
      if (!spec.package) return this.invalid(definition, 'brew package is not configured');
      return this.execute(definition, 'brew', ['install', spec.package], options.timeoutMs);
    }
    if (spec.strategy === 'binary') {
      return { id: definition.id, success: false, changed: false, message: spec.notes ?? 'No verified binary manifest is configured for this agent.' };
    }
    if (spec.strategy === 'script') {
      return { id: definition.id, success: false, changed: false, message: 'Arbitrary remote scripts are never executed automatically. Use the official installer manually, then run eamilos agents doctor.' };
    }
    return this.invalid(definition, `unsupported installation strategy: ${spec.strategy}`);
  }

  async remove(definition: UniversalAgentDefinition, timeoutMs = 120000): Promise<AgentRemovalResult> {
    const spec = definition.installation;
    if (!spec.package) return { id: definition.id, success: false, changed: false, message: 'No package identifier is configured; removal is manual.' };
    if (spec.strategy === 'npm') {
      const command = toolCommand('npm');
      const args = ['uninstall', '-g', spec.package];
      const result = await run(command, args, timeoutMs);
      return { id: definition.id, success: result.code === 0, changed: result.code === 0, message: result.output || (result.code === 0 ? 'removed' : 'removal failed'), command: `${command} ${args.join(' ')}` };
    }
    if (spec.strategy === 'pip') {
      const command = toolCommand('pip');
      const args = ['-m', 'pip', 'uninstall', '-y', spec.package];
      const result = await run(command, args, timeoutMs);
      return { id: definition.id, success: result.code === 0, changed: result.code === 0, message: result.output || (result.code === 0 ? 'removed' : 'removal failed'), command: `${command} ${args.join(' ')}` };
    }
    if (spec.strategy === 'uv') {
      const command = toolCommand('uv');
      const args = ['tool', 'uninstall', spec.package];
      const result = await run(command, args, timeoutMs);
      return { id: definition.id, success: result.code === 0, changed: result.code === 0, message: result.output || (result.code === 0 ? 'removed' : 'removal failed'), command: `${command} ${args.join(' ')}` };
    }
    if (spec.strategy === 'brew') {
      if (process.platform !== 'darwin') return { id: definition.id, success: false, changed: false, message: 'Homebrew removal is only supported on macOS.' };
      const result = await run('brew', ['uninstall', spec.package], timeoutMs);
      return { id: definition.id, success: result.code === 0, changed: result.code === 0, message: result.output || (result.code === 0 ? 'removed' : 'removal failed'), command: `brew uninstall ${spec.package}` };
    }
    return { id: definition.id, success: false, changed: false, message: 'Removal is not automated for this installation strategy.' };
  }

  plan(definition: UniversalAgentDefinition): string {
    const spec = definition.installation;
    if (spec.command) return spec.command;
    if (spec.strategy === 'npm' && spec.package) return `npm install -g ${spec.package}`;
    if (spec.strategy === 'pip' && spec.package) return `python -m pip install ${spec.package}`;
    if (spec.strategy === 'uv' && spec.package) return `uv tool install ${spec.package}`;
    if (spec.strategy === 'brew' && spec.package) return `brew install ${spec.package}`;
    return spec.notes ?? 'Manual/provider installation required';
  }

  private invalid(definition: UniversalAgentDefinition, message: string): AgentInstallationResult {
    return { id: definition.id, success: false, changed: false, message };
  }

  private async execute(definition: UniversalAgentDefinition, command: string, args: string[], timeoutMs = 120000, _label?: string): Promise<AgentInstallationResult> {
    try {
      const result = await run(command, args, timeoutMs);
      return {
        id: definition.id,
        success: result.code === 0,
        changed: result.code === 0,
        message: result.output || (result.code === 0 ? 'installed successfully' : `installation failed with exit code ${result.code ?? 'unknown'}`),
        command: `${command} ${args.join(' ')}`,
      };
    } catch (error) {
      return { id: definition.id, success: false, changed: false, message: error instanceof Error ? error.message : String(error), command: `${command} ${args.join(' ')}` };
    }
  }
}

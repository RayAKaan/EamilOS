import { spawn } from 'node:child_process';
import type { AgentInstallationResult, AgentInstallOptions, AgentRemovalResult, UniversalAgentDefinition } from './types.js';
import { InstallationPlanner } from './InstallationPlanner.js';
import { InstallationVerifier } from './InstallationVerifier.js';
import { GitHubReleaseInstaller } from './GitHubReleaseInstaller.js';

function run(command: string, args: string[] = [], timeoutMs = 120000): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/c', command, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      : spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let settled = false;
    const finish = (value: { code: number | null; output: string }) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => { try { child.kill(); } catch {} if (!settled) { settled = true; reject(new Error(`command timeout after ${timeoutMs}ms`)); } }, timeoutMs);
    child.stdout?.on('data', d => { output += d.toString(); });
    child.stderr?.on('data', d => { output += d.toString(); });
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('close', code => finish({ code, output: output.trim() }));
  });
}

export class AgentInstaller {
  readonly planner = new InstallationPlanner();
  readonly verifier = new InstallationVerifier();
  readonly releases = new GitHubReleaseInstaller();

  plan(definition: UniversalAgentDefinition): string {
    const plan = this.planner.plan(definition);
    if (plan.commands.length) return plan.commands.map(command => [command.executable.replace(/\.cmd$/i, ''), ...command.args].join(' ')).join(' && ');
    return plan.manualAction ?? definition.installation.notes ?? 'Manual/provider installation required';
  }

  async install(definition: UniversalAgentDefinition, options: AgentInstallOptions = {}): Promise<AgentInstallationResult> {
    const plan = this.planner.plan(definition, options);
    if (options.dryRun) return { id: definition.id, success: plan.supported || plan.manualAction !== undefined, changed: false, skipped: true, message: this.plan(definition), reason: 'dry-run' };
    if (!plan.platformSupported) return { id: definition.id, success: false, changed: false, message: plan.manualAction ?? 'Unsupported platform' };

    if (definition.installation.strategy === 'existing') {
      const verification = await this.verifier.verify(definition, definition.installation.executable, options.timeoutMs ?? 5000);
      return { id: definition.id, success: verification.installed, changed: false, message: verification.installed ? 'Executable is already installed.' : verification.error ?? 'Executable not found.' };
    }

    if (definition.installation.strategy === 'github-release' || definition.installation.strategy === 'binary') {
      const result = await this.releases.install(definition, options.timeoutMs ?? 120000);
      if (!result.success) return { id: definition.id, success: false, changed: false, message: result.message };
      const verification = await this.verifier.verify(definition, result.executable, options.timeoutMs ?? 5000);
      return { id: definition.id, success: verification.installed, changed: verification.installed, message: verification.installed ? result.message : verification.error ?? 'Post-install verification failed.', command: this.plan(definition) };
    }

    if (!plan.supported) return { id: definition.id, success: false, changed: false, message: plan.manualAction ?? 'No safe automated installer is configured.' };

    const command = plan.commands[0];
    if (!command) return { id: definition.id, success: false, changed: false, message: 'Installation plan contains no executable command.' };
    try {
      const result = await run(command.executable, command.args, options.timeoutMs ?? 120000);
      if (result.code !== 0) return { id: definition.id, success: false, changed: false, message: result.output || `installation failed with exit code ${result.code ?? 'unknown'}`, command: [command.executable, ...command.args].join(' ') };
      const verification = await this.verifier.verify(definition, definition.installation.executable, options.timeoutMs ?? 5000);
      return { id: definition.id, success: verification.installed, changed: true, message: verification.installed ? result.output || 'installed and verified' : verification.error ?? 'installed but verification failed', command: [command.executable, ...command.args].join(' ') };
    } catch (error) {
      return { id: definition.id, success: false, changed: false, message: error instanceof Error ? error.message : String(error), command: [command.executable, ...command.args].join(' ') };
    }
  }

  async remove(definition: UniversalAgentDefinition, timeoutMs = 120000): Promise<AgentRemovalResult> {
    const spec = definition.installation;
    if (spec.strategy === 'npm' && spec.package) return this.removeCommand(definition, process.platform === 'win32' ? 'npm.cmd' : 'npm', ['uninstall', '-g', spec.package], timeoutMs);
    if (spec.strategy === 'pip' && spec.package) return this.removeCommand(definition, process.platform === 'win32' ? 'python' : 'python3', ['-m', 'pip', 'uninstall', '-y', spec.package], timeoutMs);
    if (spec.strategy === 'uv' && spec.package) return this.removeCommand(definition, process.platform === 'win32' ? 'uv.exe' : 'uv', ['tool', 'uninstall', spec.package], timeoutMs);
    if (spec.strategy === 'brew' && spec.package && (process.platform === 'darwin' || process.platform === 'linux')) return this.removeCommand(definition, 'brew', ['uninstall', spec.package], timeoutMs);
    return { id: definition.id, success: false, changed: false, message: 'Removal is not automated for this installation strategy.' };
  }

  private async removeCommand(definition: UniversalAgentDefinition, executable: string, args: string[], timeoutMs: number): Promise<AgentRemovalResult> {
    try {
      const result = await run(executable, args, timeoutMs);
      return { id: definition.id, success: result.code === 0, changed: result.code === 0, message: result.output || (result.code === 0 ? 'removed' : 'removal failed'), command: [executable, ...args].join(' ') };
    } catch (error) {
      return { id: definition.id, success: false, changed: false, message: error instanceof Error ? error.message : String(error), command: [executable, ...args].join(' ') };
    }
  }
}

import type { UniversalAgentDefinition, AgentInstallOptions } from './types.js';

export interface InstallationPlan {
  agentId: string;
  strategy: string;
  supported: boolean;
  platformSupported: boolean;
  prerequisites: string[];
  commands: Array<{ executable: string; args: string[] }>;
  manualAction?: string;
}

const executableFor = (name: string) => process.platform === 'win32' && name === 'npm' ? 'npm.cmd' : name;

export class InstallationPlanner {
  plan(definition: UniversalAgentDefinition, _options: AgentInstallOptions = {}): InstallationPlan {
    const spec = definition.installation;
    const commands: InstallationPlan['commands'] = [];
    const prerequisites = [...(spec.requires ?? [])];
    let supported = true;
    let manualAction: string | undefined;

    if (!definition.platforms.includes(process.platform)) {
      return { agentId: definition.id, strategy: spec.strategy, supported: false, platformSupported: false, prerequisites, commands, manualAction: 'Agent does not support this platform.' };
    }

    switch (spec.strategy) {
      case 'existing':
        manualAction = 'Ensure the executable is available on PATH.';
        break;
      case 'npm':
        if (!spec.package) { supported = false; break; }
        prerequisites.push('node', 'npm');
        commands.push({ executable: executableFor('npm'), args: ['install', '-g', spec.package] });
        break;
      case 'pip':
        if (!spec.package) { supported = false; break; }
        prerequisites.push('python3');
        commands.push({ executable: process.platform === 'win32' ? 'python' : 'python3', args: ['-m', 'pip', 'install', spec.package] });
        break;
      case 'uv':
        if (!spec.package) { supported = false; break; }
        prerequisites.push('uv');
        commands.push({ executable: executableFor('uv'), args: ['tool', 'install', spec.package] });
        break;
      case 'brew':
        if (process.platform !== 'darwin' && process.platform !== 'linux') { supported = false; break; }
        if (!spec.package) { supported = false; break; }
        prerequisites.push('brew');
        commands.push({ executable: 'brew', args: ['install', spec.package] });
        break;
      case 'binary':
      case 'github-release':
        supported = Boolean(spec.release);
        prerequisites.push('curl');
        manualAction = supported ? undefined : (spec.notes ?? 'No verified release manifest is configured.');
        break;
      case 'script':
        supported = false;
        manualAction = 'Run the official installer manually. Remote scripts are never executed automatically.';
        break;
      case 'provider':
      case 'manual':
        supported = false;
        manualAction = spec.notes ?? 'Use the upstream installation/authentication flow.';
        break;
      default:
        supported = false;
    }

    return { agentId: definition.id, strategy: spec.strategy, supported, platformSupported: true, prerequisites, commands, manualAction };
  }
}

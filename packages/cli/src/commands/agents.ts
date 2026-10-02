import { Command } from 'commander';
import chalk from 'chalk';
import { nanoid } from 'nanoid';
import { AgentDoctor, AgentInstaller, getUniversalAgentPlatform, UniversalAgentRegistry } from '../core/agents/universal/index.js';

const registry = new UniversalAgentRegistry();

function printAgent(agent: ReturnType<UniversalAgentRegistry['list']>[number], verbose = false): void {
  const detection = registry.getDetection(agent.id);
  const marker = detection?.installed ? chalk.green('✓') : chalk.gray('○');
  console.log(marker + ' ' + chalk.cyan(agent.name) + ' ' + chalk.gray('(' + agent.id + ')'));
  console.log('  Provider: ' + agent.provider + ' | Kind: ' + agent.kind + ' | Integration: ' + agent.integrationStatus);
  console.log('  Install: ' + agent.installation.strategy + ' | Protocols: ' + agent.protocols.join(', '));
  if (verbose) {
    console.log('  Capabilities: ' + Object.entries(agent.capabilities).filter(([, enabled]) => enabled).map(([key]) => key).join(', '));
    console.log('  Platforms: ' + agent.platforms.join(', '));
    if (agent.installation.package) console.log('  Package: ' + agent.installation.package);
    if (agent.installation.command) console.log('  Command: ' + agent.installation.command);
    if (agent.upstreamUrl) console.log('  Upstream: ' + agent.upstreamUrl);
  }
}

export function registerAgentsCommand(program: Command): void {
  const command = program.command('agents').description('Manage the EamilOS universal agent fleet');

  command.command('list').description('List all 35 universal worker definitions')
    .option('-v, --verbose', 'Show capabilities and installation details')
    .option('--json', 'Output JSON')
    .action(async (options: { verbose?: boolean; json?: boolean }) => {
      const detections = await registry.detectAll();
      if (options.json) {
        console.log(JSON.stringify(registry.list().map((agent) => ({ ...agent, detection: detections.find((item) => item.id === agent.id) })), null, 2));
        return;
      }
      console.log(chalk.bold('\nEamilOS Universal Agent Fleet\n'));
      for (const agent of registry.list()) printAgent(agent, options.verbose);
      console.log(chalk.bold('\nTotal: ' + registry.list().length + ' agents'));
    });

  command.command('info <agentId>').description('Show one agent definition').action(async (agentId: string) => {
    const agent = registry.get(agentId);
    if (!agent) throw new Error('Unknown agent: ' + agentId);
    await registry.detectOne(agentId);
    printAgent(agent, true);
  });

  command.command('plan <agentId>').description('Show the exact installation plan without executing it').action((agentId: string) => {
    const agent = registry.get(agentId);
    if (!agent) throw new Error('Unknown agent: ' + agentId);
    console.log(getUniversalAgentPlatform().installer.plan(agent));
  });

  command.command('install <agentId>').description('Install an agent using its declared safe package-manager strategy')
    .option('--dry-run', 'Print the installation plan only')
    .action(async (agentId: string, options: { dryRun?: boolean }) => {
      const agent = registry.get(agentId);
      if (!agent) throw new Error('Unknown agent: ' + agentId);
      const result = await getUniversalAgentPlatform().installer.install(agent, { dryRun: options.dryRun });
      console.log((result.success ? chalk.green('✓ ') : chalk.yellow('⚠ ')) + result.message);
      if (result.command) console.log(chalk.gray('  ' + result.command));
      if (!result.success && !result.skipped) process.exitCode = 1;
    });

  command.command('remove <agentId>').description('Remove an agent installed by a supported package manager').action(async (agentId: string) => {
    const agent = registry.get(agentId);
    if (!agent) throw new Error('Unknown agent: ' + agentId);
    const result = await getUniversalAgentPlatform().installer.remove(agent);
    console.log((result.success ? chalk.green('✓ ') : chalk.yellow('⚠ ')) + result.message);
    if (result.command) console.log(chalk.gray('  ' + result.command));
    if (!result.success) process.exitCode = 1;
  });

  command.command('doctor [agentId]').description('Check installation, authentication and runtime readiness')
    .option('--deep', 'Run real version and help probes')
    .option('--json', 'Output JSON')
    .action(async (agentId: string | undefined, options: { deep?: boolean; json?: boolean }) => {
      const doctor = new AgentDoctor(registry);
      const results = agentId ? [await doctor.check(agentId, options)] : await doctor.checkAll(options);
      if (options.json) { console.log(JSON.stringify(results, null, 2)); return; }
      console.log(chalk.bold('\nEamilOS Agent Doctor\n'));
      for (const result of results) {
        const failed = result.checks.find((check) => !check.ok);
        const marker = result.ready ? chalk.green('✓') : result.installed ? chalk.yellow('⚠') : chalk.gray('○');
        console.log(marker + ' ' + result.id + ': ' + (result.ready ? 'ready' : failed?.detail ?? result.error ?? 'not ready'));
        if (options.deep) for (const check of result.checks) console.log('  ' + (check.ok ? '✓' : '✗') + ' ' + check.name + ': ' + (check.detail ?? ''));
      }
    });

  command.command('auth <agentId>').description('Inspect authentication without printing secrets').action(async (agentId: string) => {
    const agent = registry.get(agentId);
    if (!agent) throw new Error('Unknown agent: ' + agentId);
    const result = getUniversalAgentPlatform().auth.inspect(agent);
    console.log(result.status + ': ' + result.detail);
    if (result.loginCommand) console.log('  Native login: ' + [result.loginCommand.executable, ...result.loginCommand.args].join(' '));
    if (result.checkedEnvironmentVariables.length) console.log('  Environment: ' + result.checkedEnvironmentVariables.join(', '));
    if (result.checkedConfigFiles.length) console.log('  Config paths checked: ' + result.checkedConfigFiles.join(', '));
  });

  command.command('run <agentId> <prompt...>').description('Execute a prompt through the universal runtime')
    .option('--cwd <dir>', 'Working directory', process.cwd())
    .option('--timeout <ms>', 'Execution timeout', '180000')
    .action(async (agentId: string, prompt: string[], options: { cwd: string; timeout: string }) => {
      const agent = registry.get(agentId);
      if (!agent) throw new Error('Unknown agent: ' + agentId);
      const platform = getUniversalAgentPlatform();
      await platform.initialize();
      const response = await platform.scheduler.execute({
        request: {
          id: nanoid(12), sessionId: nanoid(12), prompt: prompt.join(' '), systemPrompt: '',
          mode: 'execution', workingDir: options.cwd, timeoutMs: Number(options.timeout),
          onOutput: (chunk: string) => process.stdout.write(chunk),
        },
        preferredAgentId: agentId,
        strictAgentId: true,
      });
      if (!response.response.success) process.exitCode = 1;
    });

  command.command('install-all').description('Install all agents that have safe automated package-manager installers')
    .option('--dry-run', 'Only print plans')
    .action(async (options: { dryRun?: boolean }) => {
      const installer = getUniversalAgentPlatform().installer;
      let failed = 0;
      for (const agent of registry.list()) {
        const result = await installer.install(agent, { dryRun: options.dryRun });
        console.log((result.success ? chalk.green('✓') : chalk.yellow('⚠')) + ' ' + agent.name + ': ' + result.message);
        if (!result.success && !result.skipped && ['npm', 'pip', 'uv', 'brew'].includes(agent.installation.strategy)) failed++;
      }
      if (failed) process.exitCode = 1;
    });
}

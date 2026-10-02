import { Command } from 'commander';
import chalk from 'chalk';
import { AgentDoctor, AgentInstaller, UniversalAgentRegistry } from '../core/agents/universal/index.js';

const registry = new UniversalAgentRegistry();

function printAgent(agent: ReturnType<UniversalAgentRegistry['list']>[number], verbose = false): void {
  const status = registry.getDetection(agent.id);
  const marker = status?.installed ? chalk.green('✓') : chalk.gray('○');
  console.log(marker + ' ' + chalk.cyan(agent.name) + ' ' + chalk.gray('(' + agent.id + ')'));
  console.log('  Provider: ' + agent.provider + ' | Kind: ' + agent.kind + ' | Integration: ' + agent.integrationStatus);
  console.log('  Install: ' + agent.installation.strategy);
  console.log('  Protocols: ' + agent.protocols.join(', '));
  if (verbose) {
    const enabled = Object.entries(agent.capabilities).filter((entry) => entry[1]).map((entry) => entry[0]);
    console.log('  Capabilities: ' + enabled.join(', '));
    if (agent.installation.package) console.log('  Package: ' + agent.installation.package);
    if (agent.installation.command) console.log('  Command: ' + agent.installation.command);
    if (agent.upstreamUrl) console.log('  Upstream: ' + agent.upstreamUrl);
  }
}

export function registerAgentsCommand(program: Command): void {
  const command = program.command('agents').description('Manage the EamilOS universal agent fleet');

  command.command('list')
    .description('List the complete agent catalog')
    .option('-v, --verbose', 'Show capabilities and installation details')
    .action(async (options: { verbose?: boolean }) => {
      await registry.detectAll();
      console.log(chalk.bold('\n🤖 EamilOS Agent Fleet\n'));
      for (const agent of registry.list()) printAgent(agent, options.verbose);
      console.log(chalk.bold('\nTotal: ' + registry.list().length + ' agents'));
    });

  command.command('info <agentId>')
    .description('Show details for one agent')
    .option('-v, --verbose', 'Show full capabilities')
    .action(async (agentId: string) => {
      const agent = registry.get(agentId);
      if (!agent) throw new Error('Unknown agent: ' + agentId);
      await registry.detectOne(agentId);
      printAgent(agent, true);
    });

  command.command('doctor [agentId]')
    .description('Check installation, authentication and runtime readiness')
    .option('--deep', 'Run deeper readiness checks')
    .action(async (agentId: string | undefined, options: { deep?: boolean }) => {
      const doctor = new AgentDoctor(registry);
      const results = agentId
        ? [await doctor.check(agentId, { deep: options.deep })]
        : await doctor.checkAll({ deep: options.deep });
      console.log(chalk.bold('\n🩺 Agent Doctor\n'));
      for (const result of results) {
        const failed = result.checks.find((check) => !check.ok);
        const marker = result.ready ? chalk.green('✓') : result.installed ? chalk.yellow('⚠') : chalk.gray('○');
        console.log(marker + ' ' + result.id + ': ' + (result.ready ? 'ready' : failed?.detail ?? result.error ?? 'not ready'));
        if (options.deep) {
          for (const check of result.checks) console.log('  ' + (check.ok ? '✓' : '✗') + ' ' + check.name + ': ' + (check.detail ?? ''));
        }
      }
    });

  command.command('install <agentId>')
    .description('Install an agent using its declared installation strategy')
    .action(async (agentId: string) => {
      const agent = registry.get(agentId);
      if (!agent) throw new Error('Unknown agent: ' + agentId);
      const installer = new AgentInstaller();
      const result = await installer.install(agent);
      console.log((result.success ? chalk.green('✓ ') : chalk.yellow('⚠ ')) + result.message);
      if (result.command) console.log(chalk.gray('  ' + result.command));
      if (!result.success) process.exitCode = 1;
    });

  command.command('install-all')
    .description('Install all agents that have a safe automated installer')
    .action(async () => {
      const installer = new AgentInstaller();
      let failed = 0;
      for (const agent of registry.list()) {
        const result = await installer.install(agent);
        console.log((result.success ? chalk.green('✓') : chalk.yellow('⚠')) + ' ' + agent.name + ': ' + result.message);
        if (!result.success && ['npm', 'pip', 'uv', 'brew'].includes(agent.installation.strategy)) failed++;
      }
      if (failed > 0) process.exitCode = 1;
    });

  command.action(async (options: { verbose?: boolean }) => {
    await registry.detectAll();
    console.log(chalk.bold('\n🤖 EamilOS Agent Fleet\n'));
    for (const agent of registry.list()) printAgent(agent, options.verbose);
    console.log(chalk.bold('\nTotal: ' + registry.list().length + ' agents'));
  });
}


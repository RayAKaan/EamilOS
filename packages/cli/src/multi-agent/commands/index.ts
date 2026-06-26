import { Command } from 'commander';
import { SwarmOrchestrator } from '../orchestrator/SwarmOrchestrator.js';
import { AgentRegistry } from '../../core/agents/AgentRegistry.js';
import { detectEnvironment, canMultiplex } from '../multiplexer.js';
import {
  getAdaptiveMultiplexer,
  getConstraintEnforcer,
  type AgentTerminalDef,
} from '../../terminal/index.js';
import type { AgentMode } from '../../core/agents/types.js';
import chalk from 'chalk';
import ora from 'ora';
import { execSync } from 'child_process';

type StrategyOption = 'single' | 'fallback' | 'swarm' | 'manual';

function normalizeStrategy(raw: string): StrategyOption {
  if (raw === 'swarm') return 'swarm';
  if (raw === 'single' || raw === 'manual') return raw;
  return 'fallback';
}

export function createMultiAgentCommands(): Command {
  const command = new Command('multi')
    .description('Multi-agent orchestration')
    .alias('ma');

  command
    .command('run <task>')
    .description('Run a task using multi-agent orchestration')
    .option('--strategy <strategy>', 'Execution strategy: single|fallback|swarm|manual', 'fallback')
    .option('--mode <mode>', 'Agent mode: execution|communication', 'execution')
    .option('--working-dir <path>', 'Working directory', process.cwd())
    .option('--timeout <ms>', 'Timeout per agent in milliseconds', '180000')
    .option('--agent <id>', 'Preferred agent ID')
    .option('--split', 'Spawn physical OS terminal split panes')
    .option('--multiplex', 'Alias for --split')
    .action(async (task, options) => {
      const useSplit = options.split || options.multiplex;

      if (useSplit) {
        const terminalEnv = detectEnvironment();
        if (canMultiplex()) {
          console.log(chalk.cyan(`\n  🖥️  Split Terminal Mode Detected: ${terminalEnv}\n`));
        } else {
          console.log(chalk.yellow('\n  ⚠️  --split flag ignored: Terminal does not support multiplexing.\n'));
        }
      }

      const spinner = ora('Initializing agents...').start();

      const registry = AgentRegistry.create();
      await registry.detect();
      const available = registry.getAvailableAgents();

      if (available.length === 0) {
        spinner.fail('No agents found. Install one: npm install -g opencode-ai');
        process.exit(1);
      }

      spinner.succeed(`Agents ready: ${available.map(a => a.name).join(', ')}`);

      const orchestrator = new SwarmOrchestrator({
        goal: task,
        projectId: `cli_${Date.now()}`,
        strategy: normalizeStrategy(options.strategy),
        mode: (options.mode as AgentMode) || 'execution',
        workingDir: options.workingDir,
        timeoutMs: parseInt(options.timeout),
        preferredAgent: options.agent,
      });

      spinner.start(`Executing task (strategy: ${options.strategy})...`);

      try {
        const result = await orchestrator.execute(task);

        spinner.stop();

        console.log(chalk.bold('\n━━━ Execution Results ━━━\n'));

        console.log(`Strategy: ${chalk.cyan(result.strategy)}`);
        console.log(`Mode: ${chalk.cyan(result.mode)}`);
        console.log(`Agent used: ${chalk.cyan(result.agentUsed || 'unknown')}`);
        console.log(`Duration: ${(result.duration / 1000).toFixed(1)}s`);

        if (result.fileChanges.length > 0) {
          console.log(chalk.bold('\n📁 File changes:'));
          for (const file of result.fileChanges) {
            console.log(`  ${chalk.green('✓')} ${file.path}`);
          }
        }

        if (result.errors.length > 0) {
          console.log(chalk.bold('\n⚠️ Errors:'));
          for (const error of result.errors.slice(0, 5)) {
            console.log(`  - ${error.slice(0, 100)}`);
          }
        }

        if (result.primaryResult) {
          console.log(chalk.bold('\n📤 Output:'));
          console.log(result.primaryResult.slice(0, 3000));
        }
      } catch (err) {
        spinner.fail(`Execution failed: ${(err as Error).message}`);
        process.exit(1);
      }

      await orchestrator.terminate();
    });

  command
    .command('doctor')
    .description('Check agent availability and system health')
    .action(async () => {
      const registry = AgentRegistry.create();
      const spinner = ora('Checking system...').start();
      await registry.detect();
      const available = registry.getAvailableAgents();
      spinner.stop();

      console.log(chalk.bold('\n━━━ Multi-Agent System Health ━━━\n'));

      for (const agent of available) {
        console.log(chalk.green(`  ✅ ${agent.name}`));
        if (agent.version) console.log(`     Version: ${agent.version}`);
      }

      const missing = ['opencode', 'claude-code', 'gemini-cli', 'aider', 'goose']
        .filter(id => !available.find(a => a.id === id));

      if (missing.length > 0) {
        console.log(chalk.bold('\n❌ Not found:'));
        for (const id of missing) {
          console.log(`  ${id}`);
        }
        console.log(chalk.gray('\nRun "eamilos multi install" to install\n'));
      }

      console.log(chalk.bold('\n━━━ Authentication ━━━\n'));
      console.log('  OpenAI:    OPENAI_API_KEY');
      console.log('  Anthropic: ANTHROPIC_API_KEY');
      console.log('  Google:    GOOGLE_API_KEY\n');
    });

  command
    .command('install [packages...]')
    .description('Install CLI agents')
    .option('--check-only', 'Only check installation status', false)
    .action(async (packages, options) => {
      const installMap: Record<string, string> = {
        'opencode': 'npm install -g opencode-ai',
        'claude-code': 'npm install -g @anthropic-ai/claude-code',
        'aider': 'pip install aider-chat',
        'goose': 'npm install -g @block/goose',
        'gemini-cli': 'npm install -g @google/gemini-cli',
      };

      if (options.checkOnly) {
        const registry = AgentRegistry.create();
        await registry.detect();
        const available = registry.getAvailableAgents();
        console.log(chalk.bold('\n━━━ Installation Status ━━━\n'));
        for (const [id, name] of Object.entries(installMap)) {
          const found = available.find(a => a.id === id);
          console.log(`  ${id}: ${found ? chalk.green('✅') : chalk.red('❌')}`);
        }
        return;
      }

      const toInstall = packages.length > 0 ? packages : ['opencode'];
      const spinner = ora('Installing...').start();

      for (const pkg of toInstall) {
        const cmd = installMap[pkg];
        if (!cmd) {
          console.log(chalk.yellow(`Unknown package: ${pkg}`));
          continue;
        }
        spinner.text = `Installing ${pkg}...`;
        try {
          execSync(cmd, { stdio: 'inherit', timeout: 120000 });
        } catch {
          console.log(chalk.red(`  ❌ Failed to install ${pkg}`));
        }
      }
      spinner.succeed('Installation complete');
    });

  return command;
}

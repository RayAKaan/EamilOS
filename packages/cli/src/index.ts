#!/usr/bin/env node

import { Command } from 'commander';
import { initEamilOS, formatError as humanizeError } from './core/index.js';
import { init } from './commands/init.js';
import { run } from './commands/run.js';
import { status } from './commands/status.js';
import { list } from './commands/list.js';
import { helpCommand } from './commands/help.js';
import { versionCommand } from './commands/version.js';
import { doctorCommand } from './commands/doctor.js';
import { validateCommand } from './commands/validate.js';
import { welcomeCommand, markFirstRunComplete } from './commands/welcome.js';
import { setupCommand } from './commands/setup.js';
import { pluginsCommand } from './commands/plugins.js';
import { helloCommand } from './commands/hello.js';
import { hiCommand } from './commands/hi.js';
import { createMultiAgentCommands } from './multi-agent/index.js';
import { detectAndAutoInstall, selectBestProvider } from './detection/detectProviders.js';
import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '../package.json');
const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
const EAMILOS_VERSION = pkg.version || '1.0.0';

const program = new Command();

async function detectAndShowProviders(): Promise<void> {
  const { default: chalk } = await import('chalk');
  
  try {
    const providers = await detectAndAutoInstall();
    const best = selectBestProvider(providers);
    
    // Show detection results
    console.log('\n' + chalk.cyan('Detected providers:'));
    console.log('');
    
    for (const p of providers) {
      if (p.available) {
        console.log(chalk.green('✅') + ` ${p.name}`);
      } else {
        console.log(chalk.red('❌') + ` ${p.name} (${p.reason})`);
      }
    }
    
    console.log('');
    
    if (best) {
      console.log(chalk.green('✔') + ` Using ${best.name}`);
      console.log(chalk.dim('Run: eamilos run "your task"'));
    } else {
      console.log(chalk.yellow('⚠') + ' No AI providers found.');
      console.log(chalk.dim('\nTo get started:'));
      console.log('  npm install -g @anthropic-ai/claude-cli');
      console.log('  OR');
      console.log('  https://ollama.ai');
    }
    
    console.log('');
  } catch {
    // Silent fail - don't block UI launch
  }
}

async function launchUI(args: string[]) {
  const { spawn } = await import('child_process');
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  
  // Run provider detection before launching UI
  await detectAndShowProviders();
  
  const __filename = fileURLToPath(import.meta.url);
  const cliUiPath = path.resolve(path.dirname(__filename), 'eamilos-ui.js');
  const rootDir = process.cwd();
  spawn('node', [cliUiPath, ...args], { stdio: 'inherit', cwd: rootDir });
}

program
  .name('eamilos')
  .description('EamilOS — AI Execution Kernel')
  .version(EAMILOS_VERSION)
  .action(async () => {
    await launchUI(process.argv.slice(2));
  });

program
  .command('init')
  .description('Initialize EamilOS configuration')
  .action(async () => {
    try {
      await init();
    } catch (error) {
      handleFatalError(error);
    }
  });

program
  .command('welcome')
  .description('Show welcome message and auto-setup')
  .option('--skip', 'Skip auto-setup', false)
  .action(async (options) => {
    try {
      await welcomeCommand({ skip: options.skip });
      if (!options.skip) {
        await markFirstRunComplete();
      }
    } catch (error) {
      handleFatalError(error);
    }
  });

program
  .command('setup')
  .description('Interactive guided setup wizard')
  .option('--provider <name>', 'Provider to use (ollama, openai, anthropic)')
  .option('--model <name>', 'Model to use')
  .option('--force', 'Overwrite existing configuration', false)
  .action(async (options) => {
    try {
      await setupCommand({
        provider: options.provider,
        model: options.model,
        force: options.force === true,
      });
    } catch (error) {
      handleFatalError(error);
    }
  });

program
  .command('doctor')
  .description('Diagnose system health and fix issues')
  .option('--fix', 'Attempt auto-repairs', false)
  .option('--verbose', 'Show detailed output', false)
  .action(async (options) => {
    try {
      await doctorCommand({ fix: options.fix, verbose: options.verbose });
    } catch (error) {
      handleFatalError(error);
    }
  });

program
  .command('ui')
  .description('Launch interactive TUI (or --cli for text mode)')
  .option('--cli', 'Use text CLI instead of rich TUI', false)
  .action(async (options) => {
    try {
      if (options.cli) {
        console.log('Use "eamilos run <goal>" for CLI mode');
        return;
      }
      const { spawn } = await import('child_process');
      const path = await import('path');
      const { fileURLToPath } = await import('url');
      const __filename = fileURLToPath(import.meta.url);
      const cliUiPath = path.resolve(path.dirname(__filename), 'eamilos-ui.js');
      spawn('node', [cliUiPath], { stdio: 'inherit' });
    } catch (error) {
      handleFatalError(error);
    }
  });

program
  .command('validate')
  .description('Validate configuration file')
  .option('--config <path>', 'Path to config file')
  .option('--verbose', 'Show detailed output', false)
  .action(async (options) => {
    try {
      await validateCommand({ config: options.config, verbose: options.verbose });
    } catch (error) {
      handleFatalError(error);
    }
  });

program
  .command('run <goal>')
  .description('Run a new project with the given goal')
  .option('-t, --template <template>', 'Project template to use')
  .option('-c, --constraints <constraints...>', 'Additional constraints')
  .option('-b, --budget <budget>', 'Budget limit in USD', (val) => parseFloat(val))
  .option('--model <name>', 'Override model selection')
  .option('--provider <name>', 'Override provider')
  .option('--output <dir>', 'Output directory')
  .option('--debug', 'Show detailed output')
  .option('--ephemeral', 'Run without writing config to disk')
  .action(async (goal: string, options) => {
    try {
      const eamilos = await initEamilOS();
      await run(eamilos, goal, options);
    } catch (error) {
      handleFatalError(error, options.debug === true);
    }
  });

program
  .command('benchmark')
  .description('Test and rank available models')
  .option('--model <name>', 'Test specific model')
  .option('--verbose', 'Show detailed output')
  .option('--output <file>', 'Save results to file')
  .action(async (options) => {
    try {
      const { benchmarkCommand } = await import('./core/index.js');
      await benchmarkCommand({
        model: options.model,
        verbose: options.verbose,
        output: options.output,
      });
    } catch (error) {
      handleFatalError(error, options.verbose === true);
    }
  });

const pluginsCmd = program
  .command('plugins')
  .description('Manage plugins');

pluginsCmd
  .command('list')
  .description('List installed plugins')
  .action(async () => {
    try {
      await pluginsCommand('list', {});
    } catch (error) {
      handleFatalError(error);
    }
  });

pluginsCmd
  .command('install <source>')
  .description('Install a plugin from path or URL')
  .action(async (source: string) => {
    try {
      await pluginsCommand('install', { source });
    } catch (error) {
      handleFatalError(error);
    }
  });

pluginsCmd
  .command('remove <pluginId>')
  .description('Remove an installed plugin')
  .action(async (pluginId: string) => {
    try {
      await pluginsCommand('remove', { pluginId });
    } catch (error) {
      handleFatalError(error);
    }
  });

pluginsCmd
  .command('info <pluginId>')
  .description('Show plugin details')
  .action(async (pluginId: string) => {
    try {
      await pluginsCommand('info', { pluginId });
    } catch (error) {
      handleFatalError(error);
    }
  });

pluginsCmd
  .command('health')
  .description('Check plugin health status')
  .action(async () => {
    try {
      await pluginsCommand('health', {});
    } catch (error) {
      handleFatalError(error);
    }
  });

program
  .command('status [project]')
  .description('Show project status')
  .action(async (projectId?: string) => {
    try {
      const eamilos = await initEamilOS();
      await status(eamilos, projectId);
      eamilos.shutdown();
      process.exit(0);
    } catch (error) {
      handleFatalError(error);
    }
  });

program
  .command('list')
  .description('List all projects')
  .action(async () => {
    try {
      const eamilos = await initEamilOS();
      await list(eamilos);
      eamilos.shutdown();
      process.exit(0);
    } catch (error) {
      handleFatalError(error);
    }
  });

program
  .command('pause <project>')
  .description('Pause a project')
  .action(async (projectId: string) => {
    try {
      const eamilos = await initEamilOS();
      await eamilos.pauseProject(projectId);
      console.log('Project paused');
      eamilos.shutdown();
      process.exit(0);
    } catch (error) {
      handleFatalError(error);
    }
  });

program
  .command('resume <project>')
  .description('Resume a paused project')
  .action(async (projectId: string) => {
    try {
      const eamilos = await initEamilOS();
      await eamilos.resumeProject(projectId);
      console.log('Project resumed');
      eamilos.shutdown();
      process.exit(0);
    } catch (error) {
      handleFatalError(error);
    }
  });

program
  .command('cancel <project>')
  .description('Cancel a project')
  .action(async (projectId: string) => {
    try {
      const eamilos = await initEamilOS();
      await eamilos.cancelProject(projectId);
      console.log('Project cancelled');
      eamilos.shutdown();
      process.exit(0);
    } catch (error) {
      handleFatalError(error);
    }
  });

program
  .command('retry <project>')
  .description('Retry failed tasks in a project')
  .action(async (projectId: string) => {
    try {
      const eamilos = await initEamilOS();
      const count = eamilos.retryFailedTasks(projectId);
      console.log(`Retried ${count} failed tasks`);
      eamilos.shutdown();
      process.exit(0);
    } catch (error) {
      handleFatalError(error);
    }
  });

program
  .command('help')
  .description('Show help information')
  .action(() => {
    helpCommand(EAMILOS_VERSION);
  });

program
  .command('version')
  .description('Show version information')
  .action(() => {
    versionCommand(EAMILOS_VERSION);
  });

program
  .command('hello [name]')
  .description('Display a greeting with system info')
  .action(async (name?: string) => {
    try {
      await helloCommand(name);
    } catch (error) {
      handleFatalError(error);
    }
  });

program
  .command('hi [name]')
  .description('Display a greeting with system info')
  .action(async (name?: string) => {
    try {
      await hiCommand(name);
    } catch (error) {
      handleFatalError(error);
    }
  });

program.addCommand(createMultiAgentCommands());

program.parse(process.argv);

function handleFatalError(error: unknown, debug = false): void {
  if (debug) {
    console.error(error);
  } else {
    console.log(humanizeError(error));
  }
  process.exit(1);
}

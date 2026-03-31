#!/usr/bin/env node

import { Command } from 'commander';
import { initEamilOS } from '@eamilos/core';
import { init } from './commands/init.js';
import { run } from './commands/run.js';
import { status } from './commands/status.js';
import { list } from './commands/list.js';
import { helpCommand } from './commands/help.js';
import { versionCommand } from './commands/version.js';
import { doctorCommand } from './commands/doctor.js';
import { setupCommand } from './commands/setup.js';
import { pluginsCommand } from './commands/plugins.js';

const EAMILOS_VERSION = '1.0.0';

const program = new Command();

program
  .name('eamilos')
  .description('EamilOS — AI Execution Kernel')
  .version(EAMILOS_VERSION);

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
  .command('run <goal>')
  .description('Run a new project with the given goal')
  .option('-t, --template <template>', 'Project template to use')
  .option('-c, --constraints <constraints...>', 'Additional constraints')
  .option('-b, --budget <budget>', 'Budget limit in USD', (val) => parseFloat(val))
  .option('--model <name>', 'Override model selection')
  .option('--provider <name>', 'Override provider')
  .option('--output <dir>', 'Output directory')
  .option('--debug', 'Show detailed output')
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
      const { benchmarkCommand } = await import('@eamilos/core');
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

program.parse(process.argv);

function handleFatalError(error: unknown, debug = false): void {
  console.log('\n  EamilOS encountered an unexpected error.\n');

  if (error instanceof Error) {
    console.log(`  Error: ${error.message}`);

    if (debug) {
      console.log('\n  Stack trace:');
      console.log(`  ${error.stack}`);
    } else {
      console.log('\n  Run with --debug for full error details.');
    }
  } else {
    console.log(`  Error: ${String(error)}`);
  }

  console.log(`\n  If this persists, run: eamilos doctor`);
  console.log(`  Or report at: https://github.com/eamilos/eamilos/issues\n`);
  process.exit(1);
}

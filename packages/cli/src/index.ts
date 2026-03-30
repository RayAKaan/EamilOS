#!/usr/bin/env node

import { Command } from 'commander';
import { initEamilOS } from '@eamilos/core';
import { init } from './commands/init.js';
import { run } from './commands/run.js';
import { status } from './commands/status.js';
import { list } from './commands/list.js';

const program = new Command();

program
  .name('eamilos')
  .description('EamilOS - Agentic Operating Ground')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize EamilOS configuration')
  .action(async () => {
    try {
      await init();
    } catch (error) {
      console.error('Init failed:', error);
      process.exit(1);
    }
  });

program
  .command('run <goal>')
  .description('Run a new project with the given goal')
  .option('-t, --template <template>', 'Project template to use')
  .option('-c, --constraints <constraints...>', 'Additional constraints')
  .option('-b, --budget <budget>', 'Budget limit in USD', (val) => parseFloat(val))
  .action(async (goal: string, options) => {
    try {
      const eamilos = await initEamilOS();
      await run(eamilos, goal, options);
    } catch (error) {
      console.error('Run failed:', error);
      process.exit(1);
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
      console.error('Status failed:', error);
      process.exit(1);
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
      console.error('List failed:', error);
      process.exit(1);
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
      console.error('Pause failed:', error);
      process.exit(1);
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
      console.error('Resume failed:', error);
      process.exit(1);
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
      console.error('Cancel failed:', error);
      process.exit(1);
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
      console.error('Retry failed:', error);
      process.exit(1);
    }
  });

program.parse(process.argv);

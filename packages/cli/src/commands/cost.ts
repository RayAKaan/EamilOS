// PHASE 2: Full implementation - cost breakdown command
import { Command } from 'commander';
import chalk from 'chalk';
import { initEamilOS } from '@eamilos/core';

export function registerCostCommand(program: Command): void {
  program
    .command('cost <project-id>')
    .description('Show cost breakdown for a project')
    .action(async (projectId: string) => {
      try {
        const eamilos = await initEamilOS();
        const project = eamilos.getProject(projectId);

        if (!project) {
          console.log(chalk.red(`Project not found: ${projectId}`));
          return;
        }

        const status = eamilos.getProjectStatus(projectId);
        const tasks = eamilos.getProjectTasks(projectId);
        const events = eamilos.getProjectEvents(projectId);

        console.log(chalk.bold(`\n📊 Cost Report for ${project.name}\n`));
        console.log(chalk.gray('─'.repeat(50)));

        let totalTokens = 0;
        let totalCost = 0;

        const modelEvents = events.filter((e: { type: string }) => e.type === 'model.called');

        for (const event of modelEvents) {
          const data = event.data as { tokens?: number; costUsd?: number };
          totalTokens += data.tokens ?? 0;
          totalCost += data.costUsd ?? 0;
        }

        console.log(`\nTotal Tasks: ${tasks.length}`);
        console.log(`Completed: ${status.completed}`);
        console.log(`Failed: ${status.failed}`);
        console.log(`In Progress: ${status.inProgress}`);

        console.log(chalk.gray('\n─'.repeat(50)));
        console.log(`Total Tokens: ${totalTokens.toLocaleString()}`);
        console.log(`Estimated Cost: ${chalk.green(`$${totalCost.toFixed(4)}`)}`);

        eamilos.shutdown();
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });
}

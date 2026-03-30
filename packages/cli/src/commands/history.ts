// PHASE 2: Full implementation - event history command
import { Command } from 'commander';
import chalk from 'chalk';
import { initEamilOS } from '@eamilos/core';

export function registerHistoryCommand(program: Command): void {
  program
    .command('history <project-id>')
    .description('Show event history for a project')
    .option('-t, --type <event-type>', 'Filter by event type')
    .option('-l, --limit <number>', 'Limit number of events', '100')
    .action(async (projectId: string, options: { type?: string; limit?: string }) => {
      try {
        const eamilos = await initEamilOS();
        const project = eamilos.getProject(projectId);

        if (!project) {
          console.log(chalk.red(`Project not found: ${projectId}`));
          return;
        }

        const limit = parseInt(options.limit ?? '100', 10);
        let events = eamilos.getProjectEvents(projectId, limit);

        if (options.type) {
          events = events.filter((e: { type: string }) => e.type === options.type);
        }

        console.log(chalk.bold(`\n📜 Event History for ${project.name}\n`));
        console.log(chalk.gray('─'.repeat(50)));

        const eventColors: Record<string, typeof chalk.green> = {
          'project.': chalk.green,
          'task.': chalk.cyan,
          'model.': chalk.magenta,
          'decision.': chalk.yellow,
          'error.': chalk.red,
          'budget.': chalk.red,
          'permission.': chalk.red,
          'system.': chalk.gray,
          'artifact.': chalk.blue,
        };

        if (events.length === 0) {
          console.log(chalk.yellow('\nNo events recorded yet.'));
        } else {
          for (const event of events.slice(0, 30)) {
            const timestamp = new Date(event.timestamp).toLocaleString();
            let color = chalk.white;

            for (const [prefix, c] of Object.entries(eventColors)) {
              if (event.type.startsWith(prefix)) {
                color = c;
                break;
              }
            }

            console.log(`\n${chalk.gray(timestamp)} ${color(event.type)}`);
            if (event.humanReadable) {
              console.log(`  ${event.humanReadable}`);
            }
          }

          if (events.length > 30) {
            console.log(chalk.gray(`\n... and ${events.length - 30} more events`));
          }
        }

        console.log(chalk.gray('\n─'.repeat(50)));
        console.log(`Total events: ${events.length}`);

        eamilos.shutdown();
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });
}

// PHASE 2: Full implementation - decision log command
import { Command } from 'commander';
import chalk from 'chalk';
import { initEamilOS } from '@eamilos/core';

export function registerDecisionsCommand(program: Command): void {
  program
    .command('decisions <project-id>')
    .description('Show all decisions made by agents in a project')
    .option('-t, --task <task-id>', 'Filter by task ID')
    .option('-l, --limit <number>', 'Limit number of decisions', '50')
    .action(async (projectId: string, options: { task?: string; limit?: string }) => {
      try {
        const eamilos = await initEamilOS();
        const project = eamilos.getProject(projectId);

        if (!project) {
          console.log(chalk.red(`Project not found: ${projectId}`));
          return;
        }

        const decisions = eamilos.getDecisionEvents(projectId);

        console.log(chalk.bold(`\n📝 Decision Log for ${project.name}\n`));
        console.log(chalk.gray('─'.repeat(50)));

        const filteredDecisions = decisions.filter((d: { taskId?: string }) =>
          options.task ? d.taskId === options.task : true
        );

        const limit = parseInt(options.limit ?? '50', 10);
        const limitedDecisions = filteredDecisions.slice(0, limit);

        if (limitedDecisions.length === 0) {
          console.log(chalk.yellow('\nNo decisions recorded yet.'));
        } else {
          for (const decision of limitedDecisions) {
            const data = decision.data as { decision: string; rationale?: string };
            const timestamp = new Date(decision.timestamp).toLocaleTimeString();

            console.log(`\n${chalk.cyan(timestamp)}${decision.taskId ? ` ${chalk.gray(`[${decision.taskId.slice(0, 8)}]`)}` : ''}`);
            console.log(chalk.white(`  ${data.decision}`));
            if (data.rationale) {
              console.log(chalk.gray(`  → ${data.rationale}`));
            }
          }
        }

        console.log(chalk.gray('\n─'.repeat(50)));
        console.log(`Showing ${limitedDecisions.length} of ${filteredDecisions.length} decisions`);

        eamilos.shutdown();
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });
}

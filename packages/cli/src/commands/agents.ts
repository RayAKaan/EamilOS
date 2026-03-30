// PHASE 2: Full implementation - list agents command
import { Command } from 'commander';
import chalk from 'chalk';
import { initAgentRegistry } from '@eamilos/core';

export function registerAgentsCommand(program: Command): void {
  program
    .command('agents')
    .description('List all available agents')
    .option('-v, --verbose', 'Show detailed agent information')
    .action(async (options: { verbose?: boolean }) => {
      try {
        const registry = initAgentRegistry();
        const agents = registry.getAllAgents();

        console.log(chalk.bold('\n🤖 Available Agents\n'));
        console.log(chalk.gray('─'.repeat(50)));

        if (agents.length === 0) {
          console.log(chalk.yellow('\nNo agents registered.'));
          console.log(chalk.gray('Agents will be loaded from packages/core/src/agents/'));
        } else {
          for (const agent of agents) {
            console.log(`\n${chalk.cyan(agent.name)} ${chalk.gray(`(${agent.id})`)}`);
            console.log(`  Role: ${agent.role}`);
            console.log(`  Capabilities: ${agent.capabilities.join(', ')}`);

            if (options.verbose && agent.tools) {
              console.log(`  Tools: ${agent.tools.join(', ')}`);
            }
          }
        }

        console.log(chalk.gray('\n─'.repeat(50)));
        console.log(`Total agents: ${agents.length}`);
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });
}

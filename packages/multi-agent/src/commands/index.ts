import { Command } from 'commander';
import { DualOrchestrator, ExecutionStrategy } from '../orchestrator/DualOrchestrator.js';
import chalk from 'chalk';
import ora from 'ora';

export function createMultiAgentCommands(): Command {
  const command = new Command('multi')
    .description('Multi-agent orchestration using OpenCode + Gemini CLI')
    .alias('ma');

  command
    .command('run <task>')
    .description('Run a task using dual-agent orchestration')
    .option('--strategy <strategy>', 'Execution strategy: gemini-first|opencode-first|parallel|swarm', 'gemini-first')
    .option('--working-dir <path>', 'Working directory', process.cwd())
    .option('--max-retries <n>', 'Maximum retry attempts', '3')
    .option('--timeout <ms>', 'Timeout per agent in milliseconds', '120000')
    .option('--env <key=value>', 'Environment variables (repeatable)', collectEnvs, [])
    .action(async (task, options) => {
      const spinner = ora('Initializing agents...').start();

      const env: Record<string, string> = {};
      for (const pair of options.env) {
        const [key, value] = pair.split('=');
        env[key] = value;
      }

      const orchestrator = new DualOrchestrator({
        strategy: options.strategy as ExecutionStrategy,
        workingDir: options.workingDir,
        maxRetries: parseInt(options.maxRetries),
        timeoutMs: parseInt(options.timeout),
        env,
      });

      spinner.text = 'Checking agent availability...';
      const health = await orchestrator.healthCheck();

      if (!health.opencode.available) {
        spinner.fail(`OpenCode not found: ${health.opencode.error}`);
        process.exit(1);
      }
      if (!health.gemini.available) {
        spinner.fail(`Gemini CLI not found: ${health.gemini.error}`);
        process.exit(1);
      }

      spinner.succeed(`Agents ready: OpenCode ${health.opencode.version}, Gemini CLI ${health.gemini.version}`);

      spinner.start(`Executing task (strategy: ${options.strategy})...`);

      try {
        const result = await orchestrator.execute(task, options.strategy as ExecutionStrategy);

        spinner.stop();

        console.log(chalk.bold('\n━━━ Execution Results ━━━\n'));

        if (result.validated) {
          console.log(chalk.green('✅ Task completed and validated'));
        } else {
          console.log(chalk.yellow('⚠️ Task completed but validation had warnings'));
        }

        console.log(`Strategy: ${chalk.cyan(result.strategy)}`);
        console.log(`Attempts: ${result.attempts}`);
        console.log(`Duration: ${(result.duration / 1000).toFixed(1)}s`);

        if (result.files.length > 0) {
          console.log(chalk.bold('\n📁 Files Created:'));
          for (const file of result.files) {
            console.log(`  ${chalk.green('✓')} ${file.path} (${file.action})`);
          }
        }

        if (result.errors.length > 0) {
          console.log(chalk.bold('\n⚠️ Errors:'));
          for (const error of result.errors) {
            console.log(`  - ${error}`);
          }
        }

        console.log(chalk.bold('\n📤 Output:'));
        console.log(result.finalOutput?.slice(0, 2000) || result.secondaryResult?.slice(0, 2000) || 'No output');

        console.log(chalk.gray(`\nGraph nodes created: ${result.graphNodes.length}`));
      } catch (err) {
        spinner.fail(`Execution failed: ${(err as Error).message}`);
        await orchestrator.terminate();
        process.exit(1);
      }

      await orchestrator.terminate();
    });

  command
    .command('doctor')
    .description('Check agent availability and system health')
    .action(async () => {
      const orchestrator = new DualOrchestrator({
        strategy: 'gemini-first',
        workingDir: process.cwd(),
      });

      const spinner = ora('Checking system...').start();
      const health = await orchestrator.healthCheck();
      spinner.stop();

      console.log(chalk.bold('\n━━━ Multi-Agent System Health ━━━\n'));

      if (health.opencode.available) {
        console.log(chalk.green('  ✅ OpenCode CLI'));
        console.log(`     Version: ${health.opencode.version}`);
      } else {
        console.log(chalk.red('  ❌ OpenCode CLI not found'));
        console.log(chalk.gray(`     Error: ${health.opencode.error}`));
      }

      if (health.gemini.available) {
        console.log(chalk.green('  ✅ Gemini CLI'));
        console.log(`     Version: ${health.gemini.version}`);
      } else {
        console.log(chalk.red('  ❌ Gemini CLI not found'));
        console.log(chalk.gray(`     Error: ${health.gemini.error}`));
      }

      console.log(chalk.green('  ✅ Knowledge Graph (Graphify)'));
      console.log(`     Nodes: ${health.graph.nodes}, Edges: ${health.graph.edges}`);

      console.log(chalk.bold('\n━━━ Installation Guide ━━━\n'));
      console.log('OpenCode:  npm install -g opencode-ai');
      console.log('Gemini:    npm install -g @google/gemini-cli');

      await orchestrator.terminate();
    });

  command
    .command('graph [query]')
    .description('Query the knowledge graph')
    .option('--export', 'Export full graph as JSON')
    .option('--stats', 'Show graph statistics')
    .option('--nodes <type>', 'Filter nodes by type (task|agent|file|concept|error)')
    .option('--recent <n>', 'Show N recent nodes', '10')
    .action(async (query, options) => {
      const orchestrator = new DualOrchestrator({
        strategy: 'gemini-first',
        workingDir: process.cwd(),
      });

      const graph = orchestrator.getGraph();

      if (options.export) {
        console.log(JSON.stringify(graph.export(), null, 2));
        return;
      }

      if (options.stats) {
        const stats = graph.getStats();
        console.log(chalk.bold('\n━━━ Knowledge Graph Stats ━━━\n'));
        console.log(`Total Nodes: ${stats.totalNodes}`);
        console.log(`Total Edges: ${stats.totalEdges}`);
        console.log('\nBy Type:');
        for (const [type, count] of Object.entries(stats.byType)) {
          console.log(`  ${type}: ${count}`);
        }
        console.log('\nBy Source:');
        for (const [source, count] of Object.entries(stats.bySource)) {
          console.log(`  ${source}: ${count}`);
        }
        return;
      }

      if (options.nodes) {
        const results = graph.search({ nodeType: options.nodes as any, limit: parseInt(options.recent || '10') });
        console.log(chalk.bold(`\n━━━ ${options.nodes} nodes ━━━\n`));
        for (const node of results.nodes) {
          console.log(`[${node.type}] ${chalk.cyan(node.label)}`);
          console.log(`  Tags: ${node.tags?.join(', ') || 'none'}`);
          console.log(`  Source: ${node.source || 'unknown'}`);
          console.log(`  Created: ${new Date(node.createdAt).toLocaleString()}`);
          console.log();
        }
        return;
      }

      if (query) {
        const results = graph.search({ labelContains: query, limit: 20 });
        console.log(chalk.bold(`\n━━━ Search: "${query}" ━━━\n`));
        console.log(`Found ${results.nodes.length} matching nodes\n`);
        for (const node of results.nodes) {
          console.log(`[${node.type}] ${chalk.cyan(node.label)}`);
          if (node.properties) {
            console.log(`  ${JSON.stringify(node.properties).slice(0, 100)}\n`);
          }
        }
        return;
      }

      const ctx = graph.getContextSummary('opencode');
      console.log(chalk.bold('\n━━━ Knowledge Graph (Recent) ━━━\n'));
      console.log(`Pending tasks: ${ctx.pendingTasks.length}`);
      console.log(`Files in context: ${ctx.files.length}`);
      console.log(`Recent actions: ${ctx.recentHistory.length}\n`);

      if (ctx.recentHistory.length > 0) {
        console.log('Recent:');
        for (const node of ctx.recentHistory.slice(-parseInt(options.recent || '10'))) {
          console.log(`  [${node.type}] ${node.label.slice(0, 60)}`);
        }
      }

      await orchestrator.terminate();
    });

  command
    .command('analyze <task>')
    .description('Analyze a task and show the planned strategy')
    .option('--working-dir <path>', 'Working directory', process.cwd())
    .action(async (task, options) => {
      const orchestrator = new DualOrchestrator({
        strategy: 'gemini-first',
        workingDir: options.workingDir,
      });

      const spinner = ora('Analyzing task...').start();
      const analysis = await orchestrator.analyzeTask(task);
      spinner.stop();

      console.log(chalk.bold('\n━━━ Task Analysis ━━━\n'));
      console.log(`Type: ${chalk.cyan(analysis.type)}`);
      console.log(`Complexity: ${chalk.cyan(analysis.complexity)}`);
      console.log(`Strategy: ${chalk.cyan(analysis.suggestedStrategy)}`);
      console.log(`Requires research: ${analysis.requiresResearch ? 'Yes' : 'No'}`);
      console.log(`Requires code generation: ${analysis.requiresCodeGeneration ? 'Yes' : 'No'}`);
      console.log(`Estimated agents: ${analysis.estimatedAgents.join(', ')}`);
      console.log(`\nReasoning: ${analysis.reasoning}`);

      await orchestrator.terminate();
    });

  return command;
}

function collectEnvs(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

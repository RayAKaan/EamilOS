import { Command } from 'commander';
import { DualOrchestrator, ExecutionStrategy } from '../orchestrator/DualOrchestrator.js';
import chalk from 'chalk';
import ora from 'ora';
import { execSync } from 'child_process';

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
    .option('--timeout <ms>', 'Timeout per agent in milliseconds', '180000')
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
        console.log(chalk.gray('Run: eamilos multi install'));
        process.exit(1);
      }
      if (!health.gemini.available) {
        spinner.warn('Gemini CLI not found — will use OpenCode only');
        console.log(chalk.gray('Run: eamilos multi install to install Gemini CLI'));
      }

      spinner.succeed(`Agents ready: OpenCode ${health.opencode.version || 'ok'}${health.gemini.available ? `, Gemini CLI ${health.gemini.version || 'ok'}` : ' (Gemini unavailable)'}`);

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
        console.log(`Agent used: ${chalk.cyan(result.agentUsed || 'unknown')}`);
        console.log(`Attempts: ${result.attempts}`);
        console.log(`Duration: ${(result.duration / 1000).toFixed(1)}s`);

        if (result.files.length > 0) {
          console.log(chalk.bold('\n📁 Files:'));
          for (const file of result.files) {
            console.log(`  ${chalk.green('✓')} ${file.path} (${file.action})`);
          }
        }

        if (result.errors.length > 0) {
          console.log(chalk.bold('\n⚠️ Errors:'));
          for (const error of result.errors.slice(0, 5)) {
            console.log(`  - ${error.slice(0, 100)}`);
          }
          if (result.errors.length > 5) {
            console.log(chalk.gray(`  ... and ${result.errors.length - 5} more`));
          }
        }

        console.log(chalk.bold('\n📤 Output:'));
        const outputToShow = result.finalOutput || result.secondaryResult || result.primaryResult || 'No output';
        console.log(outputToShow.slice(0, 3000));
        if (outputToShow.length > 3000) {
          console.log(chalk.gray(`\n... (truncated, ${outputToShow.length - 3000} more chars)`));
        }

        console.log(chalk.gray(`\nGraph nodes: ${result.graphNodes.length}`));

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
        console.log(`     Version: ${health.opencode.version || 'ok'}`);
      } else {
        console.log(chalk.red('  ❌ OpenCode CLI not found'));
        console.log(chalk.gray(`     ${health.opencode.error || 'Run: npm install -g opencode-ai'}`));
      }

      if (health.gemini.available) {
        console.log(chalk.green('  ✅ Gemini CLI'));
        console.log(`     Version: ${health.gemini.version || 'ok'}`);
      } else {
        console.log(chalk.yellow('  ⚠️ Gemini CLI not found'));
        console.log(chalk.gray(`     ${health.gemini.error || 'Run: npm install -g @google/gemini-cli'}`));
      }

      console.log(chalk.green('  ✅ Knowledge Graph (Graphify)'));
      console.log(`     Nodes: ${health.graph.nodes}, Edges: ${health.graph.edges}`);

      console.log(chalk.bold('\n━━━ Installation Commands ━━━\n'));
      console.log('  OpenCode:  npm install -g opencode-ai');
      console.log('  Gemini:    npm install -g @google/gemini-cli');
      console.log('  Or run:    eamilos multi install\n');

      console.log(chalk.bold('━━━ Authentication ━━━\n'));
      console.log('  OpenAI (for OpenCode):  export OPENAI_API_KEY=sk-...');
      console.log('  Google (for Gemini):    export GOOGLE_API_KEY=...');
      console.log(chalk.gray('  (Or configure via opencode auth login / gemini login)\n'));

      await orchestrator.terminate();
    });

  command
    .command('install [packages...]')
    .description('Install required CLI agents (opencode, gemini, or all)')
    .option('--global', 'Install globally (default: true)', true)
    .option('--check-only', 'Only check installation status, do not install', false)
    .action(async (packages, options) => {
      const toInstall = packages.length > 0 ? packages : ['opencode', 'gemini'];

      if (options.checkOnly) {
        const orchestrator = new DualOrchestrator({
          strategy: 'gemini-first',
          workingDir: process.cwd(),
        });
        const health = await orchestrator.healthCheck();

        console.log(chalk.bold('\n━━━ Installation Status ━━━\n'));

        const opencodeStatus = health.opencode.available ? '✅ installed' : '❌ not found';
        const geminiStatus = health.gemini.available ? '✅ installed' : '⚠️ not found';

        console.log(`  OpenCode CLI: ${chalk.green(opencodeStatus)}`);
        console.log(`  Gemini CLI:   ${health.gemini.available ? chalk.green(geminiStatus) : chalk.yellow(geminiStatus)}`);

        if (!health.opencode.available || !health.gemini.available) {
          console.log(chalk.gray('\n  Run "eamilos multi install" to install missing packages\n'));
        }

        await orchestrator.terminate();
        return;
      }

      const spinner = ora('Installing packages...').start();

      for (const pkg of toInstall) {
        const pkgName = pkg.toLowerCase();

        let installCmd = '';
        if (pkgName === 'opencode' || pkgName === 'opencode-ai') {
          installCmd = 'npm install -g opencode-ai';
        } else if (pkgName === 'gemini' || pkgName === 'gemini-cli') {
          installCmd = 'npm install -g @google/gemini-cli';
        } else if (pkgName === 'all') {
          installCmd = 'npm install -g opencode-ai @google/gemini-cli';
        } else {
          console.log(chalk.yellow(`Unknown package: ${pkg}`));
          continue;
        }

        spinner.text = `Installing ${pkgName}...`;

        try {
          console.log(chalk.gray(`\n  Running: ${installCmd}`));
          execSync(installCmd, { stdio: 'inherit', timeout: 120000 });
          console.log(chalk.green(`  ✅ ${pkgName} installed\n`));
        } catch (err) {
          console.log(chalk.red(`  ❌ Failed to install ${pkgName}: ${(err as Error).message}`));
        }
      }

      spinner.succeed('Installation complete');

      const orchestrator = new DualOrchestrator({
        strategy: 'gemini-first',
        workingDir: process.cwd(),
      });

      const health = await orchestrator.healthCheck();

      console.log(chalk.bold('\n━━━ Verification ━━━\n'));
      console.log(`  OpenCode: ${health.opencode.available ? chalk.green('✅') : chalk.red('❌')}`);
      console.log(`  Gemini:   ${health.gemini.available ? chalk.green('✅') : chalk.yellow('⚠️')}`);

      if (!health.gemini.available) {
        console.log(chalk.gray('\n  Note: Gemini CLI may require additional authentication.'));
        console.log(chalk.gray('  Run: gemini --prompt "test" to complete setup\n'));
      }

      await orchestrator.terminate();
    });

  command
    .command('stats')
    .description('Show execution statistics and graph metrics')
    .option('--reset', 'Reset all statistics', false)
    .action(async (options) => {
      if (options.reset) {
        const orchestrator = new DualOrchestrator({
          strategy: 'gemini-first',
          workingDir: process.cwd(),
        });
        const graph = orchestrator.getGraph();
        graph.clear();
        await orchestrator.terminate();
        console.log(chalk.green('Statistics reset.'));
        return;
      }

      const orchestrator = new DualOrchestrator({
        strategy: 'gemini-first',
        workingDir: process.cwd(),
      });

      const health = await orchestrator.healthCheck();
      const graph = orchestrator.getGraph();
      const stats = graph.getStats();

      console.log(chalk.bold('\n━━━ EamilOS Multi-Agent Statistics ━━━\n'));

      console.log('  System Status:');
      console.log(`    OpenCode CLI: ${health.opencode.available ? chalk.green('✓') : chalk.red('✗')}`);
      console.log(`    Gemini CLI:   ${health.gemini.available ? chalk.green('✓') : chalk.red('✗')}`);

      console.log(chalk.bold('\n  Knowledge Graph:'));
      console.log(`    Total Nodes: ${stats.totalNodes}`);
      console.log(`    Total Edges: ${stats.totalEdges}`);

      console.log(chalk.bold('\n  Nodes by Type:'));
      for (const [type, count] of Object.entries(stats.byType)) {
        const icon = type === 'task' ? '📋' :
                     type === 'agent' ? '🤖' :
                     type === 'file' ? '📄' :
                     type === 'concept' ? '💡' :
                     type === 'error' ? '❌' : '📌';
        console.log(`    ${icon} ${type}: ${count}`);
      }

      if (Object.keys(stats.bySource).length > 0) {
        console.log(chalk.bold('\n  Nodes by Source:'));
        for (const [source, count] of Object.entries(stats.bySource)) {
          console.log(`    ${source}: ${count}`);
        }
      }

      const ctx = graph.getContextSummary('opencode', 50);
      if (ctx.recentHistory.length > 0) {
        console.log(chalk.bold('\n  Recent Activity:'));
        for (const node of ctx.recentHistory.slice(-5).reverse()) {
          const time = new Date(node.createdAt).toLocaleTimeString();
          console.log(`    ${chalk.gray(time)} [${node.type}] ${node.label.slice(0, 50)}`);
        }
      }

      console.log(chalk.bold('\n  CLI Usage:'));
      console.log(`    eamilos multi run "<task>"     - Execute a task`);
      console.log(`    eamilos multi doctor           - Check system health`);
      console.log(`    eamilos multi graph            - Query knowledge graph`);
      console.log(`    eamilos multi analyze "<task>" - Analyze task strategy\n`);

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
        const data = graph.export();
        console.log(JSON.stringify(data, null, 2));
        await orchestrator.terminate();
        return;
      }

      if (options.stats) {
        const stats = graph.getStats();
        console.log(chalk.bold('\n━━━ Knowledge Graph Statistics ━━━\n'));
        console.log(`Total Nodes: ${stats.totalNodes}`);
        console.log(`Total Edges: ${stats.totalEdges}`);
        console.log('\nBy Type:');
        for (const [type, count] of Object.entries(stats.byType)) {
          console.log(`  ${type}: ${count}`);
        }
        if (Object.keys(stats.bySource).length > 0) {
          console.log('\nBy Source:');
          for (const [source, count] of Object.entries(stats.bySource)) {
            console.log(`  ${source}: ${count}`);
          }
        }
        await orchestrator.terminate();
        return;
      }

      if (options.nodes) {
        const validTypes = ['task', 'agent', 'file', 'concept', 'error', 'context', 'code'];
        const nodeType = options.nodes as string;

        if (!validTypes.includes(nodeType)) {
          console.log(chalk.yellow(`Invalid node type. Valid types: ${validTypes.join(', ')}`));
          await orchestrator.terminate();
          return;
        }

        const results = graph.search({
          nodeType: nodeType as any,
          limit: parseInt(options.recent || '10')
        });

        console.log(chalk.bold(`\n━━━ ${nodeType} nodes ━━━\n`));

        if (results.nodes.length === 0) {
          console.log('  No nodes found.');
        } else {
          for (const node of results.nodes) {
            console.log(`[${chalk.cyan(node.type)}] ${chalk.bold(node.label)}`);
            if (node.tags?.length) console.log(`  Tags: ${node.tags.join(', ')}`);
            if (node.source) console.log(`  Source: ${node.source}`);
            console.log(`  Created: ${new Date(node.createdAt).toLocaleString()}`);
            if (node.properties && Object.keys(node.properties).length > 0) {
              const preview = JSON.stringify(node.properties).slice(0, 100);
              console.log(`  Props: ${preview}...`);
            }
            console.log();
          }
        }

        await orchestrator.terminate();
        return;
      }

      if (query) {
        const results = graph.search({ labelContains: query, limit: 20 });
        console.log(chalk.bold(`\n━━━ Search: "${query}" ━━━\n`));
        console.log(`Found ${results.nodes.length} matching nodes\n`);

        for (const node of results.nodes) {
          console.log(`[${chalk.cyan(node.type)}] ${chalk.bold(node.label)}`);
          if (node.properties && Object.keys(node.properties).length > 0) {
            console.log(`  ${JSON.stringify(node.properties).slice(0, 100)}`);
          }
          console.log();
        }

        await orchestrator.terminate();
        return;
      }

      const ctx = graph.getContextSummary('opencode');
      console.log(chalk.bold('\n━━━ Knowledge Graph ━━━\n'));
      console.log(`Pending tasks: ${ctx.pendingTasks.length}`);
      console.log(`Files in context: ${ctx.files.length}`);
      console.log(`Recent actions: ${ctx.recentHistory.length}`);

      if (ctx.recentHistory.length > 0) {
        console.log(chalk.bold('\nRecent:'));
        for (const node of ctx.recentHistory.slice(-parseInt(options.recent || '10'))) {
          console.log(`  [${node.type}] ${node.label.slice(0, 60)}`);
        }
      }

      if (ctx.pendingTasks.length > 0) {
        console.log(chalk.bold('\nPending Tasks:'));
        for (const task of ctx.pendingTasks.slice(0, 5)) {
          const assigned = task.properties.assignedAgent || 'unassigned';
          console.log(`  • ${task.label.slice(0, 60)} (${assigned})`);
        }
      }

      console.log();
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

      let analysis;
      try {
        analysis = await orchestrator.analyzeTask(task);
      } catch (err) {
        spinner.fail(`Analysis failed: ${(err as Error).message}`);
        await orchestrator.terminate();
        process.exit(1);
      }

      spinner.stop();

      console.log(chalk.bold('\n━━━ Task Analysis ━━━\n'));
      console.log(`Type:        ${chalk.cyan(analysis.type)}`);
      console.log(`Complexity:  ${chalk.cyan(analysis.complexity)}`);
      console.log(`Strategy:    ${chalk.cyan(analysis.suggestedStrategy)}`);
      console.log(`Requires research: ${analysis.requiresResearch ? chalk.green('Yes') : chalk.gray('No')}`);
      console.log(`Requires code gen: ${analysis.requiresCodeGeneration ? chalk.green('Yes') : chalk.gray('No')}`);
      console.log(`Estimated agents:  ${analysis.estimatedAgents.join(', ')}`);
      console.log(`\nReasoning: ${analysis.reasoning}`);

      console.log(chalk.bold('\n━━━ Strategy Guide ━━━\n'));
      console.log('  gemini-first  - Best for research-heavy tasks (Gemini researches, OpenCode implements)');
      console.log('  opencode-first - Best for code-focused tasks (OpenCode implements, Gemini reviews)');
      console.log('  parallel     - Best for complex tasks with independent research + implementation');
      console.log('  swarm        - Best when you want the best result from both agents competing\n');

      console.log(`To execute with this strategy:`);
      console.log(chalk.gray(`  eamilos multi run "${task.slice(0, 50)}..." --strategy ${analysis.suggestedStrategy}\n`));

      await orchestrator.terminate();
    });

  return command;
}

function collectEnvs(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

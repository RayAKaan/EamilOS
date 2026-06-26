import { Command } from 'commander';
import { SwarmOrchestrator, ExecutionStrategy } from '../orchestrator/SwarmOrchestrator.js';
import { detectEnvironment, canMultiplex, spawnSplitTerminals } from '../multiplexer.js';
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
    .option('--split', 'Spawn physical OS terminal split panes (desktop only)')
    .option('--multiplex', 'Alias for --split')
    .action(async (task, options) => {
      const useSplit = options.split || options.multiplex;

      if (useSplit) {
        const terminalEnv = detectEnvironment();
        if (canMultiplex()) {
          console.log(chalk.cyan(`\n  🖥️  Split Terminal Mode Detected: ${terminalEnv}\n`));
        } else {
          console.log(chalk.yellow('\n  ⚠️  --split flag ignored: Terminal does not support multiplexing.\n'));
          console.log(chalk.gray('  Supported: Windows Terminal, Tmux, iTerm2, VS Code\n'));
        }
      }

      const spinner = ora('Initializing agents...').start();

      const env: Record<string, string> = {};
      for (const pair of options.env) {
        const [key, value] = pair.split('=');
        env[key] = value;
      }

      const orchestrator = new SwarmOrchestrator({
        strategy: options.strategy as ExecutionStrategy,
        workingDir: options.workingDir,
        maxRetries: parseInt(options.maxRetries),
        timeoutMs: parseInt(options.timeout),
        env,
      });

      spinner.text = 'Checking agent availability...';
      const health = await orchestrator.healthCheck();

      if (!health.opencode.available && !health.claudeCode.available && !health.aider.available && !health.gemini.available) {
        spinner.fail('No coding agents found. Install one: npm install -g opencode-ai');
        console.log(chalk.gray('Run: eamilos multi install'));
        process.exit(1);
      }

      const available: string[] = [];
      if (health.opencode.available) available.push('OpenCode');
      if (health.claudeCode.available) available.push('Claude Code');
      if (health.aider.available) available.push('Aider');
      if (health.goose.available) available.push('Goose');
      if (health.gemini.available) available.push('Gemini');

      spinner.succeed(`Agents ready: ${available.join(', ') || 'none'}`);

      // If --split mode is active and terminal supports it, spawn physical split panes
      if (useSplit && canMultiplex()) {
        spinner.info('Spawning split terminal panes...');

        const agentCommands: { name: string; command: string; args: string[] }[] = [];

        if (health.claudeCode.available) {
          agentCommands.push({ name: 'Claude Code', command: 'npx', args: ['--yes', '@anthropic-ai/claude-code', '--print', task] });
        }
        if (health.opencode.available) {
          agentCommands.push({ name: 'OpenCode', command: 'npx', args: ['--yes', 'opencode-ai', 'run', task] });
        }
        if (health.gemini.available) {
          agentCommands.push({ name: 'Gemini', command: 'npx', args: ['--yes', '@google/gemini-cli', 'run', task] });
        }
        if (health.aider.available) {
          agentCommands.push({ name: 'Aider', command: 'aider', args: ['--message', task, '--yes'] });
        }
        if (health.goose.available) {
          agentCommands.push({ name: 'Goose', command: 'npx', args: ['--yes', '@block/goose', 'run', task] });
        }

        if (agentCommands.length > 0) {
          spinner.stop();
          await spawnSplitTerminals({
            agents: agentCommands,
            task,
            workingDir: options.workingDir,
          });
          console.log(chalk.green('\n  ✅ Split terminal agents launched.\n'));
        }
      }

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
      const orchestrator = new SwarmOrchestrator({
        strategy: 'gemini-first',
        workingDir: process.cwd(),
      });

      const spinner = ora('Checking system...').start();
      const health = await orchestrator.healthCheck();
      spinner.stop();

      console.log(chalk.bold('\n━━━ Multi-Agent System Health ━━━\n'));

      const agentEntries: { name: string; key: keyof typeof health; emoji: string; install: string }[] = [
        { name: 'OpenCode CLI', key: 'opencode' as any, emoji: '🤖', install: 'npm install -g opencode-ai' },
        { name: 'Claude Code', key: 'claudeCode' as any, emoji: '🧠', install: 'npm install -g @anthropic-ai/claude-code' },
        { name: 'Aider', key: 'aider' as any, emoji: '🔧', install: 'pip install aider-chat' },
        { name: 'Goose', key: 'goose' as any, emoji: '🦆', install: 'npm install -g @block/goose' },
        { name: 'Gemini CLI', key: 'gemini' as any, emoji: '✨', install: 'npm install -g @google/gemini-cli' },
      ];

      for (const entry of agentEntries) {
        const status = (health as any)[entry.key];
        if (status?.available) {
          console.log(chalk.green(`  ✅ ${entry.emoji} ${entry.name}`));
          console.log(`     Version: ${status.version || 'ok'}`);
        } else {
          console.log(chalk.red(`  ❌ ${entry.emoji} ${entry.name} not found`));
          console.log(chalk.gray(`     ${status?.error || `Run: ${entry.install}`}`));
        }
      }

      console.log(chalk.green('  ✅ Knowledge Graph (Graphify)'));
      console.log(`     Nodes: ${health.graph.nodes}, Edges: ${health.graph.edges}`);

      console.log(chalk.bold('\n━━━ Installation Commands ━━━\n'));
      for (const entry of agentEntries) {
        console.log(`  ${entry.emoji} ${entry.name}:  ${entry.install}`);
      }
      console.log('  Or run:    eamilos multi install\n');

      console.log(chalk.bold('━━━ Authentication ━━━\n'));
      console.log('  OpenAI (for OpenCode):    export OPENAI_API_KEY=sk-...');
      console.log('  Claude (for Claude Code): export ANTHROPIC_API_KEY=sk-ant-...');
      console.log('  Google (for Gemini):      export GOOGLE_API_KEY=...');
      console.log(chalk.gray('  (Or configure via respective CLI auth login commands)\n'));

      await orchestrator.terminate();
    });

  command
    .command('install [packages...]')
    .description('Install required CLI agents (opencode, gemini, or all)')
    .option('--global', 'Install globally (default: true)', true)
    .option('--check-only', 'Only check installation status, do not install', false)
    .action(async (packages, options) => {
      const toInstall = packages.length > 0 ? packages : ['opencode', 'gemini'];

      const installMap: Record<string, { cmd: string; display: string }> = {
        'opencode': { cmd: 'npm install -g opencode-ai', display: 'OpenCode CLI' },
        'opencode-ai': { cmd: 'npm install -g opencode-ai', display: 'OpenCode CLI' },
        'claude': { cmd: 'npm install -g @anthropic-ai/claude-code', display: 'Claude Code' },
        'claude-code': { cmd: 'npm install -g @anthropic-ai/claude-code', display: 'Claude Code' },
        'aider': { cmd: 'pip install aider-chat', display: 'Aider' },
        'aider-chat': { cmd: 'pip install aider-chat', display: 'Aider' },
        'goose': { cmd: 'npm install -g @block/goose', display: 'Goose' },
        'gemini': { cmd: 'npm install -g @google/gemini-cli', display: 'Gemini CLI' },
        'gemini-cli': { cmd: 'npm install -g @google/gemini-cli', display: 'Gemini CLI' },
        'all': { cmd: 'npm install -g opencode-ai @anthropic-ai/claude-code @block/goose @google/gemini-cli && pip install aider-chat', display: 'All agents' },
      };

      if (options.checkOnly) {
        const orchestrator = new SwarmOrchestrator({
          strategy: 'gemini-first',
          workingDir: process.cwd(),
        });
        const health = await orchestrator.healthCheck();

        console.log(chalk.bold('\n━━━ Installation Status ━━━\n'));

        const statusEntries: { name: string; key: keyof typeof health; emoji: string }[] = [
          { name: 'OpenCode CLI', key: 'opencode' as any, emoji: '🤖' },
          { name: 'Claude Code', key: 'claudeCode' as any, emoji: '🧠' },
          { name: 'Aider', key: 'aider' as any, emoji: '🔧' },
          { name: 'Goose', key: 'goose' as any, emoji: '🦆' },
          { name: 'Gemini CLI', key: 'gemini' as any, emoji: '✨' },
        ];

        for (const entry of statusEntries) {
          const status = (health as any)[entry.key];
          const icon = status?.available ? chalk.green('✅ installed') : chalk.red('❌ not found');
          console.log(`  ${entry.emoji} ${entry.name}: ${icon}`);
        }

        const allInstalled = statusEntries.every(e => (health as any)[e.key]?.available);
        if (!allInstalled) {
          console.log(chalk.gray('\n  Run "eamilos multi install" to install missing packages\n'));
        }

        await orchestrator.terminate();
        return;
      }

      const spinner = ora('Installing packages...').start();

      for (const pkg of toInstall) {
        const pkgName = pkg.toLowerCase();
        const pkgInfo = installMap[pkgName];

        if (!pkgInfo) {
          console.log(chalk.yellow(`Unknown package: ${pkg}. Try: opencode, claude, aider, goose, gemini, or all`));
          continue;
        }

        spinner.text = `Installing ${pkgInfo.display}...`;

        try {
          console.log(chalk.gray(`\n  Running: ${pkgInfo.cmd}`));
          execSync(pkgInfo.cmd, { stdio: 'inherit', timeout: 120000 });
          console.log(chalk.green(`  ✅ ${pkgInfo.display} installed\n`));
        } catch (err) {
          console.log(chalk.red(`  ❌ Failed to install ${pkgInfo.display}: ${(err as Error).message}`));
        }
      }

      spinner.succeed('Installation complete');

      const orchestrator = new SwarmOrchestrator({
        strategy: 'gemini-first',
        workingDir: process.cwd(),
      });

      const health = await orchestrator.healthCheck();

      console.log(chalk.bold('\n━━━ Verification ━━━\n'));

      const entries: { name: string; key: keyof typeof health; emoji: string }[] = [
        { name: 'OpenCode CLI', key: 'opencode' as any, emoji: '🤖' },
        { name: 'Claude Code', key: 'claudeCode' as any, emoji: '🧠' },
        { name: 'Aider', key: 'aider' as any, emoji: '🔧' },
        { name: 'Goose', key: 'goose' as any, emoji: '🦆' },
        { name: 'Gemini CLI', key: 'gemini' as any, emoji: '✨' },
      ];

      for (const entry of entries) {
        const status = (health as any)[entry.key];
        console.log(`  ${entry.emoji} ${entry.name}: ${status?.available ? chalk.green('✅') : chalk.red('❌')}`);
      }

      await orchestrator.terminate();
    });

  command
    .command('stats')
    .description('Show execution statistics and graph metrics')
    .option('--reset', 'Reset all statistics', false)
    .action(async (options) => {
      if (options.reset) {
        const orchestrator = new SwarmOrchestrator({
          strategy: 'gemini-first',
          workingDir: process.cwd(),
        });
        const graph = orchestrator.getGraph();
        graph.clear();
        await orchestrator.terminate();
        console.log(chalk.green('Statistics reset.'));
        return;
      }

      const orchestrator = new SwarmOrchestrator({
        strategy: 'gemini-first',
        workingDir: process.cwd(),
      });

      const health = await orchestrator.healthCheck();
      const graph = orchestrator.getGraph();
      const stats = graph.getStats();

      console.log(chalk.bold('\n━━━ EamilOS Multi-Agent Statistics ━━━\n'));

      console.log('  System Status:');
      console.log(`    OpenCode CLI: ${health.opencode.available ? chalk.green('✓') : chalk.red('✗')}`);
      console.log(`    Claude Code:  ${health.claudeCode.available ? chalk.green('✓') : chalk.red('✗')}`);
      console.log(`    Aider:        ${health.aider.available ? chalk.green('✓') : chalk.red('✗')}`);
      console.log(`    Goose:        ${health.goose.available ? chalk.green('✓') : chalk.red('✗')}`);
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
      const orchestrator = new SwarmOrchestrator({
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
      const orchestrator = new SwarmOrchestrator({
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

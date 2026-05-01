import { Template } from '../types.js';

export const cliToolTemplate: Template = {
  id: 'cli-tool',
  name: 'CLI Tool',
  description: 'Command-line tool with argument parsing, subcommands, and colored output',
  category: 'cli',
  version: '1.0.0',
  author: 'EamilOS',
  tags: ['cli', 'commander', 'typescript', 'node'],

  workflow: {
    name: 'Build CLI Tool',
    steps: [
      {
        phase: 'design',
        agent: 'auto',
        prompt: 'Design CLI tool architecture with subcommands, options, and help system.',
        expectedOutputs: ['docs/commands.md'],
      },
      {
        phase: 'core',
        agent: 'auto',
        prompt: 'Implement CLI entry point with commander, subcommand registration, and argument parsing.',
        expectedOutputs: ['src/index.ts', 'src/commands/*.ts'],
      },
      {
        phase: 'tests',
        agent: 'auto',
        prompt: 'Write unit tests for all CLI commands.',
        expectedOutputs: ['src/**/*.test.ts'],
      },
    ],
  },

  files: [
    {
      path: 'package.json',
      template: `{
  "name": "{{projectName}}",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "{{binName}}": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "test": "vitest"
  },
  "dependencies": {
    "commander": "^11.1.0",
    "chalk": "^5.3.0",
    "ora": "^7.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.6.0",
    "typescript": "^5.3.0",
    "vitest": "^1.0.0"
  }
}`,
      agent: 'auto',
    },
    {
      path: 'src/index.ts',
      template: `#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { registerCommands } from './commands/index.js';

const program = new Command();

program
  .name('{{binName}}')
  .description('{{description}}')
  .version('{{version}}');

registerCommands(program);

program.parse(process.argv);`,
      agent: 'auto',
    },
    {
      path: 'src/commands/index.ts',
      template: `import { Command } from 'commander';
import { registerInitCommand } from './init.js';
import { registerRunCommand } from './run.js';
import { registerListCommand } from './list.js';

export function registerCommands(program: Command): void {
  registerInitCommand(program);
  registerRunCommand(program);
  registerListCommand(program);
}`,
      agent: 'auto',
    },
    {
      path: 'src/commands/init.ts',
      template: `import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize a new project')
    .option('-n, --name <name>', 'Project name')
    .action(async (options) => {
      const spinner = ora('Initializing project...').start();
      try {
        console.log(chalk.green('Project initialized successfully!'));
        spinner.succeed();
      } catch (error) {
        spinner.fail(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}`,
      agent: 'auto',
    },
    {
      path: 'src/commands/run.ts',
      template: `import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';

export function registerRunCommand(program: Command): void {
  program
    .command('run <task>')
    .description('Run a task')
    .option('-v, --verbose', 'Verbose output')
    .action(async (task: string, options) => {
      const spinner = ora(\`Running: \${task}\`).start();
      try {
        console.log(chalk.green(\`Task completed: \${task}\`));
        spinner.succeed();
      } catch (error) {
        spinner.fail(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}`,
      agent: 'auto',
    },
    {
      path: 'src/commands/list.ts',
      template: `import { Command } from 'commander';
import chalk from 'chalk';

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List available items')
    .option('-j, --json', 'Output as JSON')
    .action(async (options) => {
      const items = [];
      if (options.json) {
        console.log(JSON.stringify(items, null, 2));
      } else {
        console.log(chalk.cyan('No items found.'));
      }
    });
}`,
      agent: 'auto',
    },
    {
      path: 'tsconfig.json',
      template: `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src"]
}`,
      agent: 'auto',
    },
  ],

  postGenerate: {
    commands: ['npm install', 'npm run build'],
    installDeps: true,
    gitInit: true,
  },

  estimatedCost: {
    min: 1.50,
    max: 3.00,
    currency: 'USD',
  },

  variables: [
    {
      name: 'projectName',
      type: 'string',
      description: 'Project name (npm package name)',
      default: 'my-cli-tool',
      required: true,
    },
    {
      name: 'binName',
      type: 'string',
      description: 'CLI binary name (command to run)',
      default: 'mycli',
      required: true,
    },
    {
      name: 'description',
      type: 'string',
      description: 'Tool description',
      default: 'A powerful CLI tool',
      required: false,
    },
    {
      name: 'version',
      type: 'string',
      description: 'Initial version',
      default: '1.0.0',
      required: false,
    },
  ],
};

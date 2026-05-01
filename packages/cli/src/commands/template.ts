import { Command } from 'commander';
import chalk from 'chalk';
import { initEamilOS, getTemplateRegistry, TemplateEngine, Template } from '@eamilos/core';
import * as readline from 'readline';
import * as path from 'path';

export function registerTemplateCommand(program: Command): void {
  const templateCmd = program
    .command('template')
    .description('Manage and execute project templates');

  templateCmd
    .command('list')
    .description('List all available templates')
    .option('-c, --category <category>', 'Filter by category (web, cli, data, mobile, api)')
    .action(async (options) => {
      try {
        const eamilos = await initEamilOS();
        const registry = getTemplateRegistry();
        const templates = registry.listTemplates(options.category);

        console.log(chalk.bold.cyan('\nAvailable Templates\n'));
        console.log(chalk.gray('─'.repeat(70)));

        for (const t of templates) {
          const cost = `$${t.estimatedCost.min.toFixed(2)} - $${t.estimatedCost.max.toFixed(2)}`;
          const tags = t.tags.slice(0, 4).join(', ');
          console.log(chalk.bold(`  ${t.id.padEnd(20)}`) + chalk.dim(` ${t.category}`));
          console.log(chalk.dim(`    ${t.description}`));
          console.log(chalk.dim(`    Tags: ${tags} | Est. cost: ${cost}`));
          console.log('');
        }

        console.log(chalk.dim(`Total: ${templates.length} templates`));
        eamilos.shutdown();
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });

  templateCmd
    .command('show <id>')
    .description('Show template details')
    .action(async (id: string) => {
      try {
        const eamilos = await initEamilOS();
        const registry = getTemplateRegistry();
        const template = registry.getTemplate(id);

        if (!template) {
          console.log(chalk.red(`Template not found: ${id}`));
          eamilos.shutdown();
          return;
        }

        console.log(chalk.bold.cyan(`\nTemplate: ${template.name}\n`));
        console.log(chalk.dim(`ID: ${template.id}`));
        console.log(chalk.dim(`Category: ${template.category}`));
        console.log(chalk.dim(`Version: ${template.version}`));
        console.log(chalk.dim(`Author: ${template.author}`));
        console.log(chalk.dim(`Tags: ${template.tags.join(', ')}`));
        console.log(chalk.dim(`Description: ${template.description}`));

        console.log(chalk.bold.cyan('\nWorkflow Steps:'));
        for (const [i, step] of template.workflow.steps.entries()) {
          console.log(chalk.dim(`  ${i + 1}. [${step.phase}] ${step.prompt.substring(0, 80)}...`));
        }

        console.log(chalk.bold.cyan('\nFiles to Generate:'));
        for (const file of template.files) {
          console.log(chalk.dim(`  - ${file.path}`));
        }

        console.log(chalk.bold.cyan('\nVariables:'));
        for (const v of template.variables) {
          const req = v.required ? chalk.red('required') : chalk.dim('optional');
          const def = v.default !== undefined ? chalk.dim(` (default: ${v.default})`) : '';
          const choices = v.choices ? chalk.dim(` [${v.choices.join(', ')}]`) : '';
          console.log(chalk.dim(`  ${v.name} (${v.type}) ${req}${def}${choices}`));
          console.log(chalk.dim(`    ${v.description}`));
        }

        console.log(chalk.bold.cyan('\nPost-Generate Commands:'));
        for (const cmd of template.postGenerate.commands) {
          console.log(chalk.dim(`  $ ${cmd}`));
        }

        const cost = template.estimatedCost;
        console.log(chalk.bold.cyan(`\nEstimated Cost: $${cost.min.toFixed(2)} - $${cost.max.toFixed(2)}`));

        eamilos.shutdown();
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });

  templateCmd
    .command('use <id>')
    .description('Execute a template and generate a project')
    .option('-o, --output <dir>', 'Output directory', './')
    .option('-v, --var <key=value...>', 'Set template variables')
    .option('--skip-vars', 'Skip interactive variable prompts')
    .option('--skip-workflow', 'Only generate files, skip workflow steps')
    .action(async (id: string, options) => {
      try {
        const eamilos = await initEamilOS();
        const registry = getTemplateRegistry();
        const template = registry.getTemplate(id);

        if (!template) {
          console.log(chalk.red(`Template not found: ${id}`));
          eamilos.shutdown();
          return;
        }

        console.log(chalk.bold.cyan(`\nExecuting template: ${template.name}\n`));

        const variables = await resolveVariables(template, options);

        if (variables === null) {
          eamilos.shutdown();
          return;
        }

        const outputDir = path.resolve(options.output);
        console.log(chalk.dim(`Output directory: ${outputDir}`));

        const engine = new TemplateEngine();

        if (!options.skipWorkflow) {
          console.log(chalk.bold.cyan('\nRunning workflow steps...\n'));
          await engine.runWorkflow(id, variables);
        }

        console.log(chalk.bold.cyan('\nGenerating files...\n'));
        const result = await engine.execute(id, variables, outputDir);

        if (result.success) {
          console.log(chalk.green(`\n✓ Template executed successfully!`));
          console.log(chalk.dim(`  Files generated: ${result.filesWritten}/${result.filesGenerated}`));
          console.log(chalk.dim(`  Duration: ${(result.durationMs / 1000).toFixed(1)}s`));
          console.log(chalk.dim(`  Cost: $${result.totalCost.toFixed(4)}`));

          if (result.commands.length > 0) {
            console.log(chalk.bold.cyan('\nPost-generation commands:'));
            for (const cmd of result.commands) {
              console.log(chalk.dim(`  $ ${cmd}`));
            }
          }

          if (template.postGenerate.installDeps) {
            console.log(chalk.dim('\nDependencies will be installed.'));
          }
          if (template.postGenerate.gitInit) {
            console.log(chalk.dim('Git repository will be initialized.'));
          }
        } else {
          console.log(chalk.red(`\n✗ Template execution completed with errors.`));
          console.log(chalk.dim(`  Files written: ${result.filesWritten}/${result.filesGenerated}`));
          if (result.errors.length > 0) {
            console.log(chalk.red('  Errors:'));
            for (const err of result.errors) {
              console.log(chalk.red(`    - ${err}`));
            }
          }
        }

        eamilos.shutdown();
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });

  templateCmd
    .command('search <query>')
    .description('Search templates')
    .action(async (query: string) => {
      try {
        const eamilos = await initEamilOS();
        const registry = getTemplateRegistry();
        const templates = registry.searchTemplates(query);

        if (templates.length === 0) {
          console.log(chalk.yellow(`No templates found for "${query}"`));
          eamilos.shutdown();
          return;
        }

        console.log(chalk.bold.cyan(`\nSearch results for "${query}"\n`));
        for (const t of templates) {
          console.log(chalk.bold(`  ${t.id.padEnd(20)}`) + chalk.dim(` ${t.category}`));
          console.log(chalk.dim(`    ${t.description}`));
          console.log('');
        }

        console.log(chalk.dim(`Found: ${templates.length} template(s)`));
        eamilos.shutdown();
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });
}


async function resolveVariables(
  template: Template,
  options: { var?: string[]; skipVars?: boolean }
): Promise<Record<string, string | number | boolean> | null> {
  const variables: Record<string, string | number | boolean> = {};

  if (options.var) {
    for (const pair of options.var) {
      const [key, ...rest] = pair.split('=');
      const value = rest.join('=');
      const templateVar = template.variables.find((v: { name: string }) => v.name === key);
      if (templateVar) {
        variables[key] = castValue(templateVar, value);
      }
    }
  }

  if (options.skipVars) return variables;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prompt = (question: string): Promise<string> =>
    new Promise(resolve => rl.question(question, resolve));

  for (const variable of template.variables) {
    if (variables[variable.name] !== undefined) continue;

    if (variable.type === 'boolean') {
      const answer = await prompt(`${variable.description} (y/n, default: ${variable.default ? 'y' : 'n'}): `);
      variables[variable.name] = answer.toLowerCase().startsWith('y') || (answer.trim() === '' && !!variable.default);
    } else if (variable.type === 'choice' && variable.choices) {
      console.log(chalk.dim(`  ${variable.description}`));
      for (const [i, choice] of variable.choices.entries()) {
        const marker = choice === variable.default ? ' (default)' : '';
        console.log(chalk.dim(`    ${i + 1}. ${choice}${marker}`));
      }
      const answer = await prompt(`  Choice (1-${variable.choices.length}, default: ${variable.choices.indexOf(String(variable.default)) + 1}): `);
      const idx = parseInt(answer.trim()) - 1;
      variables[variable.name] = (idx >= 0 && idx < variable.choices.length)
        ? variable.choices[idx]
        : (variable.default as string);
    } else {
      const def = variable.default !== undefined ? ` [${variable.default}]` : '';
      const req = variable.required ? '' : ' (optional)';
      const answer = await prompt(`${variable.description}${def}${req}: `);
      if (answer.trim() === '' && variable.default !== undefined) {
        variables[variable.name] = variable.default;
      } else if (answer.trim() === '' && variable.required) {
        console.log(chalk.red(`  ${variable.name} is required.`));
        rl.close();
        return null;
      } else {
        variables[variable.name] = castValue(variable, answer.trim());
      }
    }
  }

  rl.close();
  return variables;
}

function castValue(variable: { type: string; name: string }, value: string): string | number | boolean {
  switch (variable.type) {
    case 'number':
      const num = Number(value);
      return isNaN(num) ? value : num;
    case 'boolean':
      return value.toLowerCase() === 'true' || value.toLowerCase() === 'yes' || value === '1';
    default:
      return value;
  }
}

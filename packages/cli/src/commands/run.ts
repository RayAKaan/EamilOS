import { EamilOS } from '../core/index.js';
import { header, success, info, kv, divider, error as printError } from '../ui.js';
import { createSessionOrchestrator } from '../core/session/SessionOrchestrator.js';
import type { ExecutionStrategy } from '../core/agents/types.js';
import type { AgentMode } from '../core/agents/types.js';
import chalk from 'chalk';

interface RunOptions {
  template?: string;
  constraints?: string[];
  budget?: number;
  provider?: string;
  model?: string;
  agent?: string;
  agents?: string[];
  strategy?: ExecutionStrategy;
  mode?: AgentMode;
  output?: string;
  debug?: boolean;
  forceInit?: boolean;
}

function normalizeStrategy(raw?: string): ExecutionStrategy {
  if (raw === 'swarm' || raw === '--swarm') return 'swarm';
  if (raw === 'single') return 'single';
  if (raw === 'manual') return 'manual';
  if (raw === 'fallback') return 'fallback';
  return 'fallback';
}

export async function run(
  eamilos: EamilOS,
  goal: string,
  options: RunOptions
): Promise<void> {
  header('Creating Project');

  const projectName = goal.length > 50 ? goal.substring(0, 47) + '...' : goal;

  info(`Goal: ${goal}`);

  const project = await eamilos.createProject({
    name: projectName,
    goal,
    path: './data/projects',
    template: options.template,
    constraints: options.constraints,
    budgetUsd: options.budget,
  });

  success(`Created project: ${project.name}`);
  kv('Project ID', project.id);
  kv('Status', project.status);
  divider();

  info('Creating task from goal...');

  const task = await eamilos.createTask({
    projectId: project.id,
    title: goal,
    description: `Execute the goal: ${goal}`,
    type: 'coding',
  });

  kv('Task ID', task.id);
  divider();

  const strategy = normalizeStrategy(options.strategy);
  const mode: AgentMode = options.mode ?? 'execution';

  info(`Strategy: ${strategy} | Mode: ${mode}`);
  divider();

  const session = createSessionOrchestrator({
    goal,
    projectId: project.id,
    strategy,
    mode,
    workingDir: process.cwd(),
    outputDir: options.output,
    preferredAgent: options.agent,
    preferredProvider: options.provider,
    preferredModel: options.model,
  });

  if (options.debug) {
    session.on('agent.output', (data) => {
      console.log(chalk.gray(`  [${data.agentId}] ${data.content.slice(0, 200)}`));
    });
    session.on('agent.fallback', (data) => {
      console.log(chalk.yellow(`  ⚠️  Fallback: ${data.from} → ${data.to} (${data.reason})`));
    });
  }

  try {
    const result = await session.run();

    divider();

    if (result.success) {
      success('Task completed successfully!');
      kv('Strategy', result.strategy);
      kv('Mode', result.mode);
      kv('Agent', result.agentUsed || 'unknown');
      kv('Duration', `${(result.duration / 1000).toFixed(1)}s`);
      if (result.primaryResult) {
        kv('Output', result.primaryResult.slice(0, 300) + (result.primaryResult.length > 300 ? '...' : ''));
      }
      kv('File changes', result.fileChanges.length.toString());
    } else {
      printError('Task failed');
      for (const err of result.errors.slice(0, 3)) {
        kv('Error', err.slice(0, 120));
      }
    }

    divider();
    info(`Run "eamilos status ${project.id}" to see project details`);
  } catch (err) {
    divider();
    printError(`Execution failed: ${err instanceof Error ? err.message : String(err)}`);
    info(`Run "eamilos status ${project.id}" to see project details`);
  } finally {
    await session.stop();
    eamilos.shutdown();
  }
}

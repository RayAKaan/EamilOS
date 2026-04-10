import { EamilOS } from '@eamilos/core';
import { header, success, info, kv, divider, error as printError } from '../ui.js';

interface RunOptions {
  template?: string;
  constraints?: string[];
  budget?: number;
  forceInit?: boolean;
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

  info('Executing task with agent...');
  
  try {
    const result = await eamilos.executeTask(task.id);

    divider();

    if (result.success) {
      success('Task completed successfully!');
      kv('Artifacts created', result.artifacts.length.toString());
      for (const artifact of result.artifacts) {
        kv('  File', artifact);
      }
      kv('Tool calls', result.toolCalls.toString());
    } else {
      printError('Task failed');
      if (result.error) {
        kv('Error', result.error);
      }
    }

    divider();
    info(`Run "eamilos status ${project.id}" to see project details`);
  } catch (err) {
    divider();
    printError(`Execution failed: ${err instanceof Error ? err.message : String(err)}`);
    info(`Run "eamilos status ${project.id}" to see project details`);
  }
}

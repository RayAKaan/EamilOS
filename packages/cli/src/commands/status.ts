import { EamilOS } from '@eamilos/core';
import {
  header,
  subheader,
  kv,
  statusBadge,
  taskStatusBadge,
  formatDate,
  formatCost,
  formatTokens,
  divider,
  info,
} from '../ui.js';

export async function status(eamilos: EamilOS, projectId?: string): Promise<void> {
  header('Project Status');

  if (!projectId) {
    const projects = eamilos.getAllProjects();

    if (projects.length === 0) {
      info('No projects found');
      return;
    }

    for (const project of projects) {
      subheader(project.name);
      kv('ID', project.id);
      kv('Status', statusBadge(project.status));
      kv('Tasks', `${project.completedTasks}/${project.totalTasks} completed`);
      kv('Created', formatDate(project.createdAt));
      if (project.budgetUsd) {
        kv('Budget', `${formatCost(project.totalCostUsd)} / ${formatCost(project.budgetUsd)}`);
      }
      divider();
    }
    return;
  }

  const project = eamilos.getProject(projectId);

  if (!project) {
    info(`Project not found: ${projectId}`);
    return;
  }

  subheader(project.name);
  kv('ID', project.id);
  kv('Status', statusBadge(project.status));
  kv('Goal', project.goal);
  kv('Tasks', `${project.completedTasks}/${project.totalTasks} completed`);
  if (project.failedTasks > 0) {
    kv('Failed', `${project.failedTasks}`);
  }
  kv('Created', formatDate(project.createdAt));
  if (project.startedAt) {
    kv('Started', formatDate(project.startedAt));
  }
  if (project.completedAt) {
    kv('Completed', formatDate(project.completedAt));
  }
  kv('Tokens Used', formatTokens(project.totalTokensUsed));
  kv('Cost', formatCost(project.totalCostUsd));
  if (project.budgetUsd) {
    kv('Budget', `${formatCost(project.totalCostUsd)} / ${formatCost(project.budgetUsd)}`);
  }

  divider();

  const tasks = eamilos.getProjectTasks(projectId);

  if (tasks.length > 0) {
    subheader('Tasks');
    for (const task of tasks) {
      console.log(`  ${taskStatusBadge(task.status)} ${task.title}`);
      kv('  Type', task.type);
      kv('  Priority', task.priority);
      if (task.assignedAgent) {
        kv('  Agent', task.assignedAgent);
      }
      if (task.error) {
        console.log(`  ${task.error}`);
      }
      console.log('');
    }
  }

  const events = eamilos.getProjectEvents(projectId, 10);

  if (events.length > 0) {
    divider();
    subheader('Recent Events');
    for (const event of events.slice(0, 5)) {
      console.log(`  ${formatDate(event.timestamp)} ${event.type}`);
      if (event.humanReadable) {
        console.log(`    ${event.humanReadable}`);
      }
    }
  }
}

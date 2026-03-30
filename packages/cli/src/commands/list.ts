import { EamilOS } from '@eamilos/core';
import { header, subheader, kv, statusBadge, formatDate, divider } from '../ui.js';

export async function list(eamilos: EamilOS): Promise<void> {
  header('All Projects');

  const projects = eamilos.getAllProjects();

  if (projects.length === 0) {
    console.log('  No projects found\n');
    return;
  }

  for (const project of projects) {
    subheader(project.name);
    kv('ID', project.id);
    kv('Status', statusBadge(project.status));
    kv('Goal', project.goal.length > 60 ? project.goal.substring(0, 57) + '...' : project.goal);
    kv('Tasks', `${project.completedTasks}/${project.totalTasks} completed`);
    if (project.failedTasks > 0) {
      kv('Failed', `${project.failedTasks}`);
    }
    kv('Created', formatDate(project.createdAt));
    divider();
  }
}

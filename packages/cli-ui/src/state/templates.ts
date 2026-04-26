export interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  prompt: string;
  agent?: string;
}

export const taskTemplates: TaskTemplate[] = [
  {
    id: 'bug-fix',
    name: 'Bug Fix',
    description: 'Template for fixing a bug',
    prompt: 'Fix the following bug in the codebase:\n\n[Bug Description]\n\nSteps to reproduce:\n1. \n2. \n3. \n\nExpected behavior:\n',
  },
  {
    id: 'refactor',
    name: 'Refactor',
    description: 'Template for code refactoring',
    prompt: 'Refactor the following code for:\n- Improved readability\n- Better performance\n- Cleaner architecture\n\nCode to refactor:\n',
  },
  {
    id: 'feature',
    name: 'New Feature',
    description: 'Template for implementing a feature',
    prompt: 'Implement a new feature:\n\nFeature name:\nDescription:\nRequirements:\n1. \n2. \n\nAcceptance criteria:\n',
  },
  {
    id: 'review',
    name: 'Code Review',
    description: 'Template for reviewing code',
    prompt: 'Review the following code changes:\n\nChanges:\n\nProvide feedback on:\n- Code quality\n- Potential bugs\n- Security concerns\n- Performance impact\n',
  },
  {
    id: 'docs',
    name: 'Documentation',
    description: 'Template for writing documentation',
    prompt: 'Write documentation for:\n\nTopic:\nAudience:\n\nInclude:\n- Overview\n- Usage examples\n- API reference\n',
  },
];

export const getTemplate = (id: string): TaskTemplate | undefined => {
  return taskTemplates.find(t => t.id === id);
};

export const createFromTemplate = (template: TaskTemplate): string => {
  return template.prompt;
};
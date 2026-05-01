export interface Template {
  id: string;
  name: string;
  description: string;
  category: 'web' | 'cli' | 'data' | 'mobile' | 'api' | 'custom';
  version: string;
  author: string;
  tags: string[];
  workflow: {
    name: string;
    steps: WorkflowStep[];
    continueOnFailure?: boolean;
  };
  files: TemplateFile[];
  postGenerate: PostGenerateConfig;
  variables: TemplateVariable[];
  estimatedCost: {
    min: number;
    max: number;
    currency: string;
  };
}

export interface WorkflowStep {
  phase: string;
  agent: string;
  prompt: string;
  expectedOutputs?: string[];
  timeout?: number;
}

export interface TemplateFile {
  path: string;
  template: string;
  agent?: string;
}

export interface PostGenerateConfig {
  commands: string[];
  installDeps: boolean;
  gitInit: boolean;
}

export interface TemplateVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'choice';
  description: string;
  default?: string | number | boolean;
  required: boolean;
  choices?: string[];
}

export interface TemplateExecutionResult {
  success: boolean;
  template: string;
  variables: Record<string, string | number | boolean>;
  steps: StepResult[];
  generatedFiles: string[];
  cost: number;
  tokens: number;
  error?: string;
}

export interface StepResult {
  phase: string;
  success: boolean;
  output?: string;
  artifacts?: string[];
  cost: number;
  tokens: number;
  duration: number;
  error?: string;
}

export type TemplateCategory = Template['category'];

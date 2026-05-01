import { Template, TemplateVariable } from './types.js';
import { reactAuthTemplate } from './builtins/react-auth.js';
import { microservicesTemplate } from './builtins/microservices.js';
import { cliToolTemplate } from './builtins/cli-tool.js';
import { dataPipelineTemplate } from './builtins/data-pipeline.js';
import { apiServerTemplate } from './builtins/api-server.js';

export class TemplateRegistry {
  private templates: Map<string, Template> = new Map();
  private userTemplates: Map<string, Template> = new Map();

  constructor() {
    this.registerBuiltin(reactAuthTemplate);
    this.registerBuiltin(microservicesTemplate);
    this.registerBuiltin(cliToolTemplate);
    this.registerBuiltin(dataPipelineTemplate);
    this.registerBuiltin(apiServerTemplate);
  }

  private registerBuiltin(template: Template): void {
    this.templates.set(template.id, template);
  }

  registerUserTemplate(template: Template): void {
    this.userTemplates.set(template.id, template);
  }

  unregisterUserTemplate(id: string): boolean {
    return this.userTemplates.delete(id);
  }

  getTemplate(id: string): Template | undefined {
    return this.templates.get(id) || this.userTemplates.get(id);
  }

  listTemplates(category?: Template['category']): Template[] {
    const all = [...this.templates.values(), ...this.userTemplates.values()];
    if (!category) return all;
    return all.filter(t => t.category === category);
  }

  searchTemplates(query: string): Template[] {
    const lower = query.toLowerCase();
    const all = [...this.templates.values(), ...this.userTemplates.values()];
    return all.filter(t =>
      t.id.toLowerCase().includes(lower) ||
      t.name.toLowerCase().includes(lower) ||
      t.description.toLowerCase().includes(lower) ||
      t.tags.some(tag => tag.toLowerCase().includes(lower))
    );
  }

  getRequiredVariables(id: string): TemplateVariable[] {
    const template = this.getTemplate(id);
    if (!template) return [];
    return template.variables.filter(v => v.required);
  }

  fillVariables(id: string, values: Record<string, string | number | boolean>): string {
    const template = this.getTemplate(id);
    if (!template) throw new Error(`Template not found: ${id}`);

    const resolved = { ...values };
    for (const variable of template.variables) {
      if (resolved[variable.name] === undefined && variable.default !== undefined) {
        resolved[variable.name] = variable.default;
      }
    }

    let content = '';
    for (const file of template.files) {
      let rendered = file.template;
      for (const [key, value] of Object.entries(resolved)) {
        rendered = rendered.replaceAll(`{{${key}}}`, String(value));
      }
      content += `// File: ${file.path}\n${rendered}\n\n`;
    }

    return content;
  }

  getTemplateCount(): number {
    return this.templates.size + this.userTemplates.size;
  }
}

let globalTemplateRegistry: TemplateRegistry | null = null;

export function initTemplateRegistry(): TemplateRegistry {
  globalTemplateRegistry = new TemplateRegistry();
  return globalTemplateRegistry;
}

export function getTemplateRegistry(): TemplateRegistry {
  if (!globalTemplateRegistry) {
    return initTemplateRegistry();
  }
  return globalTemplateRegistry;
}

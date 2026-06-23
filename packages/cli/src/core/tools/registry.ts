import { ToolDefinition, ToolRegistry } from './types.js';
import { workspaceWriteTool } from './workspace-write.js';
import { workspaceReadTool } from './workspace-read.js';
import { workspaceListTool } from './workspace-list.js';
import { logDecisionTool } from './log-decision.js';

export class ToolRegistryManager {
  private registry: ToolRegistry = new Map();
  private static instance: ToolRegistryManager | null = null;

  private constructor() {
    this.registerBuiltInTools();
  }

  static getInstance(): ToolRegistryManager {
    if (!ToolRegistryManager.instance) {
      ToolRegistryManager.instance = new ToolRegistryManager();
    }
    return ToolRegistryManager.instance;
  }

  private registerBuiltInTools(): void {
    this.register(workspaceWriteTool);
    this.register(workspaceReadTool);
    this.register(workspaceListTool);
    this.register(logDecisionTool);
  }

  register(tool: ToolDefinition): void {
    this.registry.set(tool.name, tool);
  }

  unregister(name: string): boolean {
    return this.registry.delete(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.registry.get(name);
  }

  has(name: string): boolean {
    return this.registry.has(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.registry.values());
  }

  listNames(): string[] {
    return Array.from(this.registry.keys());
  }

  getAllToolsSchema(): { name: string; description: string }[] {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));
  }
}

export function getToolRegistry(): ToolRegistryManager {
  return ToolRegistryManager.getInstance();
}

export function registerTool(tool: ToolDefinition): void {
  getToolRegistry().register(tool);
}

export function getTool(name: string): ToolDefinition | undefined {
  return getToolRegistry().get(name);
}

export function listTools(): ToolDefinition[] {
  return getToolRegistry().list();
}

export function getToolSchemas(): { name: string; description: string }[] {
  return getToolRegistry().getAllToolsSchema();
}

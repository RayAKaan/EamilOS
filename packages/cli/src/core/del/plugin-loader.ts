import { readdir, access, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import {
  PluginManifest,
  PluginStatus,
  PluginRegistration,
  PluginPermission,
  PluginHooks,
  ToolDefinition,
  ToolExecutionContext,
} from './platform-types.js';
import { ProviderDriver } from './provider-types.js';
import { AgentDefinition } from './multi-agent-types.js';
import { EventEmitter } from 'events';

export interface PluginConfig {
  pluginDir: string;
  enableSandbox: boolean;
  maxMemoryMB: number;
  pluginTimeoutMs: number;
}

const DEFAULT_PLUGIN_CONFIG: PluginConfig = {
  pluginDir: process.env.EAMILOS_PLUGIN_DIR || join(process.env.HOME || process.cwd(), '.eamilos', 'plugins'),
  enableSandbox: true,
  maxMemoryMB: 512,
  pluginTimeoutMs: 60000,
};

export interface PluginLoadResult {
  success: boolean;
  registration?: PluginRegistration;
  error?: string;
}

export class PluginLoader extends EventEmitter {
  private config: PluginConfig;
  private plugins: Map<string, PluginRegistration> = new Map();
  private tools: Map<string, ToolDefinition> = new Map();
  private hooks: Map<string, PluginHooks> = new Map();

  constructor(config?: Partial<PluginConfig>) {
    super();
    this.config = { ...DEFAULT_PLUGIN_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    await this.loadAll();
  }

  async discoverPlugins(): Promise<string[]> {
    try {
      await access(this.config.pluginDir);
    } catch {
      return [];
    }

    const entries = await readdir(this.config.pluginDir, { withFileTypes: true });
    const pluginDirs = entries
      .filter(e => e.isDirectory())
      .map(e => join(this.config.pluginDir, e.name));

    return pluginDirs;
  }

  private async loadAll(): Promise<void> {
    const pluginDirs = await this.discoverPlugins();

    for (const dir of pluginDirs) {
      const result = await this.loadPlugin(dir);
      if (result.success && result.registration) {
        this.emit('plugin.loaded', result.registration);
      }
    }
  }

  async loadPlugin(pluginPath: string): Promise<PluginLoadResult> {
    const manifest = await this.loadManifest(pluginPath);

    if (!manifest) {
      return { success: false, error: 'Invalid manifest' };
    }

    const validationError = this.validateManifest(manifest);
    if (validationError) {
      return { success: false, error: validationError };
    }

    const existing = this.plugins.get(manifest.name);
    if (existing) {
      return { success: false, error: `Plugin ${manifest.name} already loaded` };
    }

    const module = await this.importPlugin(pluginPath, manifest);

    const registration: PluginRegistration = {
      name: manifest.name,
      version: manifest.version,
      manifest,
      status: 'loading',
      loadedAt: Date.now(),
    };

    try {
      const providers = module.providers as Array<ProviderDriver> | undefined;
      if (providers && Array.isArray(providers)) {
        for (const provider of providers) {
          this.emit('provider.available', { plugin: manifest.name, provider });
        }
      }

      const agents = module.agents as Array<AgentDefinition> | undefined;
      if (agents && Array.isArray(agents)) {
        for (const agent of agents) {
          this.emit('agent.available', { plugin: manifest.name, agent });
        }
      }

      const tools = module.tools as Array<ToolDefinition> | undefined;
      if (tools && Array.isArray(tools)) {
        for (const tool of tools) {
          this.registerTool(tool, manifest.name);
        }
      }

      const hooks = module.hooks as PluginHooks | undefined;
      if (hooks) {
        this.hooks.set(manifest.name, hooks);
      }

      registration.status = 'active';
      this.plugins.set(manifest.name, registration);
      this.emit('plugin.registered', registration);

      return { success: true, registration };
    } catch (error) {
      registration.status = 'crashed';
      this.emit('plugin.error', { name: manifest.name, error });
      return { success: false, error: error instanceof Error ? error.message : 'Load failed' };
    }
  }

  private async loadManifest(pluginPath: string): Promise<PluginManifest | null> {
    const manifestPath = resolve(pluginPath, 'plugin.json');

    try {
      await access(manifestPath);
    } catch {
      return null;
    }

    const content = await readFile(manifestPath, 'utf-8');
    return JSON.parse(content) as PluginManifest;
  }

  private validateManifest(manifest: PluginManifest): string | null {
    if (!manifest.name || manifest.name.length === 0) {
      return 'Plugin name is required';
    }

    if (!manifest.version) {
      return 'Plugin version is required';
    }

    if (!manifest.permissions || !Array.isArray(manifest.permissions)) {
      return 'Plugin permissions are required';
    }

    for (const perm of manifest.permissions) {
      const validPermissions: PluginPermission[] = [
        'read_context',
        'write_context',
        'execute_tool',
        'network_access',
        'filesystem_read',
        'filesystem_write',
      ];
      if (!validPermissions.includes(perm)) {
        return `Invalid permission: ${perm}`;
      }
    }

    return null;
  }

  private async importPlugin(pluginPath: string, manifest: PluginManifest): Promise<Record<string, unknown>> {
    const entryPath = resolve(pluginPath, manifest.entry || 'index.js');

    try {
      await access(entryPath);
    } catch {
      return { default: {} };
    }

    const module = await import(entryPath);
    return (module.default || module) as Record<string, unknown>;
  }

  registerTool(tool: ToolDefinition, pluginName: string): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool ${tool.name} already registered`);
    }

    this.tools.set(tool.name, tool);
    this.emit('tool.registered', { name: tool.name, plugin: pluginName });
  }

  async executeTool(
    toolName: string,
    input: unknown,
    context: ToolExecutionContext
  ): Promise<unknown> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Tool ${toolName} not found`);
    }

    this.emit('tool.execution.start', { tool: toolName });

    try {
      const result = await tool.execute(input, context);
      this.emit('tool.execution.complete', { tool: toolName });
      return result;
    } catch (error) {
      this.emit('tool.execution.error', { tool: toolName, error });
      throw error;
    }
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  hasToolPermission(toolName: string, _permission: PluginPermission): boolean {
    const tool = this.tools.get(toolName);
    if (!tool) return false;

    return true;
  }

  getHooks(pluginName: string): PluginHooks | undefined {
    return this.hooks.get(pluginName);
  }

  getAllHooks(): Map<string, PluginHooks> {
    return this.hooks;
  }

  getPlugin(name: string): PluginRegistration | undefined {
    return this.plugins.get(name);
  }

  getPluginByStatus(status: PluginStatus): PluginRegistration[] {
    return Array.from(this.plugins.values()).filter(p => p.status === status);
  }

  async unloadPlugin(name: string): Promise<boolean> {
    const registration = this.plugins.get(name);
    if (!registration) {
      return false;
    }

    const manifest = registration.manifest;
    if (manifest.tools) {
      for (const tool of manifest.tools) {
        this.tools.delete(tool.name);
      }
    }

    this.hooks.delete(name);
    registration.status = 'disabled';
    this.plugins.delete(name);

    this.emit('plugin.unloaded', name);
    return true;
  }

  async reloadPlugin(name: string): Promise<PluginLoadResult> {
    const existing = this.plugins.get(name);
    if (!existing) {
      return { success: false, error: 'Plugin not found' };
    }

    await this.unloadPlugin(name);

    return this.loadPlugin(resolve(this.config.pluginDir, name));
  }

  getPluginCount(): number {
    return this.plugins.size;
  }

  getToolCount(): number {
    return this.tools.size;
  }

  close(): void {
    for (const [name] of this.plugins) {
      this.unloadPlugin(name);
    }
    this.removeAllListeners();
  }
}

let globalLoader: PluginLoader | null = null;

export async function initPluginLoader(config?: Partial<PluginConfig>): Promise<PluginLoader> {
  const loader = new PluginLoader(config);
  await loader.initialize();
  globalLoader = loader;
  return loader;
}

export function getPluginLoader(): PluginLoader {
  if (!globalLoader) {
    throw new Error('Plugin loader not initialized. Call initPluginLoader() first.');
  }
  return globalLoader;
}
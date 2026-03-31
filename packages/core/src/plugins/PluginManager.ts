import * as fs from 'fs';
import * as path from 'path';
import {
  PluginContext,
  PluginInfo,
  PluginHealthStatus,
  PluginManifest,
  PluginStorage,
  PluginEvent,
  PluginEventHandler,
  AgentDefinition,
  PluginToolDefinition,
  ProviderDefinition,
  HttpRequestOptions,
  HttpResponse,
  ModelMetrics
} from './types.js';
import { PluginLoader, LoadedPlugin } from './PluginLoader.js';
import { PluginSandbox } from './Sandbox.js';
import { EventBus } from './EventBus.js';
import { SecureLogger } from '../security/SecureLogger.js';
import { FeatureManager } from '../features/FeatureManager.js';

export class PluginManager {
  private loader: PluginLoader;
  private logger: SecureLogger;
  private featureManager: FeatureManager;
  private eventBus: EventBus;
  private workspaceRoot: string;
  private config: Record<string, unknown>;
  private coreVersion: string;

  private loadedPlugins: Map<string, LoadedPlugin> = new Map();
  private contexts: Map<string, PluginContext> = new Map();
  private sandboxes: Map<string, PluginSandbox> = new Map();

  constructor(options: {
    pluginsDir?: string;
    workspaceRoot: string;
    coreVersion: string;
    config: Record<string, unknown>;
    featureManager: FeatureManager;
    eventBus: EventBus;
    logger: SecureLogger;
  }) {
    this.workspaceRoot = options.workspaceRoot;
    this.coreVersion = options.coreVersion;
    this.config = options.config;
    this.featureManager = options.featureManager;
    this.eventBus = options.eventBus;
    this.logger = options.logger;

    this.loader = new PluginLoader(
      options.pluginsDir,
      options.coreVersion,
      options.logger
    );
  }

  async loadAll(): Promise<{
    total: number;
    loaded: number;
    failed: number;
    plugins: PluginInfo[];
  }> {
    const loadResults = await this.loader.discoverAndLoad();

    for (const result of loadResults) {
      if (result.status !== "loaded") {
        this.loadedPlugins.set(result.manifest.id, result);
        continue;
      }

      this.loadedPlugins.set(result.manifest.id, result);

      const sandbox = new PluginSandbox(
        result.manifest.id,
        result.manifest.permissions,
        this.logger
      );
      this.sandboxes.set(result.manifest.id, sandbox);

      const ctx = this.createSandboxedContext(result.manifest, sandbox);
      this.contexts.set(result.manifest.id, ctx);

      try {
        const pluginConfig = this.getPluginConfig(result.manifest.id);

        if (pluginConfig.enabled === false) {
          result.status = "disabled";
          this.logger.log("info", `Plugin disabled by config: ${result.manifest.id}`);
          continue;
        }

        await result.instance.register(ctx, pluginConfig);

        this.logger.log("info", `Plugin registered: ${result.manifest.id}`, {
          type: result.manifest.type,
          riskLevel: result.manifest.riskLevel
        });

        this.eventBus.emit("plugin.loaded", {
          pluginId: result.manifest.id,
          version: result.manifest.version,
          type: result.manifest.type
        });

      } catch (error) {
        result.status = "failed";
        result.error = `Registration failed: ${error instanceof Error ? error.message : String(error)}`;
        this.logger.log("warn", `Plugin registration failed: ${result.manifest.id}`, {
          error: result.error
        });
      }
    }

    const loaded = [...this.loadedPlugins.values()].filter(p => p.status === "loaded");
    const failed = [...this.loadedPlugins.values()].filter(p => p.status === "failed");

    return {
      total: loadResults.length,
      loaded: loaded.length,
      failed: failed.length,
      plugins: this.listPlugins()
    };
  }

  async unloadPlugin(pluginId: string): Promise<boolean> {
    const plugin = this.loadedPlugins.get(pluginId);
    if (!plugin) return false;

    try {
      if (plugin.instance.unregister) {
        await plugin.instance.unregister();
      }
    } catch (error) {
      this.logger.log("warn", `Plugin unregister error: ${pluginId}`, {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    this.eventBus.removePluginListeners(pluginId);
    this.loadedPlugins.delete(pluginId);
    this.contexts.delete(pluginId);
    this.sandboxes.delete(pluginId);

    this.eventBus.emit("plugin.unloaded", { pluginId });
    return true;
  }

  async unloadAll(): Promise<void> {
    for (const pluginId of [...this.loadedPlugins.keys()]) {
      await this.unloadPlugin(pluginId);
    }
  }

  listPlugins(): PluginInfo[] {
    return [...this.loadedPlugins.values()]
      .filter(p => p.status === "loaded" || p.status === "disabled")
      .map(p => ({
        id: p.manifest.id,
        version: p.manifest.version,
        name: p.manifest.name,
        type: p.manifest.type,
        enabled: p.status !== "disabled",
        riskLevel: p.manifest.riskLevel || "safe"
      }));
  }

  getPlugin(pluginId: string): LoadedPlugin | undefined {
    return this.loadedPlugins.get(pluginId);
  }

  async healthCheck(): Promise<Record<string, PluginHealthStatus>> {
    const results: Record<string, PluginHealthStatus> = {};

    for (const [id, plugin] of this.loadedPlugins) {
      if (plugin.instance.healthCheck) {
        try {
          results[id] = await plugin.instance.healthCheck();
        } catch (error) {
          results[id] = {
            healthy: false,
            message: `Health check threw: ${error instanceof Error ? error.message : String(error)}`
          };
        }
      } else {
        results[id] = {
          healthy: plugin.status === "loaded",
          message: plugin.status === "loaded" ? "No health check implemented" : `Status: ${plugin.status}`
        };
      }
    }

    return results;
  }

  async installFromPath(sourcePath: string): Promise<{
    success: boolean;
    pluginId?: string;
    error?: string;
  }> {
    try {
      if (!fs.existsSync(sourcePath)) {
        return { success: false, error: `Path not found: ${sourcePath}` };
      }

      const packageJsonPath = path.join(sourcePath, "package.json");
      if (!fs.existsSync(packageJsonPath)) {
        return { success: false, error: "No package.json in source directory" };
      }

      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      if (!packageJson.eamilos?.id) {
        return { success: false, error: "No eamilos.id in package.json" };
      }

      const pluginId = packageJson.eamilos.id;
      const pluginsDir = this.loader.pluginsDir;
      const targetDir = path.join(pluginsDir, pluginId);

      if (this.loadedPlugins.has(pluginId)) {
        await this.unloadPlugin(pluginId);
      }

      fs.cpSync(sourcePath, targetDir, { recursive: true });

      const loaded = await this.loader.loadSinglePlugin(targetDir);
      if (loaded.status === "loaded") {
        this.loadedPlugins.set(loaded.manifest.id, loaded);

        const sandbox = new PluginSandbox(loaded.manifest.id, loaded.manifest.permissions, this.logger);
        this.sandboxes.set(loaded.manifest.id, sandbox);

        const ctx = this.createSandboxedContext(loaded.manifest, sandbox);
        this.contexts.set(loaded.manifest.id, ctx);

        const pluginConfig = this.getPluginConfig(loaded.manifest.id);
        await loaded.instance.register(ctx, pluginConfig);
      }

      return {
        success: loaded.status === "loaded",
        pluginId,
        error: loaded.error
      };

    } catch (error) {
      return {
        success: false,
        error: `Install failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  async removePlugin(pluginId: string): Promise<boolean> {
    await this.unloadPlugin(pluginId);

    const pluginsDir = this.loader.pluginsDir;
    const pluginDir = path.join(pluginsDir, pluginId);
    if (fs.existsSync(pluginDir)) {
      fs.rmSync(pluginDir, { recursive: true });
      this.logger.log("info", `Plugin removed from disk: ${pluginId}`);
      return true;
    }

    return false;
  }

  private createSandboxedContext(
    manifest: PluginManifest,
    sandbox: PluginSandbox
  ): PluginContext {
    const self = this;

    return {
      registerFeature(feature): void {
        if (manifest.type !== "feature" && manifest.type !== "composite") {
          throw new Error(`Plugin type '${manifest.type}' cannot register features`);
        }
        self.featureManager.register(feature);
      },

      registerAgent(agent: AgentDefinition): void {
        if (manifest.type !== "agent" && manifest.type !== "composite") {
          throw new Error(`Plugin type '${manifest.type}' cannot register agents`);
        }
        self.logger.log("info", `Agent registered by plugin: ${agent.id}`);
      },

      registerTool(tool: PluginToolDefinition): void {
        if (manifest.type !== "tool" && manifest.type !== "composite") {
          throw new Error(`Plugin type '${manifest.type}' cannot register tools`);
        }
        self.logger.log("info", `Tool registered by plugin: ${tool.id}`);
      },

      registerHook(event: PluginEvent, handler: PluginEventHandler): void {
        sandbox.assertHookAccess();
        self.eventBus.on(event, handler, manifest.id);
      },

      registerCommand(command): void {
        self.logger.log("info", `CLI command registered by plugin: ${command.name}`);
      },

      registerProvider(provider: ProviderDefinition): void {
        if (manifest.type !== "provider" && manifest.type !== "composite") {
          throw new Error(`Plugin type '${manifest.type}' cannot register providers`);
        }
        self.logger.log("info", `Provider registered by plugin: ${provider.id}`);
      },

      async readWorkspaceFile(relativePath: string): Promise<string> {
        sandbox.assertWorkspaceRead();
        const safePath = sandbox.validateWorkspacePath(relativePath, self.workspaceRoot);
        return fs.readFileSync(safePath, "utf-8");
      },

      async writeWorkspaceFile(relativePath: string, content: string): Promise<void> {
        sandbox.assertWorkspaceWrite();
        const safePath = sandbox.validateWorkspacePath(relativePath, self.workspaceRoot);
        const dir = path.dirname(safePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(safePath, content, "utf-8");
      },

      async listWorkspaceFiles(directory?: string): Promise<string[]> {
        sandbox.assertWorkspaceRead();
        const dir = directory
          ? sandbox.validateWorkspacePath(directory, self.workspaceRoot)
          : self.workspaceRoot;
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir);
      },

      async httpRequest(url: string, options: HttpRequestOptions): Promise<HttpResponse> {
        sandbox.assertNetworkAccess(url);
        const response = await fetch(url, {
          method: options.method,
          headers: options.headers,
          body: typeof options.body === "string"
            ? options.body
            : JSON.stringify(options.body),
          signal: options.timeoutMs
            ? AbortSignal.timeout(options.timeoutMs)
            : undefined
        });
        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: await response.text()
        };
      },

      async getModelMetrics(_modelId: string): Promise<ModelMetrics | null> {
        sandbox.assertMetricsRead();
        return null;
      },

      async getAllModelMetrics(): Promise<ModelMetrics[]> {
        sandbox.assertMetricsRead();
        return [];
      },

      log(level, message, data?): void {
        self.logger.log(level, `[plugin:${manifest.id}] ${message}`, data);
      },

      getStorage(): PluginStorage {
        const storageDir = path.join(self.workspaceRoot, ".eamilos", "plugin-data", manifest.id);
        return new FilePluginStorage(storageDir);
      },

      getCoreVersion(): string {
        return self.coreVersion;
      },

      getConfig(): Record<string, unknown> {
        const sanitized = { ...self.config };
        delete sanitized.secrets;
        delete sanitized.apiKeys;
        return sanitized;
      },

      getInstalledPlugins(): PluginInfo[] {
        return self.listPlugins();
      }
    };
  }

  private getPluginConfig(pluginId: string): Record<string, unknown> {
    const plugins = (this.config.plugins || {}) as Record<string, Record<string, unknown>>;
    return plugins[pluginId] || { enabled: true };
  }
}

export class FilePluginStorage implements PluginStorage {
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  async get(key: string): Promise<unknown | null> {
    const filePath = path.join(this.dir, this.sanitizeKey(key) + ".json");
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  }

  async set(key: string, value: unknown): Promise<void> {
    const filePath = path.join(this.dir, this.sanitizeKey(key) + ".json");
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(this.dir, this.sanitizeKey(key) + ".json");
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  async list(): Promise<string[]> {
    return fs.readdirSync(this.dir)
      .filter(f => f.endsWith(".json"))
      .map(f => f.replace(/\.json$/, ""));
  }

  async clear(): Promise<void> {
    const files = fs.readdirSync(this.dir);
    for (const file of files) {
      fs.unlinkSync(path.join(this.dir, file));
    }
  }

  private sanitizeKey(key: string): string {
    return key.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 200);
  }
}

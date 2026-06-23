import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EamilOSPlugin, PluginManifest, PluginPermissions, PluginType, DEFAULT_PERMISSIONS } from './types.js';
import { PluginSandbox } from './Sandbox.js';
import { SecureLogger } from '../security/SecureLogger.js';

export interface LoadedPlugin {
  manifest: PluginManifest;
  instance: EamilOSPlugin;
  directory: string;
  loadedAt: string;
  status: "loaded" | "failed" | "disabled";
  error?: string;
}

export class PluginLoader {
  private _pluginsDir: string;
  private logger: SecureLogger;
  private coreVersion: string;

  constructor(
    pluginsDir: string = path.join(os.homedir(), ".eamilos", "plugins", "installed"),
    coreVersion: string = "1.0.0",
    logger: SecureLogger
  ) {
    this._pluginsDir = pluginsDir;
    this.coreVersion = coreVersion;
    this.logger = logger;
  }

  get pluginsDir(): string {
    return this._pluginsDir;
  }

  async discoverAndLoad(): Promise<LoadedPlugin[]> {
    const results: LoadedPlugin[] = [];

    if (!fs.existsSync(this._pluginsDir)) {
      fs.mkdirSync(this._pluginsDir, { recursive: true });
      this.logger.log("debug", "Created plugins directory", { path: this._pluginsDir });
      return results;
    }

    const entries = fs.readdirSync(this._pluginsDir, { withFileTypes: true });
    const pluginDirs = entries.filter(e => e.isDirectory());

    this.logger.log("info", `Scanning for plugins`, {
      directory: this._pluginsDir,
      candidatesFound: pluginDirs.length
    });

    for (const dir of pluginDirs) {
      const pluginPath = path.join(this._pluginsDir, dir.name);
      const result = await this.loadSinglePlugin(pluginPath);
      results.push(result);
    }

    const loaded = results.filter(r => r.status === "loaded");
    const failed = results.filter(r => r.status === "failed");

    this.logger.log("info", `Plugin loading complete`, {
      total: results.length,
      loaded: loaded.length,
      failed: failed.length,
      failedPlugins: failed.map(f => ({ dir: path.basename(f.directory), error: f.error }))
    });

    return results;
  }

  async loadSinglePlugin(pluginPath: string): Promise<LoadedPlugin> {
    const dirName = path.basename(pluginPath);

    try {
      const packageJsonPath = path.join(pluginPath, "package.json");
      if (!fs.existsSync(packageJsonPath)) {
        return this.failedPlugin(pluginPath, `No package.json found in ${dirName}`);
      }

      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      const manifest = this.extractManifest(packageJson, dirName);

      if (!manifest.valid) {
        return this.failedPlugin(pluginPath, manifest.error);
      }

      if (!this.isCompatible(manifest.data!.coreVersion)) {
        return this.failedPlugin(pluginPath,
          `Plugin requires EamilOS ${manifest.data!.coreVersion} but current version is ${this.coreVersion}`
        );
      }

      const entryPath = path.resolve(pluginPath, manifest.data!.entry);

      if (!entryPath.startsWith(pluginPath)) {
        return this.failedPlugin(pluginPath,
          `Entry point escapes plugin directory: ${manifest.data!.entry}`
        );
      }

      if (!fs.existsSync(entryPath)) {
        return this.failedPlugin(pluginPath,
          `Entry point not found: ${manifest.data!.entry} (resolved to ${entryPath})`
        );
      }

      const module = await import(entryPath);
      const pluginExport = module.default || module;

      if (!this.isValidPlugin(pluginExport)) {
        return this.failedPlugin(pluginPath,
          `Export does not implement EamilOSPlugin interface (missing id, type, or register method)`
        );
      }

      if (pluginExport.id !== manifest.data!.id) {
        return this.failedPlugin(pluginPath,
          `Plugin ID mismatch: manifest says '${manifest.data!.id}' but export says '${pluginExport.id}'`
        );
      }

      manifest.data!.riskLevel = PluginSandbox.computeRiskLevel(manifest.data!.permissions);

      this.logger.log("info", `Plugin loaded: ${manifest.data!.id}`, {
        version: manifest.data!.version,
        type: manifest.data!.type,
        riskLevel: manifest.data!.riskLevel
      });

      return {
        manifest: manifest.data!,
        instance: pluginExport as EamilOSPlugin,
        directory: pluginPath,
        loadedAt: new Date().toISOString(),
        status: "loaded"
      };

    } catch (error) {
      return this.failedPlugin(pluginPath,
        `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private extractManifest(
    packageJson: Record<string, unknown>,
    dirName: string
  ): { valid: boolean; data?: PluginManifest; error: string } {
    const eamilos = packageJson.eamilos as Record<string, unknown> | undefined;

    if (!eamilos) {
      return { valid: false, error: `No 'eamilos' section in package.json of ${dirName}` };
    }

    const required = ["id", "type", "entry"];
    for (const field of required) {
      if (!eamilos[field]) {
        return { valid: false, error: `Missing required field 'eamilos.${field}' in ${dirName}` };
      }
    }

    const validTypes: PluginType[] = ["feature", "agent", "tool", "hook", "provider", "formatter", "composite"];
    if (!validTypes.includes(eamilos.type as PluginType)) {
      return { valid: false, error: `Invalid plugin type '${eamilos.type}' in ${dirName}. Must be one of: ${validTypes.join(", ")}` };
    }

    const manifest: PluginManifest = {
      id: eamilos.id as string,
      version: (packageJson.version as string) || "0.0.0",
      name: (eamilos.name as string) || (packageJson.name as string) || dirName,
      description: (eamilos.description as string) || (packageJson.description as string) || "",
      author: (packageJson.author as string) || "unknown",
      license: (packageJson.license as string) || "UNLICENSED",
      type: eamilos.type as PluginType,
      entry: eamilos.entry as string,
      coreVersion: (eamilos.coreVersion as string) || ">=0.0.0",
      permissions: {
        ...DEFAULT_PERMISSIONS,
        ...((eamilos.permissions as Partial<PluginPermissions>) || {})
      },
      dependencies: (eamilos.dependencies as string[]) || [],
      conflicts: (eamilos.conflicts as string[]) || [],
      configSchema: (eamilos.configSchema as any) || undefined
    };

    return { valid: true, data: manifest, error: "" };
  }

  private isCompatible(requiredVersion: string): boolean {
    try {
      const required = requiredVersion.replace(/[>=<^~]/g, "");
      const current = this.coreVersion;

      const reqParts = required.split(".").map(Number);
      const curParts = current.split(".").map(Number);

      for (let i = 0; i < 3; i++) {
        if ((curParts[i] || 0) > (reqParts[i] || 0)) return true;
        if ((curParts[i] || 0) < (reqParts[i] || 0)) return false;
      }
      return true;
    } catch {
      return true;
    }
  }

  private isValidPlugin(obj: unknown): boolean {
    if (typeof obj !== "object" || obj === null) return false;
    const plugin = obj as Record<string, unknown>;
    return (
      typeof plugin.id === "string" &&
      typeof plugin.type === "string" &&
      typeof plugin.register === "function"
    );
  }

  private failedPlugin(directory: string, error: string): LoadedPlugin {
    this.logger.log("warn", `Plugin load failed: ${path.basename(directory)}`, { error });
    return {
      manifest: { id: path.basename(directory) } as PluginManifest,
      instance: null as unknown as EamilOSPlugin,
      directory,
      loadedAt: new Date().toISOString(),
      status: "failed",
      error
    };
  }
}

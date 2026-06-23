import * as path from 'path';
import { PluginPermissions, DEFAULT_PERMISSIONS } from './types.js';
import { SecureLogger } from '../security/SecureLogger.js';

export class PluginPermissionError extends Error {
  constructor(
    public pluginId: string,
    public permission: string,
    public action: string
  ) {
    super(
      `Plugin '${pluginId}' attempted '${action}' but lacks '${permission}' permission. ` +
      `Add '${permission}: true' to the plugin manifest to grant this permission.`
    );
    this.name = "PluginPermissionError";
  }
}

export class PluginSandbox {
  private pluginId: string;
  private permissions: PluginPermissions;
  private logger: SecureLogger;
  private violations: Array<{
    timestamp: string;
    permission: string;
    action: string;
  }> = [];

  constructor(
    pluginId: string,
    permissions: PluginPermissions,
    logger: SecureLogger
  ) {
    this.pluginId = pluginId;
    this.permissions = { ...DEFAULT_PERMISSIONS, ...permissions };
    this.logger = logger;
  }

  assertWorkspaceRead(): void {
    if (!this.permissions.workspaceRead) {
      this.recordViolation("workspaceRead", "read workspace file");
      throw new PluginPermissionError(this.pluginId, "workspaceRead", "read workspace file");
    }
  }

  assertWorkspaceWrite(): void {
    if (!this.permissions.workspaceWrite) {
      this.recordViolation("workspaceWrite", "write workspace file");
      throw new PluginPermissionError(this.pluginId, "workspaceWrite", "write workspace file");
    }
  }

  assertFilesystemRead(): void {
    if (!this.permissions.filesystemRead) {
      this.recordViolation("filesystemRead", "read filesystem");
      throw new PluginPermissionError(this.pluginId, "filesystemRead", "read file outside workspace");
    }
  }

  assertFilesystemWrite(): void {
    if (!this.permissions.filesystemWrite) {
      this.recordViolation("filesystemWrite", "write filesystem");
      throw new PluginPermissionError(this.pluginId, "filesystemWrite", "write file outside workspace");
    }
  }

  assertNetworkAccess(urlToCheck: string): void {
    if (!this.permissions.networkAccess) {
      this.recordViolation("networkAccess", `HTTP request to ${urlToCheck}`);
      throw new PluginPermissionError(this.pluginId, "networkAccess", `make HTTP request to ${urlToCheck}`);
    }

    if (this.permissions.allowedHosts.length > 0) {
      let hostname: string;
      try {
        hostname = new URL(urlToCheck).hostname;
      } catch {
        this.recordViolation("allowedHosts", `invalid URL: ${urlToCheck}`);
        throw new PluginPermissionError(
          this.pluginId,
          `networkAccess (invalid URL)`,
          `make HTTP request to invalid URL: ${urlToCheck}`
        );
      }
      if (!this.permissions.allowedHosts.includes(hostname)) {
        this.recordViolation("allowedHosts", `HTTP request to ${hostname}`);
        throw new PluginPermissionError(
          this.pluginId,
          `networkAccess (host '${hostname}' not in allowedHosts)`,
          `make HTTP request to ${hostname}`
        );
      }
    }
  }

  assertShellAccess(command: string): void {
    if (!this.permissions.shellAccess) {
      this.recordViolation("shellAccess", `execute: ${command}`);
      throw new PluginPermissionError(this.pluginId, "shellAccess", `execute command: ${command}`);
    }

    if (this.permissions.allowedCommands.length > 0) {
      const baseCommand = command.split(/\s+/)[0];
      if (!this.permissions.allowedCommands.includes(baseCommand)) {
        this.recordViolation("allowedCommands", `execute: ${baseCommand}`);
        throw new PluginPermissionError(
          this.pluginId,
          `shellAccess (command '${baseCommand}' not in allowedCommands)`,
          `execute command: ${baseCommand}`
        );
      }
    }
  }

  assertEnvAccess(varName: string): void {
    if (!this.permissions.envAccess) {
      this.recordViolation("envAccess", `read env: ${varName}`);
      throw new PluginPermissionError(this.pluginId, "envAccess", `read environment variable: ${varName}`);
    }

    if (this.permissions.allowedEnvVars.length > 0) {
      if (!this.permissions.allowedEnvVars.includes(varName)) {
        this.recordViolation("allowedEnvVars", `read env: ${varName}`);
        throw new PluginPermissionError(
          this.pluginId,
          `envAccess (variable '${varName}' not in allowedEnvVars)`,
          `read environment variable: ${varName}`
        );
      }
    }

    const secretPatterns = /api[_-]?key|secret|token|password|credential|private[_-]?key/i;
    if (secretPatterns.test(varName)) {
      this.recordViolation("envAccess", `BLOCKED secret access: ${varName}`);
      throw new PluginPermissionError(
        this.pluginId,
        "envAccess (secret variables are never accessible to plugins)",
        `read secret variable: ${varName}`
      );
    }
  }

  assertMetricsRead(): void {
    if (!this.permissions.metricsRead) {
      this.recordViolation("metricsRead", "read metrics");
      throw new PluginPermissionError(this.pluginId, "metricsRead", "read model metrics");
    }
  }

  assertMetricsWrite(): void {
    if (!this.permissions.metricsWrite) {
      this.recordViolation("metricsWrite", "write metrics");
      throw new PluginPermissionError(this.pluginId, "metricsWrite", "write model metrics");
    }
  }

  assertHookAccess(): void {
    if (!this.permissions.hookAccess) {
      this.recordViolation("hookAccess", "register hook");
      throw new PluginPermissionError(this.pluginId, "hookAccess", "register event hook");
    }
  }

  validateWorkspacePath(relativePath: string, workspaceRoot: string): string {
    const resolved = path.resolve(workspaceRoot, relativePath);

    if (!resolved.startsWith(workspaceRoot + path.sep) && resolved !== workspaceRoot) {
      this.recordViolation("pathEscape", `path escape attempt: ${relativePath}`);
      throw new PluginPermissionError(
        this.pluginId,
        "workspaceRead/workspaceWrite",
        `access path outside workspace: ${relativePath} (resolved to ${resolved})`
      );
    }

    if (relativePath.includes("..")) {
      this.recordViolation("pathTraversal", `traversal attempt: ${relativePath}`);
      throw new PluginPermissionError(
        this.pluginId,
        "workspaceRead/workspaceWrite",
        `path traversal attempt: ${relativePath}`
      );
    }

    return resolved;
  }

  static computeRiskLevel(permissions: PluginPermissions): "safe" | "moderate" | "elevated" | "dangerous" {
    if (permissions.shellAccess && permissions.allowedCommands.length === 0) return "dangerous";
    if (permissions.filesystemWrite) return "dangerous";
    if (permissions.networkAccess && permissions.allowedHosts.length === 0) return "dangerous";

    if (permissions.shellAccess) return "elevated";
    if (permissions.networkAccess) return "elevated";
    if (permissions.envAccess) return "elevated";

    if (permissions.workspaceWrite) return "moderate";
    if (permissions.metricsWrite) return "moderate";

    return "safe";
  }

  getViolations(): ReadonlyArray<{
    timestamp: string;
    permission: string;
    action: string;
  }> {
    return [...this.violations];
  }

  getPermissions(): Readonly<PluginPermissions> {
    return { ...this.permissions };
  }

  private recordViolation(permission: string, action: string): void {
    const violation = {
      timestamp: new Date().toISOString(),
      permission,
      action
    };
    this.violations.push(violation);
    if (this.violations.length > 100) {
      this.violations = this.violations.slice(-50);
    }

    this.logger.security("PLUGIN_PERMISSION_VIOLATION", {
      pluginId: this.pluginId,
      permission,
      action,
      totalViolations: this.violations.length
    });
  }
}

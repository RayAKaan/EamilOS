import { PluginManager, getSecureLogger, FeatureManager, EventBus } from '@eamilos/core';

let pluginManager: PluginManager | null = null;

function getPluginManager(): PluginManager {
  if (!pluginManager) {
    const secureLogger = getSecureLogger();
    const eventBus = new EventBus(secureLogger);
    const featureManager = new FeatureManager(secureLogger);
    
    pluginManager = new PluginManager({
      workspaceRoot: process.cwd(),
      coreVersion: '1.0.0',
      config: {},
      featureManager,
      eventBus,
      logger: secureLogger,
    });
  }
  return pluginManager;
}

export async function pluginsCommand(
  action: string,
  args: Record<string, unknown>
): Promise<void> {
  const pm = getPluginManager();
  switch (action) {
    case "list": {
      const plugins = pm.listPlugins();
      if (plugins.length === 0) {
        console.log("No plugins installed.");
        console.log("Run: eamilos plugins install <path>");
        return;
      }

      console.log("\nInstalled Plugins\n");
      console.log(
        padRight("Plugin", 30) +
        padRight("Version", 10) +
        padRight("Type", 12) +
        padRight("Status", 10) +
        padRight("Risk", 12)
      );
      console.log("-".repeat(74));

      for (const p of plugins) {
        const statusIcon = p.enabled ? "[ON]" : "[OFF]";
        const riskIcon = p.riskLevel === "safe" ? "[+]" :
                        p.riskLevel === "moderate" ? "[~]" :
                        p.riskLevel === "elevated" ? "[!]" : "[!!]";
        console.log(
          padRight(p.name, 30) +
          padRight(p.version, 10) +
          padRight(p.type, 12) +
          padRight(statusIcon, 10) +
          padRight(`${riskIcon} ${p.riskLevel}`, 12)
        );
      }

      console.log(`\nTotal: ${plugins.length} plugins`);
      break;
    }

    case "install": {
      const source = args.source as string;
      if (!source) {
        console.log("Usage: eamilos plugins install <path>");
        return;
      }

      console.log(`Installing plugin from: ${source}`);

      const result = await pm.installFromPath(source);

      if (result.success) {
        console.log(`Plugin installed: ${result.pluginId}`);
      } else {
        console.log(`Installation failed: ${result.error}`);
        process.exit(1);
      }
      break;
    }

    case "remove": {
      const pluginId = args.pluginId as string;
      if (!pluginId) {
        console.log("Usage: eamilos plugins remove <plugin-id>");
        return;
      }

      console.log(`Removing plugin: ${pluginId}`);

      const removed = await pm.removePlugin(pluginId);

      if (removed) {
        console.log(`Plugin removed: ${pluginId}`);
      } else {
        console.log(`Plugin not found: ${pluginId}`);
      }
      break;
    }

    case "info": {
      const pluginId = args.pluginId as string;
      if (!pluginId) {
        console.log("Usage: eamilos plugins info <plugin-id>");
        return;
      }

      const plugin = pm.getPlugin(pluginId);
      if (!plugin) {
        console.log(`Plugin not found: ${pluginId}`);
        return;
      }

      console.log(`\nPlugin: ${plugin.manifest.name}`);
      console.log(`   ID: ${plugin.manifest.id}`);
      console.log(`   Version: ${plugin.manifest.version}`);
      console.log(`   Type: ${plugin.manifest.type}`);
      console.log(`   Author: ${plugin.manifest.author}`);
      console.log(`   License: ${plugin.manifest.license}`);
      console.log(`   Description: ${plugin.manifest.description}`);
      console.log(`   Status: ${plugin.status}`);
      console.log(`   Risk Level: ${plugin.manifest.riskLevel}`);
      console.log(`   Core Version: ${plugin.manifest.coreVersion}`);

      console.log(`\n   Permissions:`);
      const perms = plugin.manifest.permissions;
      for (const [key, value] of Object.entries(perms)) {
        if (value === true) console.log(`     + ${key}`);
        else if (Array.isArray(value) && value.length > 0) console.log(`     * ${key}: ${value.join(", ")}`);
      }

      if (plugin.error) {
        console.log(`\n   Warning: ${plugin.error}`);
      }
      break;
    }

    case "health": {
      console.log("\nPlugin Health Check\n");
      const health = await pm.healthCheck();
      const entries = Object.entries(health);
      if (entries.length === 0) {
        console.log("  No plugins loaded");
        return;
      }
      for (const [id, status] of entries) {
        const icon = status.healthy ? "[OK]" : "[FAIL]";
        console.log(`  ${icon} ${id}: ${status.message}`);
      }
      break;
    }

    default:
      console.log("Unknown action. Available: list, install, remove, info, health");
      console.log("\nUsage:");
      console.log("  eamilos plugins list              List installed plugins");
      console.log("  eamilos plugins install <path>   Install plugin from path");
      console.log("  eamilos plugins remove <id>      Remove a plugin");
      console.log("  eamilos plugins info <id>        Show plugin details");
      console.log("  eamilos plugins health           Check plugin health");
  }
}

function padRight(str: string, len: number): string {
  return str.padEnd(len).substring(0, len);
}

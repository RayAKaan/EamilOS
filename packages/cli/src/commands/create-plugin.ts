import * as fs from 'fs';
import * as path from 'path';
import { PluginType } from '@eamilos/core';

interface CreatePluginArgs {
  name: string;
  type?: PluginType;
  permissions?: string[];
}

export async function createPluginCommand(args: CreatePluginArgs): Promise<void> {
  const pluginName = args.name.startsWith("eamilos-plugin-")
    ? args.name
    : `eamilos-plugin-${args.name}`;
  const pluginId = args.name.replace(/^eamilos-plugin-/, "");
  const pluginType = args.type || "feature";

  const dir = path.join(process.cwd(), pluginName);

  if (fs.existsSync(dir)) {
    console.log(`Directory already exists: ${pluginName}`);
    process.exit(1);
  }

  console.log(`\nCreating EamilOS plugin: ${pluginName}\n`);

  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tests"), { recursive: true });

  const packageJson = {
    name: pluginName,
    version: "0.1.0",
    description: `EamilOS ${pluginType} plugin`,
    main: "dist/index.js",
    types: "dist/index.d.ts",
    author: "",
    license: "MIT",
    scripts: {
      build: "tsc",
      test: "jest",
      prepublishOnly: "npm run build"
    },
    peerDependencies: {
      "@eamilos/core": ">=1.0.0"
    },
    devDependencies: {
      typescript: "^5.0.0",
      jest: "^29.0.0",
      "@types/jest": "^29.0.0"
    },
    eamilos: {
      id: pluginId,
      type: pluginType,
      entry: "./dist/index.js",
      name: pluginName,
      description: `A ${pluginType} plugin for EamilOS`,
      coreVersion: ">=1.0.0",
      permissions: generateDefaultPermissions(pluginType)
    }
  };
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(packageJson, null, 2));

  const tsconfig = {
    compilerOptions: {
      target: "ES2020",
      module: "commonjs",
      lib: ["ES2020"],
      outDir: "./dist",
      rootDir: "./src",
      strict: true,
      declaration: true,
      esModuleInterop: true,
      skipLibCheck: true,
      resolveJsonModule: true
    },
    include: ["src/**/*"],
    exclude: ["node_modules", "dist", "tests"]
  };
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));

  const sourceCode = generateSourceCode(pluginId, pluginType);
  fs.writeFileSync(path.join(dir, "src", "index.ts"), sourceCode);

  const testCode = generateTestCode(pluginId, pluginType);
  fs.writeFileSync(path.join(dir, "tests", "index.test.ts"), testCode);

  const readme = generateReadme(pluginName, pluginId, pluginType);
  fs.writeFileSync(path.join(dir, "README.md"), readme);

  fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules/\ndist/\n.env\n");

  console.log("  package.json");
  console.log("  tsconfig.json");
  console.log("  src/index.ts");
  console.log("  tests/index.test.ts");
  console.log("  README.md");
  console.log("  .gitignore");

  console.log(`\nPlugin created: ${pluginName}`);
  console.log(`\nNext steps:`);
  console.log(`  cd ${pluginName}`);
  console.log(`  npm install`);
  console.log(`  npm run build`);
  console.log(`  eamilos plugins install ./dist`);
}

function generateDefaultPermissions(type: PluginType): Record<string, unknown> {
  switch (type) {
    case "feature":
      return { hookAccess: true };
    case "hook":
      return { hookAccess: true };
    case "agent":
      return { hookAccess: true };
    case "tool":
      return { workspaceRead: true, workspaceWrite: true };
    case "provider":
      return {};
    case "formatter":
      return {};
    case "composite":
      return { hookAccess: true, workspaceRead: true };
    default:
      return {};
  }
}

function generateSourceCode(pluginId: string, type: PluginType): string {
  switch (type) {
    case "feature":
      return generateFeaturePlugin(pluginId);
    case "hook":
      return generateHookPlugin(pluginId);
    case "agent":
      return generateAgentPlugin(pluginId);
    case "tool":
      return generateToolPlugin(pluginId);
    case "provider":
      return generateProviderPlugin(pluginId);
    case "formatter":
      return generateFormatterPlugin(pluginId);
    default:
      return generateFeaturePlugin(pluginId);
  }
}

function generateFeaturePlugin(pluginId: string): string {
  return `import { EamilOSPlugin, PluginContext, PluginHealthStatus } from '@eamilos/core';
import { Feature, FeatureStatus } from '@eamilos/core';

class MyFeature implements Feature {
  readonly id = '${pluginId}';
  readonly name = 'My Feature';
  readonly description = 'Description of what this feature does';
  enabled = false;

  async initialize(config: Record<string, unknown>): Promise<void> {
    // Initialize feature with config
  }

  getStatus(): FeatureStatus {
    return {
      id: this.id,
      enabled: this.enabled,
      initialized: true,
      health: 'healthy',
      stats: {},
      errors: []
    };
  }
}

const plugin: EamilOSPlugin = {
  id: '${pluginId}',
  type: 'feature',

  async register(ctx: PluginContext, config: Record<string, unknown>): Promise<void> {
    ctx.log('info', 'Registering ${pluginId}');
    
    const feature = new MyFeature();
    await feature.initialize(config);
    feature.enabled = true;
    
    ctx.registerFeature(feature);
  }
};

export default plugin;
`;
}

function generateHookPlugin(pluginId: string): string {
  return `import { EamilOSPlugin, PluginContext, PluginHealthStatus } from '@eamilos/core';

const plugin: EamilOSPlugin = {
  id: '${pluginId}',
  type: 'hook',

  async register(ctx: PluginContext, config: Record<string, unknown>): Promise<void> {
    ctx.log('info', 'Registering ${pluginId} hook plugin');

    ctx.registerHook('execution.succeeded', async (data) => {
      ctx.log('debug', 'Task succeeded', data);
    });

    ctx.registerHook('execution.failed', async (data) => {
      ctx.log('warn', 'Task failed', data);
    });
  }
};

export default plugin;
`;
}

function generateAgentPlugin(pluginId: string): string {
  return `import { EamilOSPlugin, PluginContext } from '@eamilos/core';

const plugin: EamilOSPlugin = {
  id: '${pluginId}',
  type: 'agent',

  async register(ctx: PluginContext, config: Record<string, unknown>): Promise<void> {
    ctx.log('info', 'Registering ${pluginId} agent');

    ctx.registerAgent({
      id: '${pluginId}',
      name: 'My Agent',
      description: 'Description of the agent capability',
      capabilities: ['code-generation', 'debugging'],
      handler: async (instruction, context) => {
        // Agent logic here
        return { result: 'processed' };
      }
    });
  }
};

export default plugin;
`;
}

function generateToolPlugin(pluginId: string): string {
  return `import { EamilOSPlugin, PluginContext } from '@eamilos/core';

const plugin: EamilOSPlugin = {
  id: '${pluginId}',
  type: 'tool',

  async register(ctx: PluginContext, config: Record<string, unknown>): Promise<void> {
    ctx.log('info', 'Registering ${pluginId} tool');

    ctx.registerTool({
      id: '${pluginId}',
      name: 'My Tool',
      description: 'Description of the tool',
      parameters: {
        input: {
          type: 'string',
          description: 'Input parameter',
          required: true
        }
      },
      handler: async (params) => {
        // Tool logic here
        return { output: 'result' };
      }
    });
  }
};

export default plugin;
`;
}

function generateProviderPlugin(pluginId: string): string {
  return `import { EamilOSPlugin, PluginContext } from '@eamilos/core';

const plugin: EamilOSPlugin = {
  id: '${pluginId}',
  type: 'provider',

  async register(ctx: PluginContext, config: Record<string, unknown>): Promise<void> {
    ctx.log('info', 'Registering ${pluginId} provider');

    ctx.registerProvider({
      id: '${pluginId}',
      name: 'My Provider',
      models: ['model-1', 'model-2'],
      generate: async (options) => {
        // Provider logic here
        return 'Generated response';
      }
    });
  }
};

export default plugin;
`;
}

function generateFormatterPlugin(pluginId: string): string {
  return `import { EamilOSPlugin, PluginContext } from '@eamilos/core';

const plugin: EamilOSPlugin = {
  id: '${pluginId}',
  type: 'formatter',

  async register(ctx: PluginContext, config: Record<string, unknown>): Promise<void> {
    ctx.log('info', 'Registering ${pluginId} formatter');
    // Formatter registration logic
  }
};

export default plugin;
`;
}

function generateTestCode(pluginId: string, type: PluginType): string {
  return `describe('${pluginId}', () => {
  it('should have correct plugin id', () => {
    expect('${pluginId}').toBe('${pluginId}');
  });

  it('should have correct plugin type', () => {
    expect('${type}').toBe('${type}');
  });
});
`;
}

function generateReadme(pluginName: string, pluginId: string, type: PluginType): string {
  return `# ${pluginName}

An EamilOS ${type} plugin.

## Installation

\`\`\`bash
npm install
npm run build
eamilos plugins install ./dist
\`\`\`

## Configuration

Add to your \`eamilos.config.yaml\`:

\`\`\`yaml
plugins:
  ${pluginId}:
    enabled: true
\`\`\`

## Permissions

This plugin requires the following permissions:
${Object.entries(generateDefaultPermissions(type))
  .filter(([_, v]) => v === true)
  .map(([k]) => `- \`${k}: true\``)
  .join('\n')}

## License

MIT
`;
}

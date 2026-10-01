import { PluginRuntime } from './PluginRuntime.js';
import { TOOL_RUNTIME, MODEL_GATEWAY, TERMINAL_RUNTIME, JOB_RUNTIME, SANDBOX_RUNTIME, MCP_RUNTIME } from './CapabilityCatalog.js';
import { ToolRuntimeV2 } from '../tools/ToolRuntimeV2.js';
import { ModelGatewayV2 } from '../llm/ModelGatewayV2.js';
import { TerminalRuntime } from '../terminal/TerminalRuntime.js';
import { JobRuntime } from './JobRuntime.js';
import { SandboxRuntime } from '../sandbox/SandboxRuntime.js';
import { MCPRuntime } from '../mcp/MCPRuntime.js';

export interface ExecutionCapabilities {
  tools: ToolRuntimeV2;
  models: ModelGatewayV2;
  terminal: TerminalRuntime;
  jobs: JobRuntime;
  sandbox: SandboxRuntime;
  mcp: MCPRuntime;
}

export function installExecutionCapabilities(runtime: PluginRuntime): ExecutionCapabilities {
  const capabilities: ExecutionCapabilities = {
    tools: new ToolRuntimeV2(),
    models: new ModelGatewayV2(),
    terminal: new TerminalRuntime(),
    jobs: new JobRuntime(),
    sandbox: new SandboxRuntime(),
    mcp: new MCPRuntime(),
  };

  runtime.registerCapability(TOOL_RUNTIME, capabilities.tools);
  runtime.registerCapability(MODEL_GATEWAY, capabilities.models);
  runtime.registerCapability(TERMINAL_RUNTIME, capabilities.terminal);
  runtime.registerCapability(JOB_RUNTIME, capabilities.jobs);
  runtime.registerCapability(SANDBOX_RUNTIME, capabilities.sandbox);
  runtime.registerCapability(MCP_RUNTIME, capabilities.mcp);

  return capabilities;
}

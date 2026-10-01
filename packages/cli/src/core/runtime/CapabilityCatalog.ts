import { capabilityKey } from './CapabilityRegistry.js';
import type { ToolRuntimeV2 } from '../tools/ToolRuntimeV2.js';
import type { ModelGatewayV2 } from '../llm/ModelGatewayV2.js';
import type { TerminalRuntime } from '../terminal/TerminalRuntime.js';
import type { JobRuntime } from './JobRuntime.js';
import type { SandboxRuntime } from '../sandbox/SandboxRuntime.js';
import type { MCPRuntime } from '../mcp/MCPRuntime.js';

export const TOOL_RUNTIME = capabilityKey<ToolRuntimeV2>('runtime.tools', 'Universal tool execution and presentation runtime');
export const MODEL_GATEWAY = capabilityKey<ModelGatewayV2>('runtime.models', 'Provider-neutral model streaming gateway');
export const TERMINAL_RUNTIME = capabilityKey<TerminalRuntime>('runtime.terminal', 'Persistent cancellable terminal sessions');
export const JOB_RUNTIME = capabilityKey<JobRuntime>('runtime.jobs', 'Background job lifecycle runtime');
export const SANDBOX_RUNTIME = capabilityKey<SandboxRuntime>('runtime.sandbox', 'Capability policy enforcement for execution');
export const MCP_RUNTIME = capabilityKey<MCPRuntime>('runtime.mcp', 'Model Context Protocol runtime');

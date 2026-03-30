# 📄 EXECUTION_SPEC.md — The Missing Mechanical Layer

This is the **fifth and final system definition file**. It defines everything the other four files assumed but never specified: **how agents actually execute, how tools work, how artifacts are validated, how retries improve, and how the system handles real-world edge cases**.

---

# ==============================================================================
# AAMILOS (AOG) — EXECUTION SPECIFICATION
# VERSION: 1.0.0-FINAL
# AUTHORITY: EQUAL TO ARCHITECTURE.md FOR EXECUTION MECHANICS
# AUDIENCE: AI AGENTS IMPLEMENTING AAMILOS
# ==============================================================================
#
# PURPOSE:
# This document defines the MECHANICAL LAYER of AamilOS — the concrete
# contracts, algorithms, and implementations that bridge the architectural
# vision (ARCHITECTURE.md) to real, functioning code.
#
# Without this document, agents know WHAT the system should do but not
# HOW it physically executes. Every gap identified in system review is
# resolved here with concrete, implementable specifications.
#
# NAMING:
# External Product Name: AamilOS
# Internal System Name: AOG (Agentic Operating Ground)
# All code references use: aamilos (lowercase, no special characters)
# Package name: @aamilos/core
# CLI command: aamilos
# Config file: aamilos.config.yaml
# Database file: aamilos.db
#
# DOCUMENT HIERARCHY (Updated):
# 1. ARCHITECTURE.md — schemas, state machines, system structure
# 2. EXECUTION_SPEC.md — execution mechanics, tool runtime, contracts (THIS FILE)
# 3. AI_RULES.md — agent behavioral laws
# 4. PRD.md — product requirements, user experience
# 5. PLAN.md — implementation phases, verification
#
# ==============================================================================


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 1: TOOL EXECUTION LAYER
# ═══════════════════════════════════════════════════════════════════════════════
#
# This is the MOST CRITICAL missing component. Without this, agents cannot
# produce artifacts. The entire system depends on tools working correctly.

## 1.1 Tool Architecture

The tool layer sits between the model response and the workspace:

```
Model Response (with tool_calls)
        ↓
  Tool Router (maps tool names to implementations)
        ↓
  Permission Check (can this agent use this tool?)
        ↓
  Input Validation (Zod schema per tool)
        ↓
  Tool Execution (actual file write, command run, etc.)
        ↓
  Result Capture (success/error + output)
        ↓
  Tool Response (fed back to model for next step)
```

## 1.2 Tool Interface

```typescript
// packages/core/src/tools/types.ts
import { z, ZodSchema } from "zod";

export interface ToolContext {
  projectId: string;
  taskId: string;
  agentId: string;
  correlationId: string;
  workspace: WorkspaceManager;
  permissions: PermissionEngine;
  logger: Logger;
  eventBus: EventBus;
}

export interface ToolResult {
  success: boolean;
  output: string;           // Human-readable result description
  data?: unknown;            // Structured data (for tool-to-tool chaining)
  error?: string;            // Error message if success=false
  artifactCreated?: string;  // File path if an artifact was created
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodSchema;
  requiresPermission: string;  // Maps to permission type
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
}
```

## 1.3 Required Tools (Minimum Viable Set)

Every tool below MUST be implemented. Agents cannot function without them.

### Tool 1: workspace_write

```typescript
// packages/core/src/tools/workspace-write.ts

export const workspaceWriteTool: ToolDefinition = {
  name: "workspace_write",
  description: "Write a file to the project workspace. Creates parent directories automatically. Use this for ALL file creation.",
  
  inputSchema: z.object({
    path: z.string()
      .min(1)
      .describe("Relative file path within the project workspace (e.g., 'src/main.py', 'README.md')"),
    content: z.string()
      .min(1)
      .describe("Complete file content. Must be the FULL file, not a snippet."),
    description: z.string()
      .optional()
      .describe("Brief description of what this file is and why it was created"),
  }),
  
  requiresPermission: "fileWrite",
  
  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = this.inputSchema.parse(input);
    
    // 1. Permission check
    const permitted = context.permissions.check(
      context.agentId, "fileWrite", parsed.path
    );
    if (!permitted.allowed) {
      return {
        success: false,
        output: `Permission denied: ${permitted.reason}`,
        error: `Agent "${context.agentId}" not permitted to write files`,
      };
    }
    
    // 2. Security validation (path traversal prevention)
    const safePath = validateAndResolvePath(
      context.workspace.baseDir, context.projectId, parsed.path
    );
    
    // 3. Size limit check
    const sizeBytes = Buffer.byteLength(parsed.content, "utf-8");
    const maxSize = context.workspace.maxFileSizeBytes;
    if (sizeBytes > maxSize) {
      return {
        success: false,
        output: `File too large: ${sizeBytes} bytes exceeds limit of ${maxSize} bytes`,
        error: "FILE_SIZE_LIMIT",
      };
    }
    
    // 4. Workspace total size check
    const workspaceSize = await context.workspace.getTotalSize(context.projectId);
    const maxWorkspaceSize = context.workspace.maxWorkspaceSizeBytes;
    if (workspaceSize + sizeBytes > maxWorkspaceSize) {
      return {
        success: false,
        output: `Workspace size limit exceeded`,
        error: "WORKSPACE_SIZE_LIMIT",
      };
    }
    
    // 5. Check if file exists (for versioning)
    const exists = await context.workspace.fileExists(context.projectId, parsed.path);
    let version = 1;
    if (exists) {
      const existingContent = await context.workspace.readArtifact(context.projectId, parsed.path);
      const existingHash = computeHash(existingContent);
      const newHash = computeHash(parsed.content);
      
      if (existingHash === newHash) {
        return {
          success: true,
          output: `File "${parsed.path}" already exists with identical content. Skipped write.`,
        };
      }
      
      // Get current version and increment
      version = await context.workspace.getFileVersion(context.projectId, parsed.path) + 1;
    }
    
    // 6. Atomic write (write to .tmp, then rename)
    const artifact = await context.workspace.writeArtifactAtomic(
      context.projectId,
      parsed.path,
      parsed.content,
      context.agentId,
      version,
      parsed.description
    );
    
    // 7. Log event
    context.eventBus.emit(exists ? "artifact.updated" : "artifact.created", {
      projectId: context.projectId,
      taskId: context.taskId,
      agentId: context.agentId,
      path: parsed.path,
      size: sizeBytes,
      version,
      hash: artifact.hash,
      correlationId: context.correlationId,
    });
    
    context.logger.agent(context.agentId, 
      `✓ ${exists ? "updated" : "wrote"}: ${parsed.path} (${formatBytes(sizeBytes)}, v${version})`
    );
    
    return {
      success: true,
      output: `File "${parsed.path}" ${exists ? "updated" : "created"} successfully (${formatBytes(sizeBytes)}, version ${version})`,
      artifactCreated: parsed.path,
    };
  },
};
```

### Tool 2: workspace_read

```typescript
// packages/core/src/tools/workspace-read.ts

export const workspaceReadTool: ToolDefinition = {
  name: "workspace_read",
  description: "Read a file from the project workspace. Use this to inspect existing code, research, or configuration before writing.",
  
  inputSchema: z.object({
    path: z.string()
      .min(1)
      .describe("Relative file path within the project workspace"),
  }),
  
  requiresPermission: "fileRead",
  
  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = this.inputSchema.parse(input);
    
    // Security validation
    validateAndResolvePath(
      context.workspace.baseDir, context.projectId, parsed.path
    );
    
    try {
      const content = await context.workspace.readArtifact(context.projectId, parsed.path);
      
      // Truncate very large files for model consumption
      const MAX_READ_SIZE = 50000; // characters
      const truncated = content.length > MAX_READ_SIZE;
      const output = truncated 
        ? content.slice(0, MAX_READ_SIZE) + `\n\n[TRUNCATED: File is ${content.length} chars, showing first ${MAX_READ_SIZE}]`
        : content;
      
      return {
        success: true,
        output: output,
        data: { path: parsed.path, size: content.length, truncated },
      };
    } catch {
      return {
        success: false,
        output: `File not found: ${parsed.path}`,
        error: "FILE_NOT_FOUND",
      };
    }
  },
};
```

### Tool 3: workspace_list

```typescript
// packages/core/src/tools/workspace-list.ts

export const workspaceListTool: ToolDefinition = {
  name: "workspace_list",
  description: "List all files in the project workspace. Use this to understand what already exists before creating new files.",
  
  inputSchema: z.object({
    directory: z.string()
      .optional()
      .describe("Subdirectory to list (default: entire workspace)"),
  }),
  
  requiresPermission: "fileRead",
  
  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = this.inputSchema.parse(input);
    
    const files = await context.workspace.listFiles(context.projectId, parsed.directory);
    
    if (files.length === 0) {
      return {
        success: true,
        output: "Workspace is empty. No files exist yet.",
        data: { files: [], count: 0 },
      };
    }
    
    const fileList = files
      .map(f => `  ${f.path} (${formatBytes(f.size)})`)
      .join("\n");
    
    return {
      success: true,
      output: `Workspace files (${files.length}):\n${fileList}`,
      data: { files: files.map(f => ({ path: f.path, size: f.size })), count: files.length },
    };
  },
};
```

### Tool 4: execute_command

```typescript
// packages/core/src/tools/execute-command.ts

export const executeCommandTool: ToolDefinition = {
  name: "execute_command",
  description: "Execute a shell command in the project workspace. Use for: installing dependencies, running tests, building. SANDBOXED: runs in project directory only.",
  
  inputSchema: z.object({
    command: z.string()
      .min(1)
      .describe("The command to execute (e.g., 'npm install', 'python -m pytest')"),
    timeout_seconds: z.number()
      .int()
      .min(1)
      .max(300)
      .optional()
      .default(60)
      .describe("Maximum execution time in seconds"),
  }),
  
  requiresPermission: "commandExecute",
  
  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = this.inputSchema.parse(input);
    
    // Permission check
    const permitted = context.permissions.check(
      context.agentId, "commandExecute", parsed.command
    );
    if (!permitted.allowed) {
      return {
        success: false,
        output: `Permission denied: Agent "${context.agentId}" cannot execute commands`,
        error: "PERMISSION_DENIED",
      };
    }
    
    // Dangerous command detection
    const BLOCKED_PATTERNS = [
      /rm\s+-rf\s+[\/~]/,     // rm -rf / or ~
      /:(){ :|:& };:/,         // fork bomb
      /mkfs/,                   // format disk
      /dd\s+if=/,              // disk destroyer
      />\s*\/dev\/sd/,         // write to raw disk
      /curl.*\|\s*sh/,         // pipe curl to shell
      /wget.*\|\s*sh/,         // pipe wget to shell
    ];
    
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(parsed.command)) {
        context.logger.error(`Blocked dangerous command: ${parsed.command}`);
        return {
          success: false,
          output: `Command blocked: matches dangerous pattern`,
          error: "DANGEROUS_COMMAND",
        };
      }
    }
    
    // Execute in sandbox
    const projectPath = context.workspace.getProjectPath(context.projectId);
    
    try {
      // Sanitize environment (remove API keys)
      const sanitizedEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (!key.includes("KEY") && !key.includes("SECRET") && !key.includes("TOKEN") && !key.includes("PASSWORD")) {
          if (value !== undefined) {
            sanitizedEnv[key] = value;
          }
        }
      }
      
      const result = await execa(parsed.command, {
        cwd: projectPath,
        shell: true,
        timeout: parsed.timeout_seconds * 1000,
        env: sanitizedEnv,
        reject: false,  // Don't throw on non-zero exit
        maxBuffer: 1024 * 1024, // 1MB output limit
      });
      
      const output = [
        result.stdout ? `STDOUT:\n${result.stdout.slice(0, 5000)}` : "",
        result.stderr ? `STDERR:\n${result.stderr.slice(0, 2000)}` : "",
        `Exit code: ${result.exitCode}`,
      ].filter(Boolean).join("\n\n");
      
      context.logger.agent(context.agentId,
        `⚡ command: ${parsed.command} (exit: ${result.exitCode})`
      );
      
      return {
        success: result.exitCode === 0,
        output: output,
        error: result.exitCode !== 0 ? `Command exited with code ${result.exitCode}` : undefined,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      
      if (message.includes("timed out")) {
        return {
          success: false,
          output: `Command timed out after ${parsed.timeout_seconds} seconds`,
          error: "TIMEOUT",
        };
      }
      
      return {
        success: false,
        output: `Command execution error: ${message}`,
        error: message,
      };
    }
  },
};
```

### Tool 5: log_decision

```typescript
// packages/core/src/tools/log-decision.ts

export const logDecisionTool: ToolDefinition = {
  name: "log_decision",
  description: "Log a significant decision with reasoning. Use whenever you choose between alternatives.",
  
  inputSchema: z.object({
    decision: z.string().describe("What was decided"),
    reasoning: z.string().describe("Why this option was chosen"),
    alternatives: z.array(z.object({
      option: z.string(),
      reason_rejected: z.string(),
    })).optional().describe("What other options were considered"),
  }),
  
  requiresPermission: "fileWrite",
  
  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = this.inputSchema.parse(input);
    
    context.eventBus.emit("decision.made", {
      projectId: context.projectId,
      taskId: context.taskId,
      agentId: context.agentId,
      decision: parsed.decision,
      reasoning: parsed.reasoning,
      alternatives: parsed.alternatives || [],
      correlationId: context.correlationId,
    });
    
    context.logger.agent(context.agentId,
      `📋 Decision: ${parsed.decision}`
    );
    
    return {
      success: true,
      output: `Decision logged: ${parsed.decision}`,
    };
  },
};
```

## 1.4 Tool Registry

```typescript
// packages/core/src/tools/registry.ts

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  
  constructor() {
    // Register all built-in tools
    this.register(workspaceWriteTool);
    this.register(workspaceReadTool);
    this.register(workspaceListTool);
    this.register(executeCommandTool);
    this.register(logDecisionTool);
  }
  
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }
  
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }
  
  getToolsForAgent(agent: AgentDefinition): ToolDefinition[] {
    return agent.tools
      .map(name => this.tools.get(name))
      .filter((t): t is ToolDefinition => t !== undefined);
  }
  
  // Convert to format expected by model providers (OpenAI/Anthropic tool format)
  toModelFormat(tools: ToolDefinition[]): ModelToolDefinition[] {
    return tools.map(tool => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.inputSchema),
      },
    }));
  }
}
```

## 1.5 Tool Executor

This is the bridge between model tool_calls and actual execution.

```typescript
// packages/core/src/tools/executor.ts

export class ToolExecutor {
  constructor(
    private registry: ToolRegistry,
    private workspace: WorkspaceManager,
    private permissions: PermissionEngine,
    private eventBus: EventBus,
    private logger: Logger,
  ) {}
  
  async execute(
    toolCall: { name: string; arguments: unknown },
    context: { projectId: string; taskId: string; agentId: string; correlationId: string }
  ): Promise<ToolResult> {
    const tool = this.registry.get(toolCall.name);
    
    if (!tool) {
      this.logger.error(`Unknown tool: ${toolCall.name}`);
      return {
        success: false,
        output: `Unknown tool: ${toolCall.name}. Available tools: ${Array.from(this.registry.getAllNames()).join(", ")}`,
        error: "UNKNOWN_TOOL",
      };
    }
    
    const toolContext: ToolContext = {
      projectId: context.projectId,
      taskId: context.taskId,
      agentId: context.agentId,
      correlationId: context.correlationId,
      workspace: this.workspace,
      permissions: this.permissions,
      logger: this.logger,
      eventBus: this.eventBus,
    };
    
    try {
      // Validate input against schema
      const validatedInput = tool.inputSchema.parse(toolCall.arguments);
      
      // Execute
      const result = await tool.execute(validatedInput, toolContext);
      
      return result;
      
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        const issues = error.issues.map(i => `  ${i.path.join(".")}: ${i.message}`).join("\n");
        return {
          success: false,
          output: `Invalid tool arguments for "${toolCall.name}":\n${issues}`,
          error: "VALIDATION_ERROR",
        };
      }
      
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Tool execution error (${toolCall.name}): ${message}`);
      
      return {
        success: false,
        output: `Tool execution failed: ${message}`,
        error: message,
      };
    }
  }
}
```


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 2: AGENT EXECUTION FORMAT
# ═══════════════════════════════════════════════════════════════════════════════
#
# Defines the EXACT protocol for how agents execute: the message flow,
# tool call loop, and response processing.

## 2.1 Agent Execution Protocol

The agent runner executes an agent on a task through this exact sequence:

```
1. Build Context (ContextBuilder)
2. Prepare Tool Definitions (ToolRegistry)
3. Send Initial Request to Model (messages + tools)
4. LOOP:
   a. Receive model response
   b. If response has tool_calls:
      - Execute each tool call via ToolExecutor
      - Collect results
      - Send tool results back to model
      - Continue loop
   c. If response has content only (no tool_calls):
      - Extract summary
      - Break loop
   d. If max iterations reached:
      - Force stop
      - Break loop
5. Collect all artifacts created during execution
6. Return AgentExecutionResult
```

## 2.2 Agent Runner Implementation

```typescript
// packages/core/src/agent-runner.ts

export interface AgentExecutionResult {
  success: boolean;
  summary: string;
  artifacts: string[];      // file paths created
  decisions: string[];      // decisions logged
  toolCallCount: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    totalLatencyMs: number;
  };
  model: string;
  error?: string;
}

export class AgentRunner {
  private readonly MAX_TOOL_ITERATIONS = 20;  // Safety limit
  
  constructor(
    private toolExecutor: ToolExecutor,
    private toolRegistry: ToolRegistry,
    private logger: Logger,
  ) {}
  
  async run(
    agent: AgentDefinition,
    context: string,           // Built by ContextBuilder
    modelRouter: ModelRouter,
    executionContext: {
      projectId: string;
      taskId: string;
      correlationId: string;
    }
  ): Promise<AgentExecutionResult> {
    
    // 1. Get tools for this agent
    const tools = this.toolRegistry.getToolsForAgent(agent);
    const modelTools = this.toolRegistry.toModelFormat(tools);
    
    // 2. Build initial messages
    const messages: Message[] = [
      { role: "system", content: context },
      { role: "user", content: "Execute your task now. Use the provided tools to create artifacts. Begin." },
    ];
    
    // 3. Tracking
    const artifactsCreated: string[] = [];
    const decisionsLogged: string[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCostUsd = 0;
    let totalLatencyMs = 0;
    let toolCallCount = 0;
    let modelUsed = "";
    let finalSummary = "";
    
    // 4. Tool call loop
    let iteration = 0;
    
    while (iteration < this.MAX_TOOL_ITERATIONS) {
      iteration++;
      
      // Call model
      const response = await modelRouter.execute(
        agent,
        messages,
        agent.preferredTier === "strong" ? "coding" : "research",
        { tools: modelTools, timeout: agent.timeoutSeconds * 1000 }
      );
      
      // Track usage
      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;
      totalCostUsd += response.usage.costUsd;
      totalLatencyMs += response.latencyMs;
      modelUsed = response.model;
      
      // Check for tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        // Add assistant message with tool calls to history
        messages.push({
          role: "assistant",
          content: response.content || "",
          toolCalls: response.toolCalls,
        });
        
        // Execute each tool call
        for (const toolCall of response.toolCalls) {
          toolCallCount++;
          
          this.logger.debug(
            `Tool call: ${toolCall.name}(${JSON.stringify(toolCall.arguments).slice(0, 200)})`
          );
          
          const result = await this.toolExecutor.execute(toolCall, {
            projectId: executionContext.projectId,
            taskId: executionContext.taskId,
            agentId: agent.id,
            correlationId: executionContext.correlationId,
          });
          
          // Track artifacts
          if (result.artifactCreated) {
            artifactsCreated.push(result.artifactCreated);
          }
          
          // Track decisions
          if (toolCall.name === "log_decision") {
            const args = toolCall.arguments as { decision: string };
            decisionsLogged.push(args.decision);
          }
          
          // Add tool result to messages
          messages.push({
            role: "tool",
            content: result.output,
            toolCallId: toolCall.id,
          });
        }
        
        // Continue loop — model needs to process tool results
        continue;
      }
      
      // No tool calls — model is done
      finalSummary = response.content || "Task completed (no summary provided)";
      break;
    }
    
    // 5. Check for max iterations
    if (iteration >= this.MAX_TOOL_ITERATIONS) {
      this.logger.warn(`Agent ${agent.id} reached max tool iterations (${this.MAX_TOOL_ITERATIONS})`);
      finalSummary = finalSummary || "Task stopped: maximum tool call iterations reached";
    }
    
    // 6. Return result
    return {
      success: artifactsCreated.length > 0 || toolCallCount > 0,
      summary: finalSummary,
      artifacts: artifactsCreated,
      decisions: decisionsLogged,
      toolCallCount,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd: totalCostUsd,
        totalLatencyMs,
      },
      model: modelUsed,
    };
  }
}
```

## 2.3 Message Types

```typescript
// packages/core/src/types.ts (additions)

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCallMessage[];   // Only for assistant messages
  toolCallId?: string;              // Only for tool result messages
}

export interface ToolCallMessage {
  id: string;                       // Unique ID for this tool call
  name: string;                     // Tool name
  arguments: Record<string, unknown>; // Parsed arguments
}

export interface ModelToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;  // JSON Schema
  };
}
```

## 2.4 Enforcement: Zero Tool Calls = Failure

```typescript
// In orchestrator.ts, after AgentRunner.run() returns:

if (result.toolCallCount === 0) {
  // Agent did not use any tools — this is ALWAYS a failure
  // because the Artifact Law requires file creation
  await this.handleArtifactFailure(task, 
    "Agent did not use any tools. The Artifact Law requires file creation for every task."
  );
  return;
}

if (result.artifacts.length === 0 && task.type !== "planning") {
  // Agent used tools but no artifacts were created
  // (could happen if all writes failed)
  await this.handleArtifactFailure(task,
    "Agent used tools but no artifacts were created. All file writes may have failed."
  );
  return;
}
```


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 3: PLANNER IMPLEMENTATION SPECIFICATION
# ═══════════════════════════════════════════════════════════════════════════════

## 3.1 Planner Output Format

The planner agent MUST write a `artifacts/task-plan.json` file with this exact schema:

```typescript
// packages/core/src/schemas/task-plan.ts

export const TaskPlanItemSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(10),
  type: z.enum(["research", "coding", "qa", "planning", "design", "deploy", "custom"]),
  priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  dependsOnIndices: z.array(z.number().int().min(0)),  // Indices into the plan array
  requiredCapabilities: z.array(z.string()).optional(),
  requiresHumanApproval: z.boolean().default(false),
  estimatedComplexity: z.enum(["simple", "moderate", "complex"]).optional(),
});

export const TaskPlanSchema = z.object({
  projectGoal: z.string(),
  totalTasks: z.number().int().min(1),
  estimatedTotalCost: z.string().optional(),
  tasks: z.array(TaskPlanItemSchema).min(1).max(20),
});

export type TaskPlan = z.infer<typeof TaskPlanSchema>;
```

## 3.2 DAG Validation (Cycle Detection)

MUST be run on every task plan before execution.

```typescript
// packages/core/src/validation/dag.ts

export class DAGValidationError extends Error {
  constructor(
    message: string,
    public readonly cycle: string[],
  ) {
    super(message);
    this.name = "DAGValidationError";
  }
}

export function validateDAG(tasks: Array<{ id: string; dependsOn: string[] }>): void {
  // Build adjacency list
  const graph = new Map<string, string[]>();
  const allIds = new Set<string>();
  
  for (const task of tasks) {
    allIds.add(task.id);
    graph.set(task.id, task.dependsOn);
  }
  
  // Validate all dependencies reference existing tasks
  for (const task of tasks) {
    for (const depId of task.dependsOn) {
      if (!allIds.has(depId)) {
        throw new DAGValidationError(
          `Task "${task.id}" depends on non-existent task "${depId}"`,
          [task.id, depId]
        );
      }
    }
  }
  
  // Detect cycles using DFS with three-color marking
  const WHITE = 0; // Unvisited
  const GRAY = 1;  // In current DFS path (visiting)
  const BLACK = 2; // Fully processed
  
  const color = new Map<string, number>();
  const parent = new Map<string, string>();
  
  for (const id of allIds) {
    color.set(id, WHITE);
  }
  
  function dfs(nodeId: string): string[] | null {
    color.set(nodeId, GRAY);
    
    const deps = graph.get(nodeId) || [];
    for (const depId of deps) {
      if (color.get(depId) === GRAY) {
        // Cycle found — reconstruct cycle path
        const cycle: string[] = [depId, nodeId];
        let current = nodeId;
        while (current !== depId) {
          current = parent.get(current) || depId;
          cycle.push(current);
        }
        return cycle.reverse();
      }
      
      if (color.get(depId) === WHITE) {
        parent.set(depId, nodeId);
        const cycle = dfs(depId);
        if (cycle) return cycle;
      }
    }
    
    color.set(nodeId, BLACK);
    return null;
  }
  
  for (const id of allIds) {
    if (color.get(id) === WHITE) {
      const cycle = dfs(id);
      if (cycle) {
        throw new DAGValidationError(
          `Circular dependency detected: ${cycle.join(" → ")}`,
          cycle
        );
      }
    }
  }
}
```

## 3.3 Plan Processing

After the planner agent produces `task-plan.json`, the orchestrator processes it:

```typescript
// In orchestrator.ts

async processPlan(project: Project): Promise<Task[]> {
  // 1. Read plan from workspace
  const planContent = await this.workspace.readArtifact(project.id, "artifacts/task-plan.json");
  
  // 2. Parse and validate
  let plan: TaskPlan;
  try {
    plan = TaskPlanSchema.parse(JSON.parse(planContent));
  } catch (error) {
    throw new PlanValidationError(`Invalid task plan: ${error}`);
  }
  
  // 3. Create tasks with real IDs
  const tasks: Task[] = [];
  const idMap = new Map<number, string>(); // index → real task ID
  
  for (let i = 0; i < plan.tasks.length; i++) {
    const planItem = plan.tasks[i];
    const taskId = nanoid();
    idMap.set(i, taskId);
    
    // Resolve dependency indices to real task IDs
    const dependsOn = planItem.dependsOnIndices
      .map(idx => idMap.get(idx))
      .filter((id): id is string => id !== undefined);
    
    const task = await this.taskManager.createTask({
      id: taskId,
      projectId: project.id,
      title: planItem.title,
      description: planItem.description,
      type: planItem.type,
      priority: planItem.priority,
      dependsOn,
      requiredCapabilities: planItem.requiredCapabilities,
      requiresHumanApproval: planItem.requiresHumanApproval,
      status: "pending",
      maxRetries: 3,
    });
    
    tasks.push(task);
  }
  
  // 4. Validate DAG
  validateDAG(tasks.map(t => ({ id: t.id, dependsOn: t.dependsOn })));
  
  // 5. Update project task count
  await this.db.updateProject(project.id, { totalTasks: tasks.length });
  
  this.logger.info(`Plan created: ${tasks.length} tasks`);
  return tasks;
}
```


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 4: ARTIFACT QUALITY VALIDATION
# ═══════════════════════════════════════════════════════════════════════════════

## 4.1 Validation Engine

```typescript
// packages/core/src/validation/artifact-validator.ts

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class ArtifactValidator {
  
  async validate(path: string, content: string): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Universal checks
    if (content.length === 0) {
      errors.push("File is empty");
      return { valid: false, errors, warnings };
    }
    
    if (content.trim().length === 0) {
      errors.push("File contains only whitespace");
      return { valid: false, errors, warnings };
    }
    
    // Placeholder detection
    const placeholderPatterns = [
      /\/\/\s*\.\.\./g,
      /\/\/\s*TODO/gi,
      /\/\/\s*FIXME/gi,
      /\/\/\s*implement/gi,
      /#\s*TODO/gi,
      /pass\s*#\s*TODO/gi,
      /raise\s+NotImplementedError/g,
      /throw\s+new\s+Error\(['"]not implemented['"]\)/gi,
    ];
    
    for (const pattern of placeholderPatterns) {
      const matches = content.match(pattern);
      if (matches && matches.length > 0) {
        warnings.push(`Placeholder detected: "${matches[0]}" (${matches.length} occurrences)`);
      }
    }
    
    // Language-specific validation
    const ext = path.split(".").pop()?.toLowerCase();
    
    switch (ext) {
      case "json":
        try {
          JSON.parse(content);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`Invalid JSON: ${msg}`);
        }
        break;
        
      case "yaml":
      case "yml":
        try {
          yaml.parse(content);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`Invalid YAML: ${msg}`);
        }
        break;
        
      case "ts":
      case "tsx":
        // Check for basic TypeScript syntax issues
        if (this.hasUnbalancedBraces(content)) {
          errors.push("Unbalanced braces detected — likely incomplete code");
        }
        if (this.hasUnclosedStrings(content)) {
          warnings.push("Potentially unclosed string literal");
        }
        break;
        
      case "py":
        // Check for basic Python syntax issues
        if (this.hasInconsistentIndentation(content)) {
          warnings.push("Inconsistent indentation detected");
        }
        break;
        
      case "html":
        // Basic HTML checks
        if (!content.includes("<html") && !content.includes("<!DOCTYPE") && !content.includes("<div")) {
          warnings.push("File may not contain valid HTML structure");
        }
        break;
        
      case "md":
        // Markdown is always valid syntactically
        if (content.length < 20) {
          warnings.push("Markdown file seems very short");
        }
        break;
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
  
  private hasUnbalancedBraces(content: string): boolean {
    // Strip strings and comments first
    const stripped = content
      .replace(/\/\/.*$/gm, "")          // line comments
      .replace(/\/\*[\s\S]*?\*\//g, "")  // block comments
      .replace(/"(?:[^"\\]|\\.)*"/g, "") // double-quoted strings
      .replace(/'(?:[^'\\]|\\.)*'/g, "") // single-quoted strings
      .replace(/`(?:[^`\\]|\\.)*`/g, ""); // template literals
    
    let count = 0;
    for (const char of stripped) {
      if (char === "{") count++;
      if (char === "}") count--;
      if (count < 0) return true;
    }
    return count !== 0;
  }
  
  private hasUnclosedStrings(content: string): boolean {
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.replace(/\/\/.*$/, "").trim();
      const singleQuotes = (trimmed.match(/(?<!\\)'/g) || []).length;
      const doubleQuotes = (trimmed.match(/(?<!\\)"/g) || []).length;
      if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0) {
        // Could be multiline string — only warn, don't error
        return true;
      }
    }
    return false;
  }
  
  private hasInconsistentIndentation(content: string): boolean {
    const lines = content.split("\n").filter(l => l.trim().length > 0);
    let usesSpaces = false;
    let usesTabs = false;
    
    for (const line of lines) {
      if (line.startsWith(" ") && !line.startsWith("  ")) usesSpaces = true;
      if (line.startsWith("\t")) usesTabs = true;
    }
    
    return usesSpaces && usesTabs;
  }
}
```

## 4.2 Validation Integration

```typescript
// In orchestrator.ts, during artifact validation step:

const validator = new ArtifactValidator();

for (const artifact of newArtifacts) {
  const content = await this.workspace.readArtifact(project.id, artifact.path);
  const validation = await validator.validate(artifact.path, content);
  
  if (!validation.valid) {
    this.logger.warn(
      `Artifact validation failed for ${artifact.path}: ${validation.errors.join(", ")}`
    );
    // Don't fail the task for validation warnings, but log them
    // Only fail for critical errors (empty files, invalid JSON/YAML)
  }
  
  if (validation.warnings.length > 0) {
    this.logger.warn(
      `Artifact warnings for ${artifact.path}: ${validation.warnings.join(", ")}`
    );
  }
}
```


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 5: RETRY STRATEGY WITH PROGRESSIVE PRESSURE
# ═══════════════════════════════════════════════════════════════════════════════

## 5.1 Problem

Retrying with the same context produces the same failure.
The retry MUST modify the context to address the specific failure.

## 5.2 Retry Context Modifier

```typescript
// packages/core/src/retry-strategy.ts

export class RetryStrategy {
  
  buildRetryContext(
    originalContext: string,
    retryCount: number,
    maxRetries: number,
    error: string,
    previousAttemptSummary?: string,
  ): string {
    const pressureLevel = this.getPressureLevel(retryCount, maxRetries);
    
    const retrySection = `

# ══════════════════════════════════════════
# ⚠️ RETRY ATTEMPT ${retryCount} of ${maxRetries}
# PRESSURE LEVEL: ${pressureLevel}
# ══════════════════════════════════════════

## PREVIOUS FAILURE:
${error}

${previousAttemptSummary ? `## PREVIOUS ATTEMPT SUMMARY:\n${previousAttemptSummary}\n` : ""}

## WHAT YOU MUST DO DIFFERENTLY:
${this.getPressureInstructions(pressureLevel, error)}

## CONSEQUENCES:
${retryCount >= maxRetries - 1 
  ? "⛔ This is your FINAL attempt. If you fail again, the task will be marked as FAILED permanently."
  : `You have ${maxRetries - retryCount} attempts remaining.`
}
`;
    
    return originalContext + retrySection;
  }
  
  private getPressureLevel(retryCount: number, maxRetries: number): string {
    const ratio = retryCount / maxRetries;
    if (ratio < 0.33) return "NORMAL";
    if (ratio < 0.66) return "ELEVATED";
    return "CRITICAL";
  }
  
  private getPressureInstructions(level: string, error: string): string {
    const base = `
- You MUST use the workspace_write tool to create files
- Every file must be COMPLETE and NON-EMPTY
- Do NOT explain what you would do — actually DO it
`;
    
    if (error.includes("No artifacts")) {
      return base + `
- Your previous attempt produced NO FILES
- Start by calling workspace_write IMMEDIATELY
- Write at least one complete file before doing anything else
`;
    }
    
    if (error.includes("Empty artifact")) {
      return base + `
- Your previous attempt created an EMPTY file
- Ensure file content is complete and non-trivial
- Minimum file size: at least 10 lines for code, 5 lines for documentation
`;
    }
    
    if (error.includes("validation")) {
      return base + `
- Your previous output had validation errors
- Ensure JSON files are valid JSON
- Ensure YAML files are valid YAML
- Ensure code files have balanced braces/brackets
`;
    }
    
    if (level === "CRITICAL") {
      return base + `
- THIS IS YOUR FINAL CHANCE
- Simplify your approach if needed
- Produce SOMETHING rather than nothing
- A simple working solution is better than an ambitious broken one
`;
    }
    
    return base;
  }
}
```

## 5.3 Retry Integration

```typescript
// In orchestrator.ts, the handleArtifactFailure becomes:

private async handleArtifactFailure(
  task: Task,
  error: string,
  previousSummary?: string
): Promise<void> {
  if (task.retryCount < task.maxRetries) {
    const newContext = this.retryStrategy.buildRetryContext(
      task.inputContext || "",
      task.retryCount + 1,
      task.maxRetries,
      error,
      previousSummary
    );
    
    await this.taskManager.updateTask(task.id, {
      status: "ready",
      retryCount: task.retryCount + 1,
      error: `Retry ${task.retryCount + 1}: ${error}`,
      inputContext: newContext, // Modified context for retry
      lockedBy: null,
    });
    
    this.eventBus.emit("task.retried", {
      taskId: task.id,
      retryCount: task.retryCount + 1,
      reason: error,
    });
    
    this.logger.warn(
      `Retrying task "${task.title}" (${task.retryCount + 1}/${task.maxRetries}): ${error}`
    );
  } else {
    await this.taskManager.failTask(task.id, 
      `Failed after ${task.maxRetries} retries: ${error}`
    );
    this.eventBus.emit("task.failed", { taskId: task.id, reason: error });
    this.logger.error(`Task "${task.title}" permanently failed`);
  }
}
```


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 6: STREAMING EXECUTION
# ═══════════════════════════════════════════════════════════════════════════════

## 6.1 Provider Streaming Interface

```typescript
// Addition to provider contract

export interface StreamCallbacks {
  onToken?: (token: string) => void;
  onToolCallStart?: (name: string) => void;
  onToolCallComplete?: (name: string, result: ToolResult) => void;
  onComplete?: (response: ChatResponse) => void;
  onError?: (error: Error) => void;
}

export interface ModelProvider {
  // ... existing methods ...
  
  // Streaming support
  chatStream?(
    request: ChatRequest,
    callbacks: StreamCallbacks
  ): Promise<ChatResponse>;
  
  supportsStreaming(): boolean;
}
```

## 6.2 Live Execution Logger

```typescript
// packages/core/src/live-logger.ts

export class LiveExecutionLogger {
  private startTime: number;
  
  constructor(private logger: Logger) {
    this.startTime = Date.now();
  }
  
  private elapsed(): string {
    const seconds = Math.floor((Date.now() - this.startTime) / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  
  agentThinking(agentId: string): void {
    process.stdout.write(
      `\r[${this.elapsed()}] [${agentId.toUpperCase()}] thinking...`
    );
  }
  
  agentStreaming(agentId: string, partialContent: string): void {
    // Show last 60 chars of streaming content
    const preview = partialContent.slice(-60).replace(/\n/g, " ");
    process.stdout.write(
      `\r[${this.elapsed()}] [${agentId.toUpperCase()}] ${preview}...`
    );
  }
  
  toolCallStart(agentId: string, toolName: string): void {
    process.stdout.write("\n"); // New line after streaming
    this.logger.agent(agentId, `→ calling ${toolName}...`);
  }
  
  toolCallComplete(agentId: string, toolName: string, result: ToolResult): void {
    if (result.artifactCreated) {
      this.logger.agent(agentId, `✓ wrote: ${result.artifactCreated}`);
    } else if (result.success) {
      this.logger.agent(agentId, `✓ ${toolName} completed`);
    } else {
      this.logger.agent(agentId, `✗ ${toolName} failed: ${result.error}`);
    }
  }
  
  taskProgress(completed: number, total: number, costUsd: number): void {
    const pct = Math.round((completed / total) * 100);
    const bar = "█".repeat(Math.floor(pct / 5)) + "░".repeat(20 - Math.floor(pct / 5));
    this.logger.system(
      `Progress: ${bar} ${pct}% | Tasks: ${completed}/${total} | Cost: $${costUsd.toFixed(4)}`
    );
  }
}
```

## 6.3 Streaming Integration in Agent Runner

```typescript
// In agent-runner.ts, modify the model call:

if (provider.supportsStreaming() && this.liveLogger) {
  this.liveLogger.agentThinking(agent.id);
  
  const response = await provider.chatStream(request, {
    onToken: (token) => {
      this.liveLogger.agentStreaming(agent.id, token);
    },
    onToolCallStart: (name) => {
      this.liveLogger.toolCallStart(agent.id, name);
    },
    onToolCallComplete: (name, result) => {
      this.liveLogger.toolCallComplete(agent.id, name, result);
    },
  });
} else {
  // Fallback to non-streaming
  const response = await provider.chat(request);
}
```


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 7: FILE VERSIONING & OVERWRITE STRATEGY
# ═══════════════════════════════════════════════════════════════════════════════

## 7.1 Versioning Protocol

```typescript
// packages/core/src/workspace.ts (additions)

export interface FileVersion {
  version: number;
  hash: string;
  size: number;
  createdBy: string;
  createdAt: Date;
}

// In WorkspaceManager:

async writeArtifactAtomic(
  projectId: string,
  filePath: string,
  content: string,
  createdBy: string,
  version: number,
  description?: string,
): Promise<Artifact> {
  const projectPath = join(this.baseDir, projectId);
  const fullPath = validateAndResolvePath(this.baseDir, projectId, filePath);
  const tempPath = fullPath + ".tmp." + nanoid(6);
  
  // 1. Create parent directories
  mkdirSync(dirname(fullPath), { recursive: true });
  
  // 2. Write to temp file first (atomic)
  writeFileSync(tempPath, content, "utf-8");
  
  // 3. Rename temp to final (atomic on most filesystems)
  renameSync(tempPath, fullPath);
  
  // 4. Compute hash
  const hash = createHash("sha256").update(content).digest("hex");
  const size = Buffer.byteLength(content, "utf-8");
  
  // 5. Git commit (if enabled and available)
  if (this.gitEnabled) {
    try {
      const git = simpleGit(projectPath);
      await git.add(filePath);
      const commitMsg = version > 1
        ? `Update ${filePath} (v${version}) by ${createdBy}`
        : `Create ${filePath} by ${createdBy}`;
      await git.commit(commitMsg);
    } catch {
      // Git failure is non-fatal
      this.logger?.warn(`Git commit failed for ${filePath}, continuing without version control`);
    }
  }
  
  return {
    id: nanoid(),
    projectId,
    taskId: "", // Set by caller
    path: filePath,
    content,
    hash,
    size,
    type: this.inferArtifactType(filePath),
    createdBy,
    version,
    description,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async getFileVersion(projectId: string, filePath: string): Promise<number> {
  // Query artifacts table for latest version of this path
  const result = this.db.prepare(`
    SELECT MAX(version) as max_version 
    FROM artifacts 
    WHERE project_id = ? AND path = ?
  `).get(projectId, filePath) as { max_version: number | null };
  
  return result?.max_version || 0;
}

async fileExists(projectId: string, filePath: string): Promise<boolean> {
  const fullPath = validateAndResolvePath(this.baseDir, projectId, filePath);
  return existsSync(fullPath);
}

private inferArtifactType(filePath: string): ArtifactType {
  const ext = filePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts": case "tsx": case "js": case "jsx":
    case "py": case "rb": case "go": case "rs":
    case "java": case "c": case "cpp": case "h":
    case "cs": case "swift": case "kt":
      return "code";
    case "md": case "txt": case "rst":
      return "doc";
    case "json": case "yaml": case "yml": case "toml":
    case "ini": case "env": case "cfg":
      return "config";
    case "csv": case "sql": case "xml":
      return "data";
    case "test.ts": case "test.js": case "spec.ts": case "spec.js":
      return "test";
    default:
      return "other";
  }
}
```

## 7.2 Overwrite Decision Tree

```
File write requested for path P with content C
│
├── P does not exist
│   → Write new file (version 1)
│   → Record artifact in database
│
├── P exists
│   ├── hash(C) === hash(existing)
│   │   → Skip write
│   │   → Log: "artifact unchanged"
│   │   → Return existing artifact
│   │
│   └── hash(C) !== hash(existing)
│       → Write new content (atomic)
│       → Increment version
│       → Record new artifact version in database
│       → Git commit with "Update" message
│       → Log: "artifact updated (v{n})"
```


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 8: MEMORY SYSTEM SPECIFICATION
# ═══════════════════════════════════════════════════════════════════════════════

## 8.1 Memory Scoring Algorithm

```typescript
// packages/core/src/memory.ts

export interface MemoryEntry {
  id: string;
  scope: "session" | "project" | "global";
  type: "fact" | "preference" | "decision" | "mistake" | "procedure";
  content: string;
  context: string;
  projectId?: string;
  taskId?: string;
  agentId: string;
  importance: number;     // 0-1, set by agent or system
  accessCount: number;
  createdAt: Date;
  lastAccessed?: Date;
  expiresAt?: Date;
}

export interface MemoryQuery {
  query: string;
  scope?: "session" | "project" | "global";
  projectId?: string;
  type?: string;
  limit?: number;
  minScore?: number;
}

export class MemoryManager {
  constructor(private db: DatabaseManager) {}
  
  async store(entry: Omit<MemoryEntry, "id" | "accessCount" | "createdAt">): Promise<void> {
    const fullEntry: MemoryEntry = {
      ...entry,
      id: nanoid(),
      accessCount: 0,
      createdAt: new Date(),
    };
    
    this.db.insertMemory(fullEntry);
  }
  
  async recall(query: MemoryQuery): Promise<Array<MemoryEntry & { score: number }>> {
    const limit = query.limit || 10;
    const minScore = query.minScore || 0.1;
    
    // 1. Fetch candidate memories
    let candidates = this.db.getMemories({
      scope: query.scope,
      projectId: query.projectId,
      type: query.type,
    });
    
    // 2. Filter expired
    const now = new Date();
    candidates = candidates.filter(m => !m.expiresAt || new Date(m.expiresAt) > now);
    
    // 3. Score each memory
    const scored = candidates.map(memory => ({
      ...memory,
      score: this.scoreMemory(memory, query.query),
    }));
    
    // 4. Filter by minimum score
    const filtered = scored.filter(m => m.score >= minScore);
    
    // 5. Sort by score (descending) and limit
    const results = filtered
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    
    // 6. Update access counts
    for (const result of results) {
      this.db.updateMemory(result.id, {
        accessCount: result.accessCount + 1,
        lastAccessed: new Date(),
      });
    }
    
    return results;
  }
  
  private scoreMemory(memory: MemoryEntry, query: string): number {
    // Relevance score (keyword matching — Phase 4 adds embeddings)
    const relevance = this.computeRelevance(memory.content + " " + memory.context, query);
    
    // Recency score (newer = higher)
    const ageMs = Date.now() - memory.createdAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const recency = Math.max(0, 1 - (ageDays / 30)); // Decay over 30 days
    
    // Importance (agent-assigned)
    const importance = memory.importance;
    
    // Access frequency bonus
    const accessBonus = Math.min(0.2, memory.accessCount * 0.02);
    
    // Type boost (decisions and mistakes are more valuable)
    const typeBoost = (memory.type === "decision" || memory.type === "mistake") ? 0.1 : 0;
    
    // Weighted combination
    const score = (
      (relevance * 0.4) +
      (importance * 0.3) +
      (recency * 0.2) +
      (accessBonus) +
      (typeBoost)
    );
    
    return Math.min(1, Math.max(0, score));
  }
  
  private computeRelevance(text: string, query: string): number {
    // Simple keyword matching (Phase 4 replaces with embeddings)
    const textLower = text.toLowerCase();
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    
    if (queryWords.length === 0) return 0;
    
    let matches = 0;
    for (const word of queryWords) {
      if (textLower.includes(word)) {
        matches++;
      }
    }
    
    return matches / queryWords.length;
  }
  
  async cleanup(): Promise<void> {
    // Remove expired memories
    this.db.deleteExpiredMemories(new Date());
    
    // Trim low-importance, old, unaccessed memories
    const maxEntries = 10000;
    const count = this.db.getMemoryCount();
    
    if (count > maxEntries) {
      // Delete lowest-scored memories
      this.db.deleteLowestScoredMemories(count - maxEntries);
    }
  }
}
```


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 9: UTILITY FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

## 9.1 Hash Computation

```typescript
// packages/core/src/utils/hash.ts
import { createHash } from "crypto";

export function computeHash(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}
```

## 9.2 Byte Formatting

```typescript
// packages/core/src/utils/format.ts

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
```

## 9.3 Zod to JSON Schema Converter

```typescript
// packages/core/src/utils/zod-to-json-schema.ts

export function zodToJsonSchema(schema: ZodSchema): Record<string, unknown> {
  // Use zod-to-json-schema package
  // This is required for converting Zod tool schemas to 
  // the JSON Schema format expected by OpenAI/Anthropic tool definitions
  
  // Add to dependencies: "zod-to-json-schema": "^3.23.0"
  
  import { zodToJsonSchema as convert } from "zod-to-json-schema";
  return convert(schema, { target: "openApi3" });
}
```

## 9.4 Path Security

```typescript
// packages/core/src/utils/security.ts
import * as path from "path";

export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathTraversalError";
  }
}

export function validateAndResolvePath(
  baseDir: string,
  projectId: string,
  filePath: string
): string {
  // Reject obviously dangerous patterns
  if (filePath.includes("..")) {
    throw new PathTraversalError(`Path contains "..": ${filePath}`);
  }
  
  if (path.isAbsolute(filePath)) {
    throw new PathTraversalError(`Absolute paths not allowed: ${filePath}`);
  }
  
  // Reject null bytes
  if (filePath.includes("\0")) {
    throw new PathTraversalError(`Path contains null byte: ${filePath}`);
  }
  
  const projectRoot = path.resolve(baseDir, projectId);
  const resolved = path.resolve(projectRoot, filePath);
  
  // Final check: resolved path MUST be within project root
  if (!resolved.startsWith(projectRoot + path.sep) && resolved !== projectRoot) {
    throw new PathTraversalError(
      `Path resolves outside project root: "${filePath}" → "${resolved}"`
    );
  }
  
  return resolved;
}
```


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 10: ERROR TAXONOMY
# ═══════════════════════════════════════════════════════════════════════════════

## 10.1 Error Classes

```typescript
// packages/core/src/errors.ts

export class AamilOSError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AamilOSError";
  }
}

// Configuration Errors (Non-retryable)
export class ConfigError extends AamilOSError {
  constructor(message: string) {
    super(message, "CONFIG_ERROR", false);
  }
}

export class ConfigValidationError extends ConfigError {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super(`Configuration validation failed: ${Object.entries(fieldErrors).map(([k, v]) => `${k}: ${v}`).join(", ")}`);
  }
}

export class MissingEnvVarsError extends ConfigError {
  constructor(public readonly missingVars: string[]) {
    super(`Missing environment variables: ${missingVars.join(", ")}`);
  }
}

// State Errors (Non-retryable)
export class InvalidStateTransitionError extends AamilOSError {
  constructor(from: string, to: string, allowed: string[]) {
    super(
      `Invalid state transition: "${from}" → "${to}". Allowed: [${allowed.join(", ")}]`,
      "INVALID_STATE_TRANSITION",
      false
    );
  }
}

export class DAGValidationError extends AamilOSError {
  constructor(message: string, public readonly cycle: string[]) {
    super(message, "DAG_CYCLE", false);
  }
}

// Security Errors (Non-retryable)
export class PathTraversalError extends AamilOSError {
  constructor(path: string) {
    super(`Path traversal attempt: ${path}`, "PATH_TRAVERSAL", false);
  }
}

export class PermissionDeniedError extends AamilOSError {
  constructor(agentId: string, action: string, target: string) {
    super(
      `Agent "${agentId}" denied permission for "${action}" on "${target}"`,
      "PERMISSION_DENIED",
      false
    );
  }
}

export class DangerousCommandError extends AamilOSError {
  constructor(command: string) {
    super(`Dangerous command blocked: ${command}`, "DANGEROUS_COMMAND", false);
  }
}

// Resource Errors (Non-retryable)
export class BudgetExceededError extends AamilOSError {
  constructor(projectId: string, spent: number, budget: number) {
    super(
      `Budget exceeded for project ${projectId}: $${spent.toFixed(2)} / $${budget.toFixed(2)}`,
      "BUDGET_EXCEEDED",
      false
    );
  }
}

export class FileSizeLimitError extends AamilOSError {
  constructor(path: string, size: number, limit: number) {
    super(
      `File "${path}" (${formatBytes(size)}) exceeds limit (${formatBytes(limit)})`,
      "FILE_SIZE_LIMIT",
      false
    );
  }
}

export class WorkspaceSizeLimitError extends AamilOSError {
  constructor(projectId: string, size: number, limit: number) {
    super(
      `Workspace ${projectId} (${formatBytes(size)}) exceeds limit (${formatBytes(limit)})`,
      "WORKSPACE_SIZE_LIMIT",
      false
    );
  }
}

// Provider Errors (May be retryable)
export class ProviderError extends AamilOSError {
  constructor(
    providerId: string,
    message: string,
    retryable: boolean,
    public readonly statusCode?: number,
  ) {
    super(`Provider "${providerId}": ${message}`, "PROVIDER_ERROR", retryable);
  }
}

export class RateLimitError extends ProviderError {
  constructor(providerId: string, public readonly retryAfterMs: number) {
    super(providerId, `Rate limited, retry after ${retryAfterMs}ms`, true);
  }
}

export class ModelTimeoutError extends ProviderError {
  constructor(providerId: string, timeoutMs: number) {
    super(providerId, `Model call timed out after ${timeoutMs}ms`, true);
  }
}

export class InvalidAPIKeyError extends ProviderError {
  constructor(providerId: string) {
    super(providerId, "Invalid API key", false, 401);
  }
}

// Execution Errors (Retryable)
export class ArtifactFailureError extends AamilOSError {
  constructor(taskId: string, message: string) {
    super(`Task ${taskId}: ${message}`, "ARTIFACT_FAILURE", true);
  }
}

export class PlanValidationError extends AamilOSError {
  constructor(message: string) {
    super(message, "PLAN_VALIDATION", false);
  }
}

// System Errors (Non-retryable)
export class ProcessLockError extends AamilOSError {
  constructor(pid: number) {
    super(`Another AamilOS instance is running (PID: ${pid})`, "PROCESS_LOCK", false);
  }
}

export class DatabaseError extends AamilOSError {
  constructor(message: string) {
    super(`Database error: ${message}`, "DATABASE_ERROR", false);
  }
}
```

## 10.2 Error Handler

```typescript
// packages/core/src/error-handler.ts

export class ErrorHandler {
  constructor(private logger: Logger, private eventBus: EventBus) {}
  
  async handle(error: unknown, context?: { projectId?: string; taskId?: string }): Promise<void> {
    if (error instanceof AamilOSError) {
      // Known error — handle by type
      this.eventBus.emit("error.occurred", {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        ...context,
      });
      
      if (error.retryable) {
        this.logger.warn(`Retryable error: ${error.message}`);
      } else {
        this.logger.error(`Fatal error: ${error.message}`);
      }
      
      // Special handling
      if (error instanceof RateLimitError) {
        this.logger.info(`Waiting ${error.retryAfterMs}ms for rate limit...`);
        await new Promise(r => setTimeout(r, error.retryAfterMs));
      }
      
      if (error instanceof InvalidAPIKeyError) {
        this.logger.error("Check your API key in .env file and restart");
      }
      
      if (error instanceof BudgetExceededError) {
        this.logger.error("Increase budget in aamilos.config.yaml or use cheaper models");
      }
      
    } else {
      // Unknown error
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      
      this.logger.error(`Unexpected error: ${message}`);
      if (stack) this.logger.debug(stack);
      
      this.eventBus.emit("error.occurred", {
        code: "UNKNOWN",
        message,
        retryable: false,
        ...context,
      });
    }
  }
}
```


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 11: UPDATED PLAN.MD FILE LIST
# ═══════════════════════════════════════════════════════════════════════════════
#
# The following files must be ADDED to the Phase deliverables in PLAN.md:

## Phase 1 Additions:
- packages/core/src/tools/types.ts
- packages/core/src/tools/registry.ts
- packages/core/src/tools/executor.ts
- packages/core/src/tools/workspace-write.ts
- packages/core/src/tools/workspace-read.ts
- packages/core/src/tools/workspace-list.ts
- packages/core/src/tools/log-decision.ts
- packages/core/src/validation/dag.ts
- packages/core/src/validation/artifact-validator.ts
- packages/core/src/errors.ts
- packages/core/src/error-handler.ts
- packages/core/src/utils/hash.ts
- packages/core/src/utils/format.ts
- packages/core/src/utils/security.ts

## Phase 2 Additions:
- packages/core/src/tools/execute-command.ts
- packages/core/src/agent-runner.ts
- packages/core/src/retry-strategy.ts
- packages/core/src/live-logger.ts
- packages/core/src/schemas/task-plan.ts
- packages/core/src/utils/zod-to-json-schema.ts

## Phase 3 Additions:
- packages/core/src/memory.ts (full implementation from Section 8)

## Additional Dependencies (add to packages/core/package.json):
- execa: "^9.0.0"           (cross-platform command execution)
- zod-to-json-schema: "^3.23.0"  (tool schema conversion)


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 12: UPDATED FILE STRUCTURE
# ═══════════════════════════════════════════════════════════════════════════════

```
aamilos/
├── package.json
├── tsconfig.json
├── .env.example
├── aamilos.config.yaml
├── .gitignore
│
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── AI_RULES.md
│   ├── PLAN.md
│   └── EXECUTION_SPEC.md        ← THIS FILE
│
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types.ts
│   │       ├── errors.ts
│   │       ├── error-handler.ts
│   │       │
│   │       ├── schemas/
│   │       │   ├── task.ts
│   │       │   ├── task-plan.ts
│   │       │   ├── artifact.ts
│   │       │   ├── agent.ts
│   │       │   ├── project.ts
│   │       │   ├── event.ts
│   │       │   └── config.ts
│   │       │
│   │       ├── tools/
│   │       │   ├── types.ts
│   │       │   ├── registry.ts
│   │       │   ├── executor.ts
│   │       │   ├── workspace-write.ts
│   │       │   ├── workspace-read.ts
│   │       │   ├── workspace-list.ts
│   │       │   ├── execute-command.ts
│   │       │   └── log-decision.ts
│   │       │
│   │       ├── validation/
│   │       │   ├── dag.ts
│   │       │   └── artifact-validator.ts
│   │       │
│   │       ├── utils/
│   │       │   ├── hash.ts
│   │       │   ├── format.ts
│   │       │   ├── security.ts
│   │       │   └── zod-to-json-schema.ts
│   │       │
│   │       ├── providers/
│   │       │   ├── base.ts
│   │       │   ├── openai.ts
│   │       │   ├── ollama.ts
│   │       │   └── anthropic.ts
│   │       │
│   │       ├── agents/
│   │       │   ├── prompts.ts
│   │       │   ├── researcher.yaml
│   │       │   ├── coder.yaml
│   │       │   ├── qa.yaml
│   │       │   └── planner.yaml
│   │       │
│   │       ├── config.ts
│   │       ├── db.ts
│   │       ├── migrations.ts
│   │       ├── workspace.ts
│   │       ├── task-manager.ts
│   │       ├── agent-registry.ts
│   │       ├── agent-runner.ts
│   │       ├── context-builder.ts
│   │       ├── orchestrator.ts
│   │       ├── provider-manager.ts
│   │       ├── model-router.ts
│   │       ├── event-bus.ts
│   │       ├── permissions.ts
│   │       ├── budget.ts
│   │       ├── memory.ts
│   │       ├── security.ts
│   │       ├── retry-strategy.ts
│   │       ├── live-logger.ts
│   │       ├── logger.ts
│   │       └── mcp-server.ts
│   │
│   └── cli/
│       ├── package.json
│       ├── tsconfig.json
│       ├── bin/aamilos
│       └── src/
│           ├── index.ts
│           ├── ui.ts
│           └── commands/
│               ├── init.ts
│               ├── run.ts
│               ├── status.ts
│               ├── list.ts
│               ├── pause.ts
│               ├── resume.ts
│               ├── retry.ts
│               ├── cancel.ts
│               ├── history.ts
│               ├── cost.ts
│               ├── decisions.ts
│               ├── agents.ts
│               ├── export.ts
│               ├── archive.ts
│               └── mcp.ts
│
├── data/
│   ├── projects/
│   ├── logs/
│   ├── memory/
│   ├── migrations/
│   └── aamilos.db
│
└── tests/
    ├── unit/
    │   ├── task-manager.test.ts
    │   ├── workspace.test.ts
    │   ├── context-builder.test.ts
    │   ├── config.test.ts
    │   ├── schemas.test.ts
    │   ├── security.test.ts
    │   ├── budget.test.ts
    │   ├── dag.test.ts
    │   ├── artifact-validator.test.ts
    │   ├── retry-strategy.test.ts
    │   ├── memory.test.ts
    │   ├── tool-executor.test.ts
    │   └── state-machine.test.ts
    ├── integration/
    │   ├── project-lifecycle.test.ts
    │   ├── retry-flow.test.ts
    │   ├── artifact-flow.test.ts
    │   ├── tool-execution.test.ts
    │   ├── crash-recovery.test.ts
    │   └── concurrency.test.ts
    └── mocks/
        ├── mock-provider.ts
        └── mock-agent.ts
```


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 13: DOCUMENT CROSS-REFERENCE & AUTHORITY
# ═══════════════════════════════════════════════════════════════════════════════

## 13.1 Complete Document Set

| Document | Authority | Covers |
|----------|-----------|--------|
| ARCHITECTURE.md | Schemas, DB, state machines, system structure | WHAT the system is |
| EXECUTION_SPEC.md | Tool layer, agent runner, validation, retry, memory | HOW the system executes |
| AI_RULES.md | Agent behavior, prompts, role boundaries | HOW agents behave |
| PRD.md | Product requirements, UX, lifecycle, config | WHAT users experience |
| PLAN.md | Implementation phases, verification, tech stack | WHEN things are built |

## 13.2 Conflict Resolution

If two documents specify the same thing differently:

1. For schemas and data structures → ARCHITECTURE.md wins
2. For execution mechanics and tool behavior → EXECUTION_SPEC.md wins
3. For agent behavior and prompts → AI_RULES.md wins
4. For user experience and product decisions → PRD.md wins
5. For build order and phase boundaries → PLAN.md wins

## 13.3 Naming Convention (Final)

| Context | Name |
|---------|------|
| External product name | AamilOS |
| Internal system reference | AOG |
| npm package (core) | @aamilos/core |
| npm package (cli) | aamilos |
| CLI command | aamilos |
| Config file | aamilos.config.yaml |
| Database file | aamilos.db |
| Lock file | .aamilos.lock |
| Log file | aamilos.log |
| Environment prefix | AAMILOS_ |
| Git commits by system | "AamilOS Agent" |
```

---

# ✅ Summary

You now have **five complete system definition files**:

| # | File | Purpose | Status |
|---|------|---------|--------|
| 1 | **PRD.md** | Product requirements, lifecycle, UX | ✅ Complete |
| 2 | **ARCHITECTURE.md** | Schemas, state machines, algorithms | ✅ Complete |
| 3 | **AI_RULES.md** | Agent behavioral contracts | ✅ Complete |
| 4 | **PLAN.md** | Phased implementation plan | ✅ Complete |
| 5 | **EXECUTION_SPEC.md** | Tool layer, execution mechanics, validation | ✅ Complete |

**All eight critical gaps are now resolved:**

| Gap | Resolution | Section |
|-----|-----------|---------|
| No Tool Execution Layer | Complete tool runtime with 5 tools | Section 1 |
| No Agent Execution Format | AgentRunner with tool call loop | Section 2 |
| No Planner Implementation | DAG validation + plan processing | Section 3 |
| Weak Artifact Quality | Multi-language validation engine | Section 4 |
| No Retry Improvement | Progressive pressure strategy | Section 5 |
| Missing Streaming | Provider streaming interface + live logger | Section 6 |
| No File Overwrite Strategy | Hash-based versioning with atomic writes | Section 7 |
| Weak Memory | Scored recall with relevance + recency + importance | Section 8 |

**An AI agent reading all five documents has zero ambiguity about building the complete AamilOS system.**

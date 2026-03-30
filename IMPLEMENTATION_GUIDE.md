# 📄 IMPLEMENTATION_GUIDE.md — The Reality Enforcement Layer

This is the **sixth and final system definition file**. It exists for one purpose: **to prevent the AI agent from drifting into theoretical output and ensure every phase produces a verified, working system**.

---

```markdown
# ==============================================================================
# EAMILOS (AOG) — IMPLEMENTATION GUIDE & REALITY ENFORCEMENT
# VERSION: 1.0.0-FINAL
# AUTHORITY: OVERRIDES ALL OTHER DOCUMENTS FOR BUILD PROCESS DECISIONS
# AUDIENCE: THE AI AGENT BUILDING EAMILOS (NOT AGENTS RUNNING INSIDE IT)
# ==============================================================================
#
# PURPOSE:
# This document is the BRIDGE between specification and reality.
# It defines HOW the AI agent must build EamilOS to ensure the output
# is not theoretical code but a verified, runnable system.
#
# Every other document tells you WHAT to build.
# This document tells you HOW TO BUILD IT WITHOUT FAILING.
#
# WHY THIS EXISTS:
# The specifications (PRD, ARCHITECTURE, AI_RULES, PLAN, EXECUTION_SPEC)
# are comprehensive but they are blueprints. Without strict build process
# enforcement, the most likely outcome is:
#   - Folder structure created ✓
#   - Types/schemas written ✓
#   - Core logic partially implemented ✓
#   - Nothing actually runs ✗
#   - Tool execution never wired ✗
#   - System enters infinite retry loops ✗
#
# This document prevents that failure mode.
#
# AUTHORITY:
# For all build process decisions, this document OVERRIDES all others.
# If PLAN.md says "build X in Phase 1" but this document says
# "verify Y before building X", you verify Y first.
#
# ==============================================================================


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 1: THE SINGLE MOST IMPORTANT RULE
# ═══════════════════════════════════════════════════════════════════════════════

## 1.1 The Rule

DO NOT PROCEED TO THE NEXT PHASE UNTIL THE CURRENT PHASE IS VERIFIED WORKING.

"Working" means:
- Code compiles with zero errors
- CLI commands execute without crashes
- Database operations create/read/update records
- File operations create/read real files on disk
- Every function can be called and produces expected output

"Working" does NOT mean:
- Code looks correct
- Types are defined
- Logic seems right
- It should work in theory

## 1.2 The Build Sequence

```
For each phase:
  1. Write code for the phase
  2. Compile (npm run build) — MUST succeed with zero errors
  3. Run verification commands — MUST produce expected output
  4. Fix any failures — DO NOT move forward with known failures
  5. Only then proceed to next phase
```

## 1.3 The Cardinal Sin

The absolute worst thing you can do is:

```
Write Phase 1 → Write Phase 2 → Write Phase 3 → Write Phase 4 → Try to compile → 847 errors
```

This is what happens when you treat implementation as "writing files" instead of "building a working system". Every phase must compile and verify independently.


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 2: THE EXECUTION BRIDGE (CRITICAL MISSING PIECE)
# ═══════════════════════════════════════════════════════════════════════════════
#
# This is the #1 reason AI-built systems fail:
# There is no enforced connection between LLM output and the file system.
#
# The agent BUILDING EamilOS must understand this deeply.

## 2.1 The Problem

Your system has this flow:

```
Human Goal → Planner → Tasks → Agent → Model Call → ??? → Artifacts
```

The "???" is the execution bridge. Without it:
- Models return text describing what they would write
- No files are created
- Artifact validation finds nothing
- System retries infinitely
- Budget drains to zero
- Project fails

## 2.2 The Execution Bridge (Concrete)

The bridge is THREE components working together:

```
Component 1: Tool Definitions (given to the model)
    ↓
    Model knows what tools exist and how to call them
    ↓
Component 2: Agent Runner Loop (processes model responses)
    ↓
    Detects tool_calls in model response
    Extracts tool name + arguments
    Passes to executor
    Feeds results back to model
    Loops until model stops calling tools
    ↓
Component 3: Tool Executor (actually does the work)
    ↓
    Validates arguments with Zod
    Checks permissions
    Calls workspace.write / workspace.read / etc.
    Returns result to agent runner
```

If ANY of these three components is missing or broken, the entire system produces zero output.

## 2.3 Verification of the Bridge

Before Phase 2 is considered complete, this exact test MUST pass:

```typescript
// This is a LITERAL test, not pseudocode.
// The building agent must create this test and run it.

// test: tool-bridge-verification.test.ts

import { ToolRegistry } from "../src/tools/registry.js";
import { ToolExecutor } from "../src/tools/executor.js";
import { WorkspaceManager } from "../src/workspace.js";

test("tool execution bridge creates real files", async () => {
  // Setup
  const workspace = new WorkspaceManager("./test-data/projects", false);
  await workspace.createProject("test-project", "Test");
  
  const registry = new ToolRegistry();
  const executor = new ToolExecutor(registry, workspace, /* ... */);
  
  // Execute workspace_write tool
  const result = await executor.execute(
    {
      name: "workspace_write",
      arguments: {
        path: "hello.py",
        content: 'print("Hello, World!")',
        description: "Test file",
      },
    },
    {
      projectId: "test-project",
      taskId: "test-task",
      agentId: "test-agent",
      correlationId: "test-corr",
    }
  );
  
  // Verify
  expect(result.success).toBe(true);
  expect(result.artifactCreated).toBe("hello.py");
  
  // Verify file ACTUALLY EXISTS on disk
  const content = await workspace.readArtifact("test-project", "hello.py");
  expect(content).toBe('print("Hello, World!")');
  
  // Cleanup
  // ... remove test-data/projects/test-project
});
```

If this test fails, STOP. Fix it before doing anything else.

## 2.4 The Model Integration Test

After the tool bridge works, verify the FULL chain:

```
Model receives: system prompt + tools
Model returns: { tool_calls: [{ name: "workspace_write", arguments: {...} }] }
Agent Runner: processes tool calls
Tool Executor: writes file
Agent Runner: sends result back to model
Model returns: { content: "I created hello.py" }
Agent Runner: returns AgentExecutionResult with artifacts: ["hello.py"]
```

This can be tested with a MOCK provider that returns predetermined tool calls:

```typescript
// tests/mocks/mock-provider.ts

export class MockProvider implements ModelProvider {
  private callCount = 0;
  
  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.callCount++;
    
    if (this.callCount === 1) {
      // First call: model decides to write a file
      return {
        content: "",
        toolCalls: [
          {
            id: "call_001",
            name: "workspace_write",
            arguments: {
              path: "hello.py",
              content: 'print("Hello, World!")\n',
              description: "Main application file",
            },
          },
        ],
        usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.001 },
        latencyMs: 100,
        model: "mock-model",
        finishReason: "tool_calls",
      };
    }
    
    if (this.callCount === 2) {
      // Second call: model sees tool result, provides summary
      return {
        content: "I created hello.py with a simple Hello World program.",
        toolCalls: [],
        usage: { inputTokens: 150, outputTokens: 30, costUsd: 0.001 },
        latencyMs: 50,
        model: "mock-model",
        finishReason: "stop",
      };
    }
    
    // Safety: should not reach here
    return {
      content: "Done.",
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      latencyMs: 0,
      model: "mock-model",
      finishReason: "stop",
    };
  }
  
  async isAvailable(): Promise<boolean> { return true; }
  getModels() { return [{ id: "mock-model", tier: "strong" as const, context_window: 128000 }]; }
  getContextWindow() { return 128000; }
  estimateCost() { return 0.001; }
  supportsStreaming() { return false; }
}
```


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 3: PHASE-BY-PHASE BUILD PROTOCOL
# ═══════════════════════════════════════════════════════════════════════════════
#
# This section defines the EXACT sequence of actions for each phase.
# The building agent MUST follow this sequence. No skipping. No reordering.

## 3.1 PHASE 1 BUILD PROTOCOL

### Step 1.1: Project Scaffolding
```
ACTION: Create all config files and package.json files
FILES:
  - package.json (root)
  - tsconfig.json (root)
  - .env.example
  - eamilos.config.yaml
  - .gitignore
  - packages/core/package.json
  - packages/core/tsconfig.json
  - packages/cli/package.json
  - packages/cli/tsconfig.json
  - packages/cli/bin/eamilos

VERIFY:
  $ npm install
  EXPECTED: No errors. node_modules created.
  
  $ npx tsc --version
  EXPECTED: TypeScript version printed.
```

### Step 1.2: Error Classes
```
ACTION: Create error taxonomy
FILES:
  - packages/core/src/errors.ts

VERIFY:
  $ npm run build
  EXPECTED: Compiles. Errors are importable.
  
WHY FIRST: Every other module needs to throw typed errors.
           Building this first prevents "any" error patterns.
```

### Step 1.3: Utility Functions
```
ACTION: Create all utility modules
FILES:
  - packages/core/src/utils/hash.ts
  - packages/core/src/utils/format.ts
  - packages/core/src/utils/security.ts

VERIFY:
  $ npm run build
  EXPECTED: Compiles.
  
  Manual verification:
  - computeHash("test") returns consistent SHA-256
  - formatBytes(1024) returns "1.0 KB"
  - validateAndResolvePath rejects "../../../etc/passwd"
  - validateAndResolvePath accepts "src/main.py"
```

### Step 1.4: Schemas
```
ACTION: Create all Zod schemas
FILES:
  - packages/core/src/schemas/project.ts
  - packages/core/src/schemas/task.ts
  - packages/core/src/schemas/artifact.ts
  - packages/core/src/schemas/agent.ts
  - packages/core/src/schemas/event.ts
  - packages/core/src/schemas/config.ts
  - packages/core/src/types.ts (re-exports)

VERIFY:
  $ npm run build
  EXPECTED: Compiles. All types importable.
  
  Manual verification:
  - TaskSchema.parse(validTask) succeeds
  - TaskSchema.parse(invalidTask) throws ZodError
  - TASK_TRANSITIONS["completed"] returns [] (terminal state)
  - PROJECT_TRANSITIONS["active"] includes "completed"
```

### Step 1.5: Logger
```
ACTION: Create structured logger
FILES:
  - packages/core/src/logger.ts

VERIFY:
  $ npm run build
  EXPECTED: Compiles.
  
  Manual verification:
  - logger.info("test") prints blue text to console
  - logger.error("test") prints red text to console
  - logger.agent("coder", "working") prints cyan "[CODER] working"
  - If file logging enabled, JSON lines written to file
```

### Step 1.6: Event Bus
```
ACTION: Create event system
FILES:
  - packages/core/src/event-bus.ts

VERIFY:
  $ npm run build
  EXPECTED: Compiles.
  
  Manual verification:
  - emit("test.event", { foo: "bar" }) triggers registered handler
  - on("test.event", handler) registers handler
  - off("test.event", handler) removes handler
  - Multiple handlers for same event all fire
```

### Step 1.7: Config Loader
```
ACTION: Create config parser with env var resolution and Zod validation
FILES:
  - packages/core/src/config.ts

VERIFY:
  $ npm run build
  EXPECTED: Compiles.
  
  Manual verification with real config file:
  - loadConfig("eamilos.config.yaml") returns typed config
  - Missing env var → lists ALL missing vars in error message
  - Invalid YAML syntax → shows line number
  - Invalid field value → shows field-level Zod error
  - Valid config → returns EamilOSConfig object
```

### Step 1.8: Database
```
ACTION: Create SQLite manager with all tables
FILES:
  - packages/core/src/db.ts
  - packages/core/src/migrations.ts

VERIFY:
  $ npm run build
  EXPECTED: Compiles.
  
  Manual verification:
  - new DatabaseManager("./test.db") creates file
  - All tables exist (check with .tables)
  - insertProject → getProject returns same data
  - insertTask → getTask returns same data with parsed JSON fields
  - updateTask status → getTask shows new status
  - Date fields round-trip correctly (ISO string → Date → ISO string)
  - WAL mode is enabled (PRAGMA journal_mode returns "wal")
  - Foreign keys are enabled
  
  $ sqlite3 ./test.db ".tables"
  EXPECTED: projects tasks artifacts events schema_version agent_metrics memory
  
  $ rm ./test.db  (cleanup)
```

### Step 1.9: Workspace Manager
```
ACTION: Create file I/O with Git integration and security
FILES:
  - packages/core/src/workspace.ts
  - packages/core/src/security.ts

VERIFY:
  $ npm run build
  EXPECTED: Compiles.
  
  Manual verification:
  - createProject("test", "Test") creates directory
  - createProject initializes git repo (if git available)
  - writeArtifact creates file with correct content
  - writeArtifact creates parent directories automatically
  - writeArtifact commits to git with descriptive message
  - readArtifact returns file content
  - readArtifact throws on missing file
  - listFiles returns all files recursively
  - listFiles excludes .git directory
  
  SECURITY verification:
  - writeArtifact("test", "../../../etc/passwd", "hack") → throws PathTraversalError
  - writeArtifact("test", "/etc/passwd", "hack") → throws PathTraversalError
  - writeArtifact("test", "normal/file.txt", "ok") → succeeds
  - File larger than max_file_size_mb → throws FileSizeLimitError
```

### Step 1.10: Task Manager
```
ACTION: Create task CRUD with state machine enforcement and dependency resolution
FILES:
  - packages/core/src/task-manager.ts
  - packages/core/src/validation/dag.ts

VERIFY:
  $ npm run build
  EXPECTED: Compiles.
  
  Manual verification:
  - createTask returns task with generated ID
  - getTask returns task with parsed dependsOn and artifacts arrays
  - getReadyTasks: task with no deps → status becomes "ready"
  - getReadyTasks: task with unmet deps → stays "pending"
  - getReadyTasks: task with all deps completed → becomes "ready"
  - startTask: "ready" → "in_progress" succeeds
  - startTask: "completed" → "in_progress" throws InvalidStateTransitionError
  - completeTask: sets status, output, artifacts, completedAt
  - failTask with retries remaining: status → "ready", retryCount incremented
  - failTask with no retries: status → "failed"
  - getProjectStatus: returns correct counts
  
  DAG verification:
  - validateDAG with valid graph → no error
  - validateDAG with cycle (A→B→C→A) → throws DAGValidationError
  - validateDAG with self-reference (A→A) → throws DAGValidationError
  - validateDAG with missing dependency → throws DAGValidationError
```

### Step 1.11: Tool Layer (Foundation)
```
ACTION: Create tool types, registry, and executor
FILES:
  - packages/core/src/tools/types.ts
  - packages/core/src/tools/registry.ts
  - packages/core/src/tools/executor.ts
  - packages/core/src/tools/workspace-write.ts
  - packages/core/src/tools/workspace-read.ts
  - packages/core/src/tools/workspace-list.ts
  - packages/core/src/tools/log-decision.ts

NOTE: execute-command.ts is Phase 2 (requires sandboxing design)

VERIFY:
  $ npm run build
  EXPECTED: Compiles.
  
  Manual verification:
  - ToolRegistry registers all 4 tools
  - ToolRegistry.get("workspace_write") returns tool
  - ToolRegistry.getToolsForAgent(agent) returns filtered tools
  - ToolExecutor.execute(workspace_write, args) creates real file
  - ToolExecutor.execute(workspace_read, args) reads real file
  - ToolExecutor.execute(workspace_list, args) lists real files
  - ToolExecutor.execute(unknown_tool, args) returns error gracefully
  - ToolExecutor validates input with Zod (bad input → validation error)
  - workspace_write with path traversal → PathTraversalError
  - workspace_write same content twice → skips (hash match)
  - workspace_write different content → version incremented
```

### Step 1.12: Stubs for Phase 2
```
ACTION: Create minimal stubs that compile but mark Phase 2 work
FILES:
  - packages/core/src/provider-manager.ts    (stub: logs providers)
  - packages/core/src/model-router.ts        (stub: throws "Phase 2")
  - packages/core/src/agent-registry.ts      (stub: logs agent names)
  - packages/core/src/context-builder.ts     (stub: returns empty string)
  - packages/core/src/orchestrator.ts        (stub: logs "Phase 2 needed")
  - packages/core/src/agent-runner.ts        (stub: throws "Phase 2")
  - packages/core/src/permissions.ts         (stub: always allows)
  - packages/core/src/budget.ts              (stub: always within budget)
  - packages/core/src/memory.ts              (stub: empty recall)
  - packages/core/src/retry-strategy.ts      (stub: returns original context)
  - packages/core/src/error-handler.ts       (logs errors)
  - packages/core/src/validation/artifact-validator.ts (stub: always valid)

IMPORTANT: Each stub must:
  - Import correct types
  - Export correct class/interface
  - Have method signatures matching the spec
  - Contain a comment: // PHASE 2: Full implementation
  - NOT throw errors that break compilation
  - Return sensible defaults (empty arrays, true, null)

VERIFY:
  $ npm run build
  EXPECTED: Compiles with zero errors. Zero warnings about missing implementations.
```

### Step 1.13: Core Index
```
ACTION: Create EamilOS main class that wires everything together
FILES:
  - packages/core/src/index.ts

VERIFY:
  $ npm run build
  EXPECTED: Compiles.
  
  Manual verification:
  - new EamilOS() creates instance
  - os.init() loads config, creates DB, initializes workspace
  - os.createProject("Build hello world") creates project in DB and filesystem
  - os.getTaskManager() returns TaskManager
  - os.getWorkspace() returns WorkspaceManager
  - os.close() closes DB without error
```

### Step 1.14: CLI
```
ACTION: Create CLI with all Phase 1 commands
FILES:
  - packages/cli/src/index.ts
  - packages/cli/src/commands/init.ts
  - packages/cli/src/commands/run.ts
  - packages/cli/src/commands/status.ts
  - packages/cli/src/commands/list.ts
  - packages/cli/src/ui.ts

VERIFY:
  $ npm run build
  EXPECTED: Compiles.
  
  $ cd packages/cli && npm link && cd ../..
  EXPECTED: Global command "eamilos" now available.
  
  $ eamilos --version
  EXPECTED: "0.1.0"
  
  $ eamilos --help
  EXPECTED: Shows all commands with descriptions.
  
  $ eamilos init
  EXPECTED:
    - Creates eamilos.config.yaml if not exists
    - Creates .env if not exists
    - Creates data/ directory
    - Prints success message with next steps
  
  $ eamilos run "Build a hello world app"
  EXPECTED:
    - Creates project in data/projects/
    - Creates project record in SQLite
    - Initializes git repo in project directory
    - Prints project name and workspace path
    - Prints "[WARN] Orchestration not yet implemented (Phase 2)"
  
  $ eamilos status
  EXPECTED:
    - Shows the project created above
    - Shows: 0 tasks, status: active
  
  $ eamilos list
  EXPECTED:
    - Lists all projects with status and creation date
```

### Step 1.15: Phase 1 Final Verification
```
RUN ALL OF THESE IN SEQUENCE. ALL MUST PASS.

# Clean build
$ rm -rf packages/*/dist data/
$ npm run build
EXPECTED: Zero errors.

# Fresh init
$ eamilos init
EXPECTED: Config and directories created.

# Create project
$ eamilos run "Test project"
EXPECTED: Project created, workspace exists.

# Verify database
$ sqlite3 data/eamilos.db "SELECT id, name, status FROM projects;"
EXPECTED: One row with status "active".

# Verify workspace
$ ls data/projects/
EXPECTED: One directory for the project.

# Verify git
$ cd data/projects/<project-id> && git log --oneline && cd ../../..
EXPECTED: At least one commit (initial).

# Status check
$ eamilos status
EXPECTED: Shows project with 0 tasks.

# List check
$ eamilos list
EXPECTED: Shows project.

IF ANY STEP FAILS: Fix it before proceeding to Phase 2.
```

---

## 3.2 PHASE 2 BUILD PROTOCOL

### Prerequisites
```
BEFORE STARTING PHASE 2, VERIFY:
  ✅ Phase 1 Final Verification passes completely
  ✅ npm run build succeeds with zero errors
  ✅ eamilos init/run/status/list all work
  ✅ Database creates and queries correctly
  ✅ Workspace creates files and git commits
  ✅ Tool executor creates real files via workspace_write
  ✅ Task manager enforces state machine
  ✅ DAG validation catches cycles

IF ANY ARE NOT VERIFIED: Go back to Phase 1. Do not proceed.
```

### Step 2.1: Model Providers
```
ACTION: Implement real model providers
FILES:
  - packages/core/src/providers/base.ts
  - packages/core/src/providers/openai.ts
  - packages/core/src/providers/ollama.ts
  - packages/core/src/providers/anthropic.ts
  UPDATE: packages/core/src/provider-manager.ts (replace stub)

VERIFY:
  $ npm run build
  EXPECTED: Compiles.
  
  Manual verification (requires API key):
  - OpenAI provider: chat() returns response with content
  - OpenAI provider: chat() with tools returns tool_calls
  - OpenAI provider: isAvailable() returns true with valid key
  - OpenAI provider: isAvailable() returns false with invalid key
  - Ollama provider: isAvailable() returns true if Ollama running
  - Ollama provider: isAvailable() returns false if Ollama not running
  
  Mock verification (no API key needed):
  - MockProvider: chat() returns predetermined responses
  - MockProvider: tool_calls are properly formatted
```

### Step 2.2: Model Router
```
ACTION: Implement tier-based model selection with fallback
FILES:
  UPDATE: packages/core/src/model-router.ts (replace stub)

VERIFY:
  $ npm run build
  EXPECTED: Compiles.
  
  Manual verification:
  - Task type "coding" → selects "strong" tier model
  - Task type "research" → selects "cheap" tier model
  - Primary provider unavailable → falls back to next in chain
  - No providers available → throws clear error
  - Routing decision is logged
```

### Step 2.3: Agent System Prompts
```
ACTION: Create all agent prompts from AI_RULES.md
FILES:
  - packages/core/src/agents/prompts.ts
  - packages/core/src/agents/researcher.yaml
  - packages/core/src/agents/coder.yaml
  - packages/core/src/agents/qa.yaml
  - packages/core/src/agents/planner.yaml

VERIFY:
  $ npm run build
  EXPECTED: Compiles.
  
  Manual verification:
  - GLOBAL_SYSTEM_PREFIX is non-empty and contains Artifact Law
  - Each agent YAML loads and validates against AgentSchema
  - Each agent has systemPrompt, capabilities, tools list
```

### Step 2.4: Agent Registry
```
ACTION: Implement agent loading and capability matching
FILES:
  UPDATE: packages/core/src/agent-registry.ts (replace stub)

VERIFY:
  $ npm run build
  EXPECTED: Compiles.
  
  Manual verification:
  - loadPrebuiltAgents() loads 4 agents (researcher, coder, qa, planner)
  - findBestAgent("coding") returns coder agent
  - findBestAgent("research") returns researcher agent
  - findBestAgent("nonexistent") returns undefined or closest match
  - listAgents() returns all 4 agents
```

### Step 2.5: Context Builder
```
ACTION: Implement the full context builder from ARCHITECTURE.md Section 6
FILES:
  UPDATE: packages/core/src/context-builder.ts (replace stub)

VERIFY:
  $ npm run build
  EXPECTED: Compiles.
  
  Manual verification:
  - buildContext produces string with: system prefix, agent prompt, project info, task info
  - Dependency outputs are included when dependencies exist
  - Workspace files are listed
  - Large artifacts are summarized or truncated
  - Artifact enforcement section is present
  - Total context respects token budget (does not exceed model context window * 0.75)
  - Required sections (system, task, enforcement) are never cut
  - Optional sections (memory, workspace listing) are cut first when over budget
```

### Step 2.6: Retry Strategy
```
ACTION: Implement progressive pressure retry
FILES:
  UPDATE: packages/core/src/retry-strategy.ts (replace stub)

VERIFY:
  $ npm run build
  EXPECTED: Compiles.
  
  Manual verification:
  - buildRetryContext adds retry section to original context
  - Retry 1: NORMAL pressure, mentions previous error
  - Retry 2: ELEVATED pressure, stronger instructions
  - Retry 3 (final): CRITICAL pressure, warns this is last chance
  - Missing artifacts error → specific instructions about using workspace_write
  - Empty artifact error → specific instructions about non-empty content
```

### Step 2.7: Agent Runner (THE CRITICAL COMPONENT)
```
ACTION: Implement the agent execution loop with tool call processing
FILES:
  UPDATE: packages/core/src/agent-runner.ts (replace stub)
  NEW: packages/core/src/tools/execute-command.ts

THIS IS THE MOST IMPORTANT STEP IN THE ENTIRE BUILD.
IF THIS DOES NOT WORK, THE SYSTEM DOES NOT WORK.

VERIFY:
  $ npm run build
  EXPECTED: Compiles.
  
  CRITICAL VERIFICATION (with MockProvider):
  
  Test 1: Basic tool call flow
  - MockProvider returns workspace_write tool call
  - AgentRunner processes it
  - File appears on disk
  - MockProvider receives tool result
  - MockProvider returns summary
  - AgentRunner returns AgentExecutionResult with artifacts: ["hello.py"]
  
  Test 2: Multiple tool calls
  - MockProvider returns 3 workspace_write calls in sequence
  - All 3 files appear on disk
  - AgentExecutionResult.artifacts has 3 entries
  
  Test 3: Zero tool calls = failure
  - MockProvider returns only text content (no tool_calls)
  - AgentRunner returns { success: false }
  - Or: AgentRunner returns { artifacts: [] } (orchestrator catches this)
  
  Test 4: Tool error handling
  - MockProvider calls workspace_write with invalid path
  - Tool returns { success: false }
  - Error is fed back to model
  - Model gets chance to retry
  
  Test 5: Max iteration safety
  - MockProvider always returns tool calls (infinite loop)
  - AgentRunner stops after MAX_TOOL_ITERATIONS (20)
  - Returns whatever artifacts were created
  
  IF ANY TEST FAILS: STOP. This is the execution bridge.
  Nothing else matters until this works.
```

### Step 2.8: Task Plan Processing
```
ACTION: Implement planner output processing
FILES:
  - packages/core/src/schemas/task-plan.ts
  UPDATE: Orchestrator plan processing method

VERIFY:
  $ npm run build
  EXPECTED: Compiles.
  
  Manual verification:
  - Valid task-plan.json → creates tasks in database
  - Dependencies are correctly mapped from indices to real IDs
  - DAG validation runs on created tasks
  - Invalid JSON → throws PlanValidationError
  - Circular dependencies → throws DAGValidationError
```

### Step 2.9: Artifact Validator
```
ACTION: Implement language-aware validation
FILES:
  UPDATE: packages/core/src/validation/artifact-validator.ts (replace stub)

VERIFY:
  $ npm run build
  EXPECTED: Compiles.
  
  Manual verification:
  - Empty file → { valid: false, errors: ["File is empty"] }
  - Valid JSON → { valid: true }
  - Invalid JSON → { valid: false, errors: ["Invalid JSON: ..."] }
  - Valid YAML → { valid: true }
  - Invalid YAML → { valid: false, errors: ["Invalid YAML: ..."] }
  - Code with "// TODO" → { valid: true, warnings: ["Placeholder detected"] }
  - Code with unbalanced braces → { valid: false, errors: ["Unbalanced braces"] }
```

### Step 2.10: Budget Tracker
```
ACTION: Implement cost tracking and enforcement
FILES:
  UPDATE: packages/core/src/budget.ts (replace stub)

VERIFY:
  $ npm run build
  EXPECTED: Compiles.
  
  Manual verification:
  - recordUsage updates project totals in database
  - check() returns { exceeded: false } when under budget
  - check() returns { exceeded: true } when over budget
  - check() returns { warning: true } when past warning threshold
```

### Step 2.11: Orchestrator
```
ACTION: Implement the full orchestration loop
FILES:
  UPDATE: packages/core/src/orchestrator.ts (replace stub)
  UPDATE: packages/core/src/live-logger.ts

VERIFY:
  $ npm run build
  EXPECTED: Compiles.
  
  Manual verification WITH MOCK PROVIDER:
  - Create project with 2 tasks (no real LLM needed)
  - Task 1: no dependencies → becomes "ready"
  - Orchestrator assigns mock agent to Task 1
  - Mock agent runner produces artifact
  - Task 1 → "completed"
  - Task 2 depends on Task 1 → becomes "ready"
  - Orchestrator assigns mock agent to Task 2
  - Task 2 → "completed"
  - Project → "completed"
```

### Step 2.12: Wire Everything Together
```
ACTION: Update EamilOS class and CLI to use real orchestration
FILES:
  UPDATE: packages/core/src/index.ts
  UPDATE: packages/cli/src/commands/run.ts
  NEW: packages/cli/src/commands/cost.ts
  NEW: packages/cli/src/commands/decisions.ts
  NEW: packages/cli/src/commands/history.ts
  NEW: packages/cli/src/commands/agents.ts

VERIFY:
  $ npm run build
  EXPECTED: Compiles.
```

### Step 2.13: Phase 2 End-to-End Reality Test

```
THIS IS THE MOMENT OF TRUTH.
THIS TEST DETERMINES IF YOUR SYSTEM ACTUALLY WORKS.

# With a real API key configured:
$ eamilos run "Create a Python file that prints Hello World"

EXPECTED SEQUENCE:
  1. Project created
  2. Planner agent breaks goal into tasks
  3. Task graph displayed
  4. Coder agent assigned to coding task
  5. Coder agent calls workspace_write tool
  6. File appears in data/projects/<id>/
  7. Task marked completed
  8. Project marked completed

EXPECTED OUTPUT:
  🧠 EamilOS v0.1.0
  📁 Project: hello-world-<id>
  🎯 Goal: Create a Python file that prints Hello World
  
  [PLANNER] Breaking down goal...
  [PLANNER] ✓ wrote: artifacts/task-plan.json
  
  📋 Task Graph:
     1. write-code [coding] → ready
  
  [CODER] Working on: Write Python hello world
  [CODER] → calling workspace_write...
  [CODER] ✓ wrote: hello.py (28 bytes)
  ✅ Task 1/1 completed (1 artifact)
  
  ✅ PROJECT COMPLETED
  
  📁 Workspace:
     hello-world-<id>/
     ├── artifacts/
     │   └── task-plan.json
     └── hello.py

VERIFY THE FILE:
  $ cat data/projects/hello-world-<id>/hello.py
  EXPECTED: print("Hello, World!")
  
  $ python data/projects/hello-world-<id>/hello.py
  EXPECTED: Hello, World!

IF THIS DOES NOT WORK:
  - Check: Did the model return tool_calls? (Enable debug logging)
  - Check: Did the tool executor receive the call? (Check logs)
  - Check: Did workspace_write succeed? (Check for file on disk)
  - Check: Was the tool result fed back to the model? (Check message history)
  
  The failure is ALWAYS in the execution bridge (Section 2).
  Go back to Step 2.7 and verify the AgentRunner tests pass.
```

### Step 2.14: Phase 2 Extended Verification
```
ONLY AFTER the Hello World test passes, run these:

Test 2: Multi-file project
$ eamilos run "Create a Python calculator with add, subtract, multiply, divide functions and a main file that demonstrates usage"

EXPECTED:
  - Multiple files created (calculator.py, main.py or similar)
  - All files contain real code
  - No placeholders

Test 3: Research + Code
$ eamilos run "Build a Python CLI weather app using a free weather API"

EXPECTED:
  - Researcher agent runs first
  - Writes research findings to artifacts/
  - Coder agent reads research
  - Coder writes code that uses the API details from research
  - Context builder correctly passed research output to coder

Test 4: Retry behavior
  - Temporarily make MockProvider return no tool calls
  - Verify retry with pressure context
  - Verify max retries leads to task failure
  - Verify project fails gracefully

Test 5: Budget enforcement
  - Set max_cost_per_project_usd: 0.001
  - Run a project
  - Verify budget exceeded error
  - Verify project pauses/stops
```

---

## 3.3 PHASE 3 BUILD PROTOCOL

### Prerequisites
```
BEFORE STARTING PHASE 3, VERIFY:
  ✅ All Phase 2 verification passes
  ✅ Hello World reality test passes
  ✅ Multi-file project test passes
  ✅ Research + Code pipeline test passes
  ✅ Retry behavior verified
  ✅ Budget tracking works
```

### Phase 3 Steps
```
Step 3.1: Permissions Engine (replace stub)
Step 3.2: Memory System (replace stub with full implementation)
Step 3.3: Enhanced Budget Enforcement (hard stops)
Step 3.4: Project Lifecycle Commands (pause/resume/retry/cancel/export/archive)
Step 3.5: Security Enhancements (command sandboxing, secret detection)
Step 3.6: Phase 3 Verification

Each step follows the same pattern:
  1. Write code
  2. npm run build (must succeed)
  3. Manual verification (must pass)
  4. Next step
```

### Phase 3 Reality Test
```
$ eamilos run "Build a REST API with Express"

EXPECTED:
  - 5+ tasks created
  - Researcher finds Express docs
  - Coder writes server.js, routes, package.json
  - QA writes tests, produces test report
  - Permissions checked for file operations
  - Budget tracked and reported
  - Memory stores decisions for future recall
  
$ eamilos cost <project-id>
EXPECTED: Token and cost breakdown by task

$ eamilos decisions <project-id>
EXPECTED: All decisions made by agents

$ eamilos pause <project-id>
$ eamilos resume <project-id>
EXPECTED: Project pauses and resumes correctly
```

---

## 3.4 PHASE 4 BUILD PROTOCOL

### Prerequisites
```
BEFORE STARTING PHASE 4, VERIFY:
  ✅ All Phase 3 verification passes
  ✅ REST API project test produces working code
  ✅ Permissions prevent unauthorized actions
  ✅ Budget enforcement stops overspending
  ✅ Memory stores and recalls information
  ✅ Project lifecycle commands work
```

### Phase 4 Steps
```
Step 4.1: MCP Server Mode
Step 4.2: Enhanced Memory (embeddings if available)
Step 4.3: Unit Tests (all modules)
Step 4.4: Integration Tests (full lifecycle)
Step 4.5: Documentation (README, quickstart)
Step 4.6: Phase 4 Verification
```

### Phase 4 Reality Test
```
$ eamilos mcp
# In another terminal, connect with Claude Desktop or Cursor
# Create project via MCP tool
# Verify execution works through MCP

$ npm test
EXPECTED: All tests pass, coverage >= 80%
```


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 4: COMMON FAILURE MODES AND HOW TO DETECT THEM
# ═══════════════════════════════════════════════════════════════════════════════

## 4.1 Failure Mode: Agent Writes Code in Chat Instead of Files

SYMPTOM:
  - Agent returns long code blocks in response content
  - No tool_calls in model response
  - Zero artifacts in workspace

CAUSE:
  - System prompt does not strongly enough enforce tool usage
  - Model not receiving tool definitions in request
  - Model ignoring tools

DETECTION:
  if (response.toolCalls === undefined || response.toolCalls.length === 0) {
    // THIS IS THE FAILURE
    logger.error("Model returned no tool calls — execution bridge broken");
  }

FIX:
  1. Verify tools are passed in ChatRequest
  2. Verify system prompt contains explicit tool usage instructions
  3. Add to system prompt: "You MUST use the workspace_write tool. Do NOT write code in your response."
  4. If model consistently ignores tools → try different model
  5. Some models need tool_choice: "required" or tool_choice: "auto"

## 4.2 Failure Mode: Infinite Retry Loop

SYMPTOM:
  - Same task retries over and over
  - Same error each time
  - Budget drains rapidly

CAUSE:
  - Retry context is identical to original (no pressure increase)
  - Error is fundamental (wrong model, broken tool, impossible task)
  - Max retries set too high

DETECTION:
  if (task.retryCount >= 2 && task.error === previousError) {
    // Same error repeating — retry won't help
    logger.error("Repeating error detected — failing task immediately");
  }

FIX:
  1. Verify RetryStrategy modifies context with previous error
  2. Add retry detection: if same error 2x → fail immediately
  3. Set reasonable maxRetries (3 is good default)
  4. Budget enforcement should catch runaway costs

## 4.3 Failure Mode: Context Overflow

SYMPTOM:
  - Model returns truncated or incoherent responses
  - Model ignores parts of the task
  - Errors about token limits from provider

CAUSE:
  - ContextBuilder assembling too much text
  - Large dependency outputs not summarized
  - Workspace with many files all listed

DETECTION:
  const contextTokens = estimateTokens(context);
  const modelLimit = getContextWindow(model);
  if (contextTokens > modelLimit * 0.9) {
    logger.warn(`Context is ${contextTokens} tokens, model limit is ${modelLimit}`);
  }

FIX:
  1. Verify ContextBuilder respects MAX_CONTEXT_RATIO (0.75)
  2. Verify large artifacts are summarized/truncated
  3. Verify workspace listing is capped at 30 files
  4. Add explicit token counting before model call

## 4.4 Failure Mode: Database Corruption

SYMPTOM:
  - "database is locked" errors
  - Missing data that was previously written
  - Inconsistent task states

CAUSE:
  - Multiple processes accessing same DB
  - Crash during write operation
  - No WAL mode

DETECTION:
  - Check for .eamilos.lock file
  - Check PRAGMA journal_mode

FIX:
  1. Verify process lock is implemented
  2. Verify WAL mode is enabled
  3. Verify transactions around multi-step operations
  4. Add integrity check on startup: PRAGMA integrity_check

## 4.5 Failure Mode: Git Blocking Execution

SYMPTOM:
  - Errors about git operations
  - System hangs on artifact write
  - Workspace operations fail

CAUSE:
  - Git not installed
  - Git lock file from previous crash
  - Git operations timeout

DETECTION:
  try {
    await execa("git", ["--version"]);
  } catch {
    logger.warn("Git not available — disabling workspace versioning");
  }

FIX:
  1. Git failures must NEVER block execution
  2. Wrap all git operations in try/catch
  3. Set timeout on git operations (10s)
  4. If git unavailable → disable, warn, continue
  5. Check for .git/index.lock on startup → remove if stale


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 5: WHAT "DONE" LOOKS LIKE
# ═══════════════════════════════════════════════════════════════════════════════

## 5.1 Phase 1 Done

```
✅ npm install succeeds
✅ npm run build succeeds with zero errors
✅ eamilos init creates config and directories
✅ eamilos run creates project with workspace and git
✅ eamilos status shows project
✅ eamilos list shows all projects
✅ Database has correct schema with all tables
✅ Task manager enforces state machine
✅ DAG validation catches cycles
✅ Workspace writes files with git commits
✅ Path traversal is blocked
✅ Tool executor creates real files
✅ All stubs compile and don't break the build
```

## 5.2 Phase 2 Done

```
✅ Everything from Phase 1 still works
✅ Model providers connect and respond
✅ Model router selects correct tier
✅ Agent prompts loaded from YAML
✅ Context builder assembles full context with token budget
✅ Agent runner processes tool calls in loop
✅ Tool calls create real files on disk
✅ Zero tool calls → task failure (enforced)
✅ Retry with pressure modifies context
✅ Budget tracks tokens and cost
✅ Hello World test passes end-to-end
✅ Multi-file project test passes
✅ Research → Code pipeline test passes
✅ Planner creates valid task graph
✅ All tasks complete and project finishes
```

## 5.3 Phase 3 Done

```
✅ Everything from Phase 2 still works
✅ Permissions deny unauthorized actions
✅ Budget enforcement stops at limit
✅ Memory stores and recalls with scoring
✅ Pause/resume/retry/cancel work
✅ Export creates zip
✅ Archive compresses workspace
✅ Command execution is sandboxed
✅ Secret detection warns on API keys in artifacts
✅ Complex project (REST API) completes successfully
```

## 5.4 Phase 4 Done

```
✅ Everything from Phase 3 still works
✅ MCP server starts and accepts connections
✅ IDE clients can create projects via MCP
✅ All unit tests pass
✅ All integration tests pass
✅ Coverage >= 80%
✅ README with quickstart guide exists
✅ npm publish ready
```


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 6: INSTRUCTIONS TO THE BUILDING AGENT
# ═══════════════════════════════════════════════════════════════════════════════

## 6.1 Your Identity

You are the EamilOS Builder Agent.
Your job is to produce a WORKING SYSTEM, not a collection of files.

## 6.2 Your Constraints

1. Build Phase 1 COMPLETELY before starting Phase 2.
2. After each step, verify with `npm run build`.
3. If build fails, fix it IMMEDIATELY. Do not write more files on top of broken code.
4. Every function you write must be callable. Not just type-correct — actually runnable.
5. Import paths MUST use `.js` extension (ESM requirement).
6. No `any` types. Use `unknown` if truly unknown, then narrow.
7. No `// TODO`, `// ...`, `// implement this` in Phase code (only in Phase boundary stubs).
8. Every file must be complete. No "rest of implementation similar to above".

## 6.3 Your Process

```
For each step in the build protocol:
  1. Read the step requirements
  2. Read the relevant specification from other docs
  3. Write the complete file(s)
  4. Mentally verify: "Does this compile? Does it handle errors? Are imports correct?"
  5. Note what needs verification by the user
  6. Move to next step
```

## 6.4 When You Are Stuck

If you encounter a decision not covered in the specs:
1. Choose the simplest option that works
2. Document your choice with a comment
3. Ensure it doesn't violate any spec in any document
4. Move forward

If you encounter a contradiction between documents:
1. ARCHITECTURE.md wins for schemas and data structures
2. EXECUTION_SPEC.md wins for execution mechanics
3. AI_RULES.md wins for agent behavior
4. PRD.md wins for user experience
5. PLAN.md wins for build order
6. This document (IMPLEMENTATION_GUIDE.md) wins for build process

## 6.5 Your Output Format

When implementing:
- Generate files sequentially with clear `📁 path/to/file.ts` headers
- Include FULL code for every file
- After each step's files, note the verification command
- After each phase, provide the full verification checklist results
- At the end, provide complete setup commands

## 6.6 The One Thing That Matters Most

```
Make the execution bridge work.

If model responses turn into real files on disk,
everything else is details.

If they don't, nothing else matters.
```


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 7: COMPLETE DOCUMENT REGISTRY
# ═══════════════════════════════════════════════════════════════════════════════

## 7.1 All System Definition Files

| # | File | Purpose | Authority |
|---|------|---------|-----------|
| 1 | PRD.md | Product requirements, user experience, lifecycle | Product decisions |
| 2 | ARCHITECTURE.md | Schemas, state machines, system structure, algorithms | Technical specifications |
| 3 | AI_RULES.md | Agent behavioral contracts, prompts, role boundaries | Agent behavior |
| 4 | PLAN.md | Phased implementation, verification, tech stack | Build order |
| 5 | EXECUTION_SPEC.md | Tool runtime, agent runner, validation, retry, memory | Execution mechanics |
| 6 | IMPLEMENTATION_GUIDE.md | Build process, verification protocols, failure modes | Build process (THIS FILE) |

## 7.2 Reading Order for Building Agent

```
1. IMPLEMENTATION_GUIDE.md (this file) — understand the build process
2. ARCHITECTURE.md — understand what you're building
3. EXECUTION_SPEC.md — understand how execution works
4. AI_RULES.md — understand agent behavior contracts
5. PRD.md — understand product requirements
6. PLAN.md — understand phase boundaries and deliverables
```

## 7.3 Reference During Build

```
While building Phase 1:
  → IMPLEMENTATION_GUIDE.md Section 3.1 (step-by-step)
  → ARCHITECTURE.md Sections 3-5 (schemas, DB, state machine)
  → EXECUTION_SPEC.md Section 1 (tool layer)

While building Phase 2:
  → IMPLEMENTATION_GUIDE.md Section 3.2 (step-by-step)
  → ARCHITECTURE.md Sections 6-7 (context builder, orchestrator)
  → EXECUTION_SPEC.md Sections 2-5 (agent runner, planner, validation, retry)
  → AI_RULES.md Section 12 (agent prompts)

While building Phase 3:
  → IMPLEMENTATION_GUIDE.md Section 3.3
  → ARCHITECTURE.md Sections 8-12 (security, concurrency, providers, logging, budget)
  → EXECUTION_SPEC.md Sections 7-8 (versioning, memory)

While building Phase 4:
  → IMPLEMENTATION_GUIDE.md Section 3.4
  → PLAN.md Phase 4 deliverables
  → PRD.md Section 13 (extensions)
```
```

---

# ✅ Summary of All Six Documents

| # | File | Pages | Purpose |
|---|------|-------|---------|
| 1 | **PRD.md** | Product requirements | WHAT users experience |
| 2 | **ARCHITECTURE.md** | Technical specification | WHAT the system is |
| 3 | **AI_RULES.md** | Behavioral contracts | HOW agents behave |
| 4 | **PLAN.md** | Phased implementation | WHEN things are built |
| 5 | **EXECUTION_SPEC.md** | Execution mechanics | HOW the system executes |
| 6 | **IMPLEMENTATION_GUIDE.md** | Build process enforcement | HOW TO BUILD IT WITHOUT FAILING |

**An AI agent with all six documents has zero ambiguity about what to build, how to build it, how to verify it works, and how to avoid every known failure mode.** The system specification is now complete. 🚀

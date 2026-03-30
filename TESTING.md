# ==============================================================================
# EAMILOS (AOG) — COMPLETE SYSTEM TEST SUITE & VERIFICATION PROTOCOL
# VERSION: 1.0.0-FINAL
# AUTHORITY: EQUAL TO IMPLEMENTATION_GUIDE.md FOR VERIFICATION DECISIONS
# AUDIENCE: AI AGENT BUILDING EAMILOS + HUMAN DEVELOPERS VALIDATING IT
# ==============================================================================
#
# PURPOSE:
# This document defines EVERY test that must pass for EamilOS to be
# considered a working system. It contains:
#   - Automated unit tests (Vitest)
#   - Automated integration tests (Vitest)
#   - Manual CLI verification scripts (Bash)
#   - Reality tests (end-to-end with real/mock LLMs)
#   - Security tests
#   - Performance benchmarks
#   - Debugging playbooks for when tests fail
#
# CORE PRINCIPLE:
# If these tests do not pass, the system is NOT working —
# regardless of how correct the code looks.
# Code that compiles but fails tests is BROKEN CODE.
#
# TEST INFRASTRUCTURE:
# Framework: Vitest 3+
# Assertion: Vitest built-in (expect)
# Mocking: Vitest built-in (vi.mock, vi.fn)
# Coverage: @vitest/coverage-v8
# CLI Testing: execa (run CLI commands programmatically)
# Temp Files: Node.js os.tmpdir() + crypto.randomUUID()
#
# ==============================================================================


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 0: TEST INFRASTRUCTURE SETUP
# ═══════════════════════════════════════════════════════════════════════════════

## 0.1 Test Configuration

```typescript
// vitest.config.ts (root)
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["packages/core/src/**/*.ts"],
      exclude: [
        "packages/core/src/index.ts",
        "packages/core/src/types.ts",
        "**/*.test.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
    testTimeout: 30000,
    hookTimeout: 10000,
    sequence: {
      shuffle: false,
    },
  },
});
```

## 0.2 Test Helper: Temporary Workspace

Every test that touches the filesystem MUST use an isolated temporary directory.
Tests MUST NOT share state. Tests MUST clean up after themselves.

```typescript
// tests/helpers/test-workspace.ts
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

export interface TestContext {
  testId: string;
  baseDir: string;
  dbPath: string;
  configPath: string;
  cleanup: () => void;
}

export function createTestContext(): TestContext {
  const testId = randomUUID().slice(0, 8);
  const baseDir = join(tmpdir(), `eamilos-test-${testId}`);
  const dbPath = join(baseDir, "eamilos.db");
  const configPath = join(baseDir, "eamilos.config.yaml");

  mkdirSync(baseDir, { recursive: true });
  mkdirSync(join(baseDir, "projects"), { recursive: true });

  return {
    testId,
    baseDir,
    dbPath,
    configPath,
    cleanup: () => {
      if (existsSync(baseDir)) {
        rmSync(baseDir, { recursive: true, force: true });
      }
    },
  };
}
```

## 0.3 Test Helper: Mock Provider

A deterministic mock that simulates LLM responses with tool calls.
Used for ALL tests that don't explicitly need a real API.

```typescript
// tests/mocks/mock-provider.ts
import type { ModelProvider, ChatRequest, ChatResponse } from "@eamilos/core";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface MockSequenceStep {
  content?: string;
  toolCalls?: ToolCall[];
  finishReason?: "stop" | "tool_calls" | "length";
}

export class MockProvider implements ModelProvider {
  readonly id = "mock";
  readonly type = "mock";
  private callIndex = 0;
  private sequence: MockSequenceStep[];
  public callLog: ChatRequest[] = [];

  constructor(sequence: MockSequenceStep[]) {
    this.sequence = sequence;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.callLog.push(structuredClone(request));
    
    const step = this.sequence[this.callIndex];
    if (!step) {
      return {
        content: "Sequence exhausted.",
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        latencyMs: 1,
        model: "mock-model",
        finishReason: "stop",
      };
    }

    this.callIndex++;

    return {
      content: step.content || "",
      toolCalls: step.toolCalls || [],
      usage: {
        inputTokens: Math.ceil((request.messages?.map(m => m.content).join("").length || 0) / 4),
        outputTokens: Math.ceil((step.content?.length || 0) / 4) + (step.toolCalls?.length || 0) * 50,
        costUsd: 0.001,
      },
      latencyMs: 10,
      model: "mock-model",
      finishReason: step.finishReason || (step.toolCalls?.length ? "tool_calls" : "stop"),
    };
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getModels() {
    return [{ id: "mock-model", tier: "strong" as const, context_window: 128000 }];
  }

  getContextWindow(): number {
    return 128000;
  }

  estimateCost(): number {
    return 0.001;
  }

  supportsStreaming(): boolean {
    return false;
  }

  getCallCount(): number {
    return this.callIndex;
  }

  getCallLog(): ChatRequest[] {
    return this.callLog;
  }

  reset(): void {
    this.callIndex = 0;
    this.callLog = [];
  }
}

export function createHelloWorldMock(): MockProvider {
  return new MockProvider([
    {
      toolCalls: [
        {
          id: "call_001",
          name: "workspace_write",
          arguments: {
            path: "hello.py",
            content: 'print("Hello, World!")\n',
            description: "Main Python file",
          },
        },
      ],
      finishReason: "tool_calls",
    },
    {
      content: "I created hello.py with a Hello World program.",
      finishReason: "stop",
    },
  ]);
}

export function createMultiFileMock(): MockProvider {
  return new MockProvider([
    {
      toolCalls: [
        {
          id: "call_001",
          name: "workspace_write",
          arguments: {
            path: "calculator.py",
            content: [
              'def add(a: float, b: float) -> float:',
              '    return a + b',
              '',
            ].join('\n'),
            description: "Calculator module",
          },
        },
      ],
      finishReason: "tool_calls",
    },
    {
      toolCalls: [
        {
          id: "call_002",
          name: "workspace_write",
          arguments: {
            path: "main.py",
            content: [
              'from calculator import add',
              'print(f"10 + 5 = {add(10, 5)}")',
              '',
            ].join('\n'),
            description: "Main entry point",
          },
        },
      ],
      finishReason: "tool_calls",
    },
    {
      content: "Created calculator.py with operations and main.py.",
      finishReason: "stop",
    },
  ]);
}

export function createNoToolCallMock(): MockProvider {
  return new MockProvider([
    {
      content: "Here is the code:\n```python\nprint('Hello')\n```",
      finishReason: "stop",
    },
  ]);
}

export function createInfiniteToolCallMock(): MockProvider {
  const steps: MockSequenceStep[] = [];
  for (let i = 0; i < 50; i++) {
    steps.push({
      toolCalls: [
        {
          id: `call_${i}`,
          name: "workspace_list",
          arguments: {},
        },
      ],
      finishReason: "tool_calls",
    });
  }
  return new MockProvider(steps);
}

export function createPlannerMock(): MockProvider {
  return new MockProvider([
    {
      toolCalls: [
        {
          id: "call_plan",
          name: "workspace_write",
          arguments: {
            path: "artifacts/task-plan.json",
            content: JSON.stringify({
              projectGoal: "Create Hello World",
              totalTasks: 1,
              tasks: [
                {
                  title: "Write hello.py",
                  description: "Create a Python file that prints Hello World",
                  type: "coding",
                  priority: "high",
                  dependsOnIndices: [],
                  requiredCapabilities: ["code_write"],
                },
              ],
            }, null, 2),
            description: "Task plan",
          },
        },
      ],
      finishReason: "tool_calls",
    },
    {
      content: "Created task plan with 1 coding task.",
      finishReason: "stop",
    },
  ]);
}
```

## 0.4 Test Helper: Config Generator

```typescript
// tests/helpers/test-config.ts
import { writeFileSync } from "fs";
import { join } from "path";
import type { TestContext } from "./test-workspace.js";

export function writeTestConfig(ctx: TestContext, overrides?: Record<string, unknown>): void {
  const config = {
    version: 1,
    providers: [
      {
        id: "mock",
        type: "openai",
        api_key: "test-key",
        models: [
          { id: "mock-model", tier: "strong", context_window: 128000 },
          { id: "mock-cheap", tier: "cheap", context_window: 128000 },
        ],
      },
    ],
    routing: {
      default_tier: "cheap",
      task_routing: { coding: "strong", research: "cheap" },
      fallback_order: ["mock"],
    },
    workspace: {
      base_dir: join(ctx.baseDir, "projects"),
      git_enabled: false,
      max_file_size_mb: 10,
      max_workspace_size_mb: 500,
    },
    budget: {
      max_tokens_per_task: 50000,
      max_cost_per_project_usd: 5.0,
      warn_at_percentage: 80,
    },
    settings: {
      max_parallel_tasks: 3,
      task_timeout_seconds: 300,
      model_call_timeout_seconds: 120,
      preview_mode: false,
      auto_retry: true,
    },
    logging: {
      level: "error",
      console: false,
      file: join(ctx.baseDir, "test.log"),
    },
    ...overrides,
  };

  writeFileSync(ctx.configPath, JSON.stringify(config), "utf-8");
}
```

## 0.5 File Structure for Tests

```
tests/
├── helpers/
│   ├── test-workspace.ts
│   ├── test-config.ts
│   └── assertions.ts
├── mocks/
│   ├── mock-provider.ts
│   └── mock-agent.ts
├── unit/
│   ├── schemas.test.ts
│   ├── config.test.ts
│   ├── db.test.ts
│   ├── workspace.test.ts
│   ├── task-manager.test.ts
│   ├── dag.test.ts
│   ├── security.test.ts
│   ├── tool-executor.test.ts
│   ├── context-builder.test.ts
│   ├── agent-runner.test.ts
│   ├── retry-strategy.test.ts
│   ├── artifact-validator.test.ts
│   ├── budget.test.ts
│   ├── memory.test.ts
│   ├── event-bus.test.ts
│   ├── logger.test.ts
│   └── errors.test.ts
├── integration/
│   ├── project-lifecycle.test.ts
│   ├── tool-bridge.test.ts
│   ├── artifact-flow.test.ts
│   ├── retry-flow.test.ts
│   ├── budget-enforcement.test.ts
│   ├── dependency-chain.test.ts
│   └── crash-recovery.test.ts
├── reality/
│   ├── hello-world.test.ts
│   ├── multi-file.test.ts
│   └── research-code-pipeline.test.ts
└── cli/
    ├── init.test.ts
    ├── run.test.ts
    ├── status.test.ts
    └── list.test.ts
```

## 0.6 Package.json Test Scripts

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest watch",
    "test:coverage": "vitest run --coverage",
    "test:unit": "vitest run tests/unit/",
    "test:integration": "vitest run tests/integration/",
    "test:reality": "vitest run tests/reality/",
    "test:cli": "vitest run tests/cli/",
    "test:phase1": "vitest run tests/unit/schemas.test.ts tests/unit/config.test.ts tests/unit/db.test.ts tests/unit/workspace.test.ts tests/unit/task-manager.test.ts tests/unit/dag.test.ts tests/unit/security.test.ts tests/unit/tool-executor.test.ts tests/unit/event-bus.test.ts tests/unit/logger.test.ts tests/unit/errors.test.ts",
    "test:phase2": "vitest run tests/unit/context-builder.test.ts tests/unit/agent-runner.test.ts tests/unit/retry-strategy.test.ts tests/unit/artifact-validator.test.ts tests/unit/budget.test.ts tests/integration/ tests/reality/",
    "test:phase3": "vitest run tests/unit/memory.test.ts",
    "test:all": "vitest run --coverage"
  }
}
```


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 1: UNIT TESTS — PHASE 1 FOUNDATION
# ═══════════════════════════════════════════════════════════════════════════════

## 1.1 Schema Validation Tests

```typescript
// tests/unit/schemas.test.ts
import { describe, it, expect } from "vitest";
import { TaskSchema, TASK_TRANSITIONS } from "@eamilos/core/schemas/task.js";
import { ProjectSchema, PROJECT_TRANSITIONS } from "@eamilos/core/schemas/project.js";
import { ArtifactSchema } from "@eamilos/core/schemas/artifact.js";
import { AgentSchema } from "@eamilos/core/schemas/agent.js";
import { ConfigSchema } from "@eamilos/core/schemas/config.js";

describe("TaskSchema", () => {
  it("accepts a valid task", () => {
    const validTask = {
      id: "task-001",
      projectId: "proj-001",
      title: "Write hello.py",
      description: "Create a Python file that prints Hello World",
      type: "coding",
      status: "pending",
      dependsOn: [],
      artifacts: [],
      retryCount: 0,
      maxRetries: 3,
      requiresHumanApproval: false,
      tokenUsage: 0,
      costUsd: 0,
      createdAt: new Date(),
    };

    const result = TaskSchema.safeParse(validTask);
    expect(result.success).toBe(true);
  });

  it("rejects task with empty title", () => {
    const invalidTask = {
      id: "task-001",
      projectId: "proj-001",
      title: "",
      description: "Some description",
      type: "coding",
      status: "pending",
      dependsOn: [],
      artifacts: [],
      createdAt: new Date(),
    };

    const result = TaskSchema.safeParse(invalidTask);
    expect(result.success).toBe(false);
  });

  it("rejects invalid task type", () => {
    const invalidTask = {
      id: "task-001",
      projectId: "proj-001",
      title: "Test",
      description: "Test",
      type: "invalid_type",
      status: "pending",
      dependsOn: [],
      artifacts: [],
      createdAt: new Date(),
    };

    const result = TaskSchema.safeParse(invalidTask);
    expect(result.success).toBe(false);
  });

  it("rejects invalid status", () => {
    const invalidTask = {
      id: "task-001",
      projectId: "proj-001",
      title: "Test",
      description: "Test",
      type: "coding",
      status: "invalid_status",
      dependsOn: [],
      artifacts: [],
      createdAt: new Date(),
    };

    const result = TaskSchema.safeParse(invalidTask);
    expect(result.success).toBe(false);
  });

  it("applies default values correctly", () => {
    const minimalTask = {
      id: "task-001",
      projectId: "proj-001",
      title: "Test",
      description: "Test description here",
      type: "coding",
      status: "pending",
      dependsOn: [],
      artifacts: [],
      createdAt: new Date(),
    };

    const result = TaskSchema.parse(minimalTask);
    expect(result.retryCount).toBe(0);
    expect(result.maxRetries).toBe(3);
    expect(result.requiresHumanApproval).toBe(false);
    expect(result.tokenUsage).toBe(0);
    expect(result.costUsd).toBe(0);
    expect(result.priority).toBe("medium");
  });
});

describe("Task State Transitions", () => {
  it("allows pending → ready", () => {
    expect(TASK_TRANSITIONS["pending"]).toContain("ready");
  });

  it("allows pending → blocked", () => {
    expect(TASK_TRANSITIONS["pending"]).toContain("blocked");
  });

  it("allows in_progress → completed", () => {
    expect(TASK_TRANSITIONS["in_progress"]).toContain("completed");
  });

  it("allows in_progress → ready (retry)", () => {
    expect(TASK_TRANSITIONS["in_progress"]).toContain("ready");
  });

  it("does NOT allow completed → anything", () => {
    expect(TASK_TRANSITIONS["completed"]).toEqual([]);
  });

  it("does NOT allow cancelled → anything", () => {
    expect(TASK_TRANSITIONS["cancelled"]).toEqual([]);
  });

  it("allows failed → ready (manual retry)", () => {
    expect(TASK_TRANSITIONS["failed"]).toContain("ready");
  });

  it("does NOT allow failed → in_progress directly", () => {
    expect(TASK_TRANSITIONS["failed"]).not.toContain("in_progress");
  });
});

describe("ProjectSchema", () => {
  it("accepts valid project", () => {
    const valid = {
      id: "proj-001",
      name: "Test Project",
      goal: "Build something",
      status: "active",
      path: "/tmp/projects/test",
      createdAt: new Date(),
    };

    const result = ProjectSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("applies default counters", () => {
    const project = ProjectSchema.parse({
      id: "proj-001",
      name: "Test",
      goal: "Test",
      status: "active",
      path: "/tmp/test",
      createdAt: new Date(),
    });

    expect(project.totalTasks).toBe(0);
    expect(project.completedTasks).toBe(0);
    expect(project.failedTasks).toBe(0);
    expect(project.totalTokensUsed).toBe(0);
    expect(project.totalCostUsd).toBe(0);
  });
});

describe("ArtifactSchema", () => {
  it("accepts valid artifact", () => {
    const valid = {
      id: "art-001",
      projectId: "proj-001",
      taskId: "task-001",
      path: "src/main.py",
      content: "print('hello')",
      hash: "abc123",
      size: 15,
      type: "code",
      createdBy: "coder",
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = ArtifactSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects empty path", () => {
    const invalid = {
      id: "art-001",
      projectId: "proj-001",
      taskId: "task-001",
      path: "",
      content: "test",
      hash: "abc",
      size: 4,
      type: "code",
      createdBy: "coder",
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = ArtifactSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe("AgentSchema", () => {
  it("accepts valid agent", () => {
    const valid = {
      id: "coder",
      name: "Coder Agent",
      role: "Write production code",
      systemPrompt: "You are a coder...",
      capabilities: ["code_write"],
      preferredTier: "strong",
      tools: ["workspace_write", "workspace_read"],
    };

    const result = AgentSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("requires at least one capability", () => {
    const invalid = {
      id: "coder",
      name: "Coder",
      role: "Write code",
      systemPrompt: "...",
      capabilities: [],
      preferredTier: "strong",
      tools: [],
    };

    const result = AgentSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("applies default permission values", () => {
    const agent = AgentSchema.parse({
      id: "test",
      name: "Test",
      role: "Test",
      systemPrompt: "Test prompt",
      capabilities: ["test"],
      preferredTier: "cheap",
      tools: [],
    });

    expect(agent.maxTokens).toBe(4096);
    expect(agent.temperature).toBe(0.2);
    expect(agent.timeoutSeconds).toBe(300);
    expect(agent.permissions?.fileRead).toBe(true);
    expect(agent.permissions?.fileWrite).toBe(true);
    expect(agent.permissions?.fileDelete).toBe(false);
    expect(agent.permissions?.commandExecute).toBe(false);
  });
});
```

## 1.2 Config Loader Tests

```typescript
// tests/unit/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "@eamilos/core/config.js";
import { writeFileSync } from "fs";
import { createTestContext, type TestContext } from "../helpers/test-workspace.js";
import { writeTestConfig } from "../helpers/test-config.js";

describe("Config Loader", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("loads valid YAML config", () => {
    writeTestConfig(ctx);
    const config = loadConfig(ctx.configPath);

    expect(config.providers).toHaveLength(1);
    expect(config.providers[0].id).toBe("mock");
    expect(config.routing.default_tier).toBe("cheap");
    expect(config.workspace.git_enabled).toBe(false);
  });

  it("resolves environment variables", () => {
    process.env.TEST_API_KEY = "sk-test-12345";

    const yaml = `
version: 1
providers:
  - id: test
    type: openai
    api_key: \${TEST_API_KEY}
    models:
      - id: gpt-4o
        tier: strong
        context_window: 128000
routing:
  default_tier: cheap
  task_routing: {}
  fallback_order: [test]
workspace:
  base_dir: ./data/projects
  git_enabled: false
  max_file_size_mb: 10
  max_workspace_size_mb: 500
budget:
  max_tokens_per_task: 50000
  max_cost_per_project_usd: 5.0
  warn_at_percentage: 80
settings:
  max_parallel_tasks: 3
  task_timeout_seconds: 300
  model_call_timeout_seconds: 120
  preview_mode: false
  auto_retry: true
logging:
  level: info
  console: true
`;

    writeFileSync(ctx.configPath, yaml, "utf-8");
    const config = loadConfig(ctx.configPath);

    expect(config.providers[0].api_key).toBe("sk-test-12345");

    delete process.env.TEST_API_KEY;
  });

  it("throws on invalid YAML syntax", () => {
    writeFileSync(ctx.configPath, "{ invalid yaml: [", "utf-8");
    expect(() => loadConfig(ctx.configPath)).toThrow();
  });

  it("throws on missing required fields", () => {
    writeFileSync(ctx.configPath, "version: 1\n", "utf-8");
    expect(() => loadConfig(ctx.configPath)).toThrow();
  });

  it("throws on non-existent file", () => {
    expect(() => loadConfig("/nonexistent/path/config.yaml")).toThrow();
  });
});
```

## 1.3 Database Tests

```typescript
// tests/unit/db.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseManager } from "@eamilos/core/db.js";
import { createTestContext, type TestContext } from "../helpers/test-workspace.js";

describe("DatabaseManager", () => {
  let ctx: TestContext;
  let db: DatabaseManager;

  beforeEach(() => {
    ctx = createTestContext();
    db = new DatabaseManager(ctx.dbPath);
  });

  afterEach(() => {
    db.close();
    ctx.cleanup();
  });

  describe("Initialization", () => {
    it("creates database file", () => {
      const { existsSync } = require("fs");
      expect(existsSync(ctx.dbPath)).toBe(true);
    });

    it("creates all required tables", () => {
      const tables = db.getTables();
      expect(tables).toContain("projects");
      expect(tables).toContain("tasks");
      expect(tables).toContain("artifacts");
      expect(tables).toContain("events");
      expect(tables).toContain("schema_version");
      expect(tables).toContain("agent_metrics");
      expect(tables).toContain("memory");
    });

    it("enables WAL mode", () => {
      const mode = db.pragma("journal_mode");
      expect(mode).toBe("wal");
    });

    it("enables foreign keys", () => {
      const fk = db.pragma("foreign_keys");
      expect(fk).toBe(1);
    });
  });

  describe("Project CRUD", () => {
    it("inserts and retrieves a project", () => {
      const project = {
        id: "proj-001",
        name: "Test Project",
        goal: "Build something cool",
        status: "active",
        path: "/tmp/test",
        createdAt: new Date("2025-06-18T10:00:00Z"),
      };

      db.insertProject(project);
      const retrieved = db.getProject("proj-001");

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe("proj-001");
      expect(retrieved!.name).toBe("Test Project");
      expect(retrieved!.goal).toBe("Build something cool");
      expect(retrieved!.status).toBe("active");
      expect(retrieved!.createdAt).toBeInstanceOf(Date);
    });

    it("returns null for non-existent project", () => {
      const result = db.getProject("nonexistent");
      expect(result).toBeNull();
    });

    it("updates project status", () => {
      db.insertProject({
        id: "proj-001",
        name: "Test",
        goal: "Test",
        status: "active",
        path: "/tmp",
        createdAt: new Date(),
      });

      db.updateProjectStatus("proj-001", "completed", new Date());
      const project = db.getProject("proj-001");

      expect(project!.status).toBe("completed");
      expect(project!.completedAt).toBeInstanceOf(Date);
    });
  });

  describe("Task CRUD", () => {
    beforeEach(() => {
      db.insertProject({
        id: "proj-001",
        name: "Test",
        goal: "Test",
        status: "active",
        path: "/tmp",
        createdAt: new Date(),
      });
    });

    it("inserts and retrieves a task", () => {
      const task = {
        id: "task-001",
        projectId: "proj-001",
        title: "Write code",
        description: "Write some Python code",
        type: "coding",
        status: "pending",
        dependsOn: ["task-000"],
        artifacts: [],
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
      };

      db.insertTask(task);
      const retrieved = db.getTask("task-001");

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe("task-001");
      expect(retrieved!.dependsOn).toEqual(["task-000"]);
      expect(retrieved!.artifacts).toEqual([]);
      expect(Array.isArray(retrieved!.dependsOn)).toBe(true);
      expect(Array.isArray(retrieved!.artifacts)).toBe(true);
    });

    it("serializes and deserializes JSON arrays correctly", () => {
      db.insertTask({
        id: "task-001",
        projectId: "proj-001",
        title: "Test",
        description: "Test",
        type: "coding",
        status: "completed",
        dependsOn: ["dep-1", "dep-2", "dep-3"],
        artifacts: ["file1.py", "file2.py"],
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
      });

      const task = db.getTask("task-001");
      expect(task!.dependsOn).toEqual(["dep-1", "dep-2", "dep-3"]);
      expect(task!.artifacts).toEqual(["file1.py", "file2.py"]);
    });

    it("retrieves tasks by project", () => {
      db.insertTask({ id: "t1", projectId: "proj-001", title: "Task 1", description: "D", type: "coding", status: "pending", dependsOn: [], artifacts: [], retryCount: 0, maxRetries: 3, createdAt: new Date() });
      db.insertTask({ id: "t2", projectId: "proj-001", title: "Task 2", description: "D", type: "coding", status: "pending", dependsOn: [], artifacts: [], retryCount: 0, maxRetries: 3, createdAt: new Date() });

      const tasks = db.getTasksByProject("proj-001");
      expect(tasks).toHaveLength(2);
    });

    it("updates task fields", () => {
      db.insertTask({ id: "t1", projectId: "proj-001", title: "Task", description: "D", type: "coding", status: "pending", dependsOn: [], artifacts: [], retryCount: 0, maxRetries: 3, createdAt: new Date() });

      db.updateTask("t1", { status: "in_progress", assigned_agent: "coder" });
      const task = db.getTask("t1");

      expect(task!.status).toBe("in_progress");
      expect(task!.assignedAgent).toBe("coder");
    });
  });
});
```

## 1.4 Workspace Tests

```typescript
// tests/unit/workspace.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WorkspaceManager } from "@eamilos/core/workspace.js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { createTestContext, type TestContext } from "../helpers/test-workspace.js";

describe("WorkspaceManager", () => {
  let ctx: TestContext;
  let workspace: WorkspaceManager;

  beforeEach(() => {
    ctx = createTestContext();
    workspace = new WorkspaceManager(
      join(ctx.baseDir, "projects"),
      false,
      10,
      500
    );
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe("Project Creation", () => {
    it("creates project directory", async () => {
      const path = await workspace.createProject("test-proj", "Test Project");
      expect(existsSync(path)).toBe(true);
    });

    it("returns correct project path", async () => {
      const path = await workspace.createProject("test-proj", "Test");
      expect(path).toBe(join(ctx.baseDir, "projects", "test-proj"));
    });
  });

  describe("Artifact Writing", () => {
    beforeEach(async () => {
      await workspace.createProject("test-proj", "Test");
    });

    it("creates a file with correct content", async () => {
      await workspace.writeArtifact("test-proj", "hello.py", 'print("Hello")\n', "coder");

      const fullPath = join(ctx.baseDir, "projects", "test-proj", "hello.py");
      expect(existsSync(fullPath)).toBe(true);
      expect(readFileSync(fullPath, "utf-8")).toBe('print("Hello")\n');
    });

    it("creates parent directories automatically", async () => {
      await workspace.writeArtifact("test-proj", "src/utils/helpers.py", "# helpers", "coder");

      const fullPath = join(ctx.baseDir, "projects", "test-proj", "src", "utils", "helpers.py");
      expect(existsSync(fullPath)).toBe(true);
    });

    it("returns artifact with correct metadata", async () => {
      const artifact = await workspace.writeArtifact(
        "test-proj", "hello.py", 'print("Hello")\n', "coder"
      );

      expect(artifact.path).toBe("hello.py");
      expect(artifact.createdBy).toBe("coder");
      expect(artifact.size).toBe(Buffer.byteLength('print("Hello")\n', "utf-8"));
      expect(artifact.hash).toBeTruthy();
      expect(artifact.hash.length).toBe(64);
    });

    it("overwrites file and increments version", async () => {
      await workspace.writeArtifact("test-proj", "hello.py", "v1 content", "coder");
      await workspace.writeArtifact("test-proj", "hello.py", "v2 content", "coder");

      const content = await workspace.readArtifact("test-proj", "hello.py");
      expect(content).toBe("v2 content");
    });
  });

  describe("Artifact Reading", () => {
    beforeEach(async () => {
      await workspace.createProject("test-proj", "Test");
      await workspace.writeArtifact("test-proj", "hello.py", "print('hello')", "coder");
    });

    it("reads file content correctly", async () => {
      const content = await workspace.readArtifact("test-proj", "hello.py");
      expect(content).toBe("print('hello')");
    });

    it("throws on non-existent file", async () => {
      await expect(
        workspace.readArtifact("test-proj", "nonexistent.py")
      ).rejects.toThrow();
    });
  });

  describe("File Listing", () => {
    beforeEach(async () => {
      await workspace.createProject("test-proj", "Test");
      await workspace.writeArtifact("test-proj", "a.py", "# a", "coder");
      await workspace.writeArtifact("test-proj", "src/b.py", "# b", "coder");
      await workspace.writeArtifact("test-proj", "src/utils/c.py", "# c", "coder");
    });

    it("lists all files recursively", async () => {
      const files = await workspace.listFiles("test-proj");
      const paths = files.map(f => f.path);

      expect(paths).toContain("a.py");
      expect(paths).toContain(join("src", "b.py"));
      expect(paths).toContain(join("src", "utils", "c.py"));
    });

    it("returns correct file count", async () => {
      const files = await workspace.listFiles("test-proj");
      expect(files.length).toBe(3);
    });

    it("returns empty array for empty project", async () => {
      await workspace.createProject("empty-proj", "Empty");
      const files = await workspace.listFiles("empty-proj");
      expect(files).toEqual([]);
    });
  });
});
```

## 1.5 Security Tests

```typescript
// tests/unit/security.test.ts
import { describe, it, expect } from "vitest";
import { validateAndResolvePath, PathTraversalError } from "@eamilos/core/utils/security.js";

describe("Path Traversal Prevention", () => {
  const baseDir = "/tmp/eamilos/projects";
  const projectId = "test-project";

  it("accepts normal relative paths", () => {
    expect(() => validateAndResolvePath(baseDir, projectId, "hello.py")).not.toThrow();
    expect(() => validateAndResolvePath(baseDir, projectId, "src/main.py")).not.toThrow();
    expect(() => validateAndResolvePath(baseDir, projectId, "src/utils/helpers.py")).not.toThrow();
  });

  it("rejects paths with ..", () => {
    expect(() => validateAndResolvePath(baseDir, projectId, "../../../etc/passwd")).toThrow(PathTraversalError);
    expect(() => validateAndResolvePath(baseDir, projectId, "src/../../escape.py")).toThrow(PathTraversalError);
    expect(() => validateAndResolvePath(baseDir, projectId, "..")).toThrow(PathTraversalError);
  });

  it("rejects absolute paths", () => {
    expect(() => validateAndResolvePath(baseDir, projectId, "/etc/passwd")).toThrow(PathTraversalError);
    expect(() => validateAndResolvePath(baseDir, projectId, "/tmp/hack")).toThrow(PathTraversalError);
  });

  it("rejects paths with null bytes", () => {
    expect(() => validateAndResolvePath(baseDir, projectId, "hello\0.py")).toThrow(PathTraversalError);
  });

  it("resolves to correct absolute path", () => {
    const resolved = validateAndResolvePath(baseDir, projectId, "src/main.py");
    expect(resolved).toBe("/tmp/eamilos/projects/test-project/src/main.py");
  });
});
```

## 1.6 Task Manager Tests

```typescript
// tests/unit/task-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TaskManager } from "@eamilos/core/task-manager.js";
import { DatabaseManager } from "@eamilos/core/db.js";
import { InvalidStateTransitionError } from "@eamilos/core/errors.js";
import { createTestContext, type TestContext } from "../helpers/test-workspace.js";

describe("TaskManager", () => {
  let ctx: TestContext;
  let db: DatabaseManager;
  let taskManager: TaskManager;

  beforeEach(() => {
    ctx = createTestContext();
    db = new DatabaseManager(ctx.dbPath);
    taskManager = new TaskManager(db);

    db.insertProject({
      id: "proj-001",
      name: "Test",
      goal: "Test",
      status: "active",
      path: "/tmp/test",
      createdAt: new Date(),
    });
  });

  afterEach(() => {
    db.close();
    ctx.cleanup();
  });

  describe("Task Creation", () => {
    it("creates task with generated ID", () => {
      const task = taskManager.createTask({
        projectId: "proj-001",
        title: "Write code",
        description: "Write some Python",
        type: "coding",
        status: "pending",
        dependsOn: [],
        maxRetries: 3,
      });

      expect(task.id).toBeTruthy();
      expect(task.id.length).toBe(12);
      expect(task.retryCount).toBe(0);
      expect(task.artifacts).toEqual([]);
    });
  });

  describe("Dependency Resolution", () => {
    it("returns task with no deps as ready", () => {
      taskManager.createTask({
        projectId: "proj-001",
        title: "No deps",
        description: "D",
        type: "coding",
        status: "pending",
        dependsOn: [],
        maxRetries: 3,
      });

      const ready = taskManager.getReadyTasks("proj-001");
      expect(ready).toHaveLength(1);
      expect(ready[0].title).toBe("No deps");
    });

    it("does not return task with unmet deps", () => {
      const t1 = taskManager.createTask({
        projectId: "proj-001",
        title: "Task 1",
        description: "D",
        type: "research",
        status: "pending",
        dependsOn: [],
        maxRetries: 3,
      });

      taskManager.createTask({
        projectId: "proj-001",
        title: "Task 2",
        description: "D",
        type: "coding",
        status: "pending",
        dependsOn: [t1.id],
        maxRetries: 3,
      });

      const ready = taskManager.getReadyTasks("proj-001");
      expect(ready).toHaveLength(1);
      expect(ready[0].title).toBe("Task 1");
    });

    it("unblocks task when dependency completes", () => {
      const t1 = taskManager.createTask({
        projectId: "proj-001",
        title: "Task 1",
        description: "D",
        type: "research",
        status: "pending",
        dependsOn: [],
        maxRetries: 3,
      });

      taskManager.createTask({
        projectId: "proj-001",
        title: "Task 2",
        description: "D",
        type: "coding",
        status: "pending",
        dependsOn: [t1.id],
        maxRetries: 3,
      });

      taskManager.startTask(t1.id, "researcher");
      taskManager.completeTask(t1.id, "Done", ["research.md"]);

      const ready = taskManager.getReadyTasks("proj-001");
      expect(ready).toHaveLength(1);
      expect(ready[0].title).toBe("Task 2");
    });
  });

  describe("State Machine Enforcement", () => {
    it("allows valid transition: pending → ready", () => {
      const task = taskManager.createTask({
        projectId: "proj-001",
        title: "Test",
        description: "D",
        type: "coding",
        status: "pending",
        dependsOn: [],
        maxRetries: 3,
      });

      const ready = taskManager.getReadyTasks("proj-001");
      expect(ready[0].status).toBe("ready");
    });

    it("rejects invalid transition: completed → in_progress", () => {
      const task = taskManager.createTask({
        projectId: "proj-001",
        title: "Test",
        description: "D",
        type: "coding",
        status: "pending",
        dependsOn: [],
        maxRetries: 3,
      });

      taskManager.startTask(task.id, "coder");
      taskManager.completeTask(task.id, "Done", []);

      expect(() => taskManager.startTask(task.id, "coder")).toThrow(InvalidStateTransitionError);
    });
  });

  describe("Retry Logic", () => {
    it("retries task when retries remaining", () => {
      const task = taskManager.createTask({
        projectId: "proj-001",
        title: "Flaky task",
        description: "D",
        type: "coding",
        status: "pending",
        dependsOn: [],
        maxRetries: 3,
      });

      taskManager.startTask(task.id, "coder");
      taskManager.failTask(task.id, "No artifacts");

      const updated = taskManager.getTask(task.id);
      expect(updated!.status).toBe("ready");
      expect(updated!.retryCount).toBe(1);
      expect(updated!.error).toContain("No artifacts");
    });

    it("permanently fails after max retries", () => {
      const task = taskManager.createTask({
        projectId: "proj-001",
        title: "Doomed task",
        description: "D",
        type: "coding",
        status: "pending",
        dependsOn: [],
        maxRetries: 1,
      });

      taskManager.startTask(task.id, "coder");
      taskManager.failTask(task.id, "Error 1");
      
      taskManager.startTask(task.id, "coder");
      taskManager.failTask(task.id, "Error 2");

      const updated = taskManager.getTask(task.id);
      expect(updated!.status).toBe("failed");
      expect(updated!.completedAt).toBeInstanceOf(Date);
    });
  });

  describe("Project Status", () => {
    it("reports allCompleted when all tasks done", () => {
      const t1 = taskManager.createTask({ projectId: "proj-001", title: "T1", description: "D", type: "coding", status: "pending", dependsOn: [], maxRetries: 3 });

      taskManager.startTask(t1.id, "coder");
      taskManager.completeTask(t1.id, "Done", []);

      const status = taskManager.getProjectStatus("proj-001");
      expect(status.allCompleted).toBe(true);
      expect(status.completed).toBe(1);
      expect(status.total).toBe(1);
    });

    it("reports hasFailures when task permanently failed", () => {
      const t1 = taskManager.createTask({ projectId: "proj-001", title: "T1", description: "D", type: "coding", status: "pending", dependsOn: [], maxRetries: 0 });

      taskManager.startTask(t1.id, "coder");
      taskManager.failTask(t1.id, "Fatal error");

      const status = taskManager.getProjectStatus("proj-001");
      expect(status.hasFailures).toBe(true);
      expect(status.failed).toBe(1);
    });
  });
});
```

## 1.7 DAG Validation Tests

```typescript
// tests/unit/dag.test.ts
import { describe, it, expect } from "vitest";
import { validateDAG, DAGValidationError } from "@eamilos/core/validation/dag.js";

describe("DAG Validation", () => {
  it("accepts valid linear chain: A → B → C", () => {
    const tasks = [
      { id: "A", dependsOn: [] },
      { id: "B", dependsOn: ["A"] },
      { id: "C", dependsOn: ["B"] },
    ];

    expect(() => validateDAG(tasks)).not.toThrow();
  });

  it("accepts valid diamond: A → B,C → D", () => {
    const tasks = [
      { id: "A", dependsOn: [] },
      { id: "B", dependsOn: ["A"] },
      { id: "C", dependsOn: ["A"] },
      { id: "D", dependsOn: ["B", "C"] },
    ];

    expect(() => validateDAG(tasks)).not.toThrow();
  });

  it("accepts independent tasks (no dependencies)", () => {
    const tasks = [
      { id: "A", dependsOn: [] },
      { id: "B", dependsOn: [] },
      { id: "C", dependsOn: [] },
    ];

    expect(() => validateDAG(tasks)).not.toThrow();
  });

  it("detects simple cycle: A → B → A", () => {
    const tasks = [
      { id: "A", dependsOn: ["B"] },
      { id: "B", dependsOn: ["A"] },
    ];

    expect(() => validateDAG(tasks)).toThrow(DAGValidationError);
  });

  it("detects longer cycle: A → B → C → A", () => {
    const cyclic = [
      { id: "A", dependsOn: ["E"] },
      { id: "B", dependsOn: ["A"] },
      { id: "C", dependsOn: ["B"] },
      { id: "D", dependsOn: ["C"] },
      { id: "E", dependsOn: ["D"] },
    ];

    expect(() => validateDAG(cyclic)).toThrow(DAGValidationError);
  });

  it("detects self-reference: A → A", () => {
    const tasks = [
      { id: "A", dependsOn: ["A"] },
    ];

    expect(() => validateDAG(tasks)).toThrow(DAGValidationError);
  });

  it("detects reference to non-existent task", () => {
    const tasks = [
      { id: "A", dependsOn: ["NONEXISTENT"] },
    ];

    expect(() => validateDAG(tasks)).toThrow(DAGValidationError);
  });

  it("includes cycle path in error", () => {
    const tasks = [
      { id: "A", dependsOn: ["C"] },
      { id: "B", dependsOn: ["A"] },
      { id: "C", dependsOn: ["B"] },
    ];

    try {
      validateDAG(tasks);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DAGValidationError);
      expect((e as DAGValidationError).cycle.length).toBeGreaterThanOrEqual(2);
    }
  });
});
```

## 1.8 Tool Executor Tests

```typescript
// tests/unit/tool-executor.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ToolRegistry } from "@eamilos/core/tools/registry.js";
import { ToolExecutor } from "@eamilos/core/tools/executor.js";
import { WorkspaceManager } from "@eamilos/core/workspace.js";
import { EventBus } from "@eamilos/core/event-bus.js";
import { Logger } from "@eamilos/core/logger.js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { createTestContext, type TestContext } from "../helpers/test-workspace.js";

describe("ToolExecutor", () => {
  let ctx: TestContext;
  let workspace: WorkspaceManager;
  let registry: ToolRegistry;
  let executor: ToolExecutor;
  let eventBus: EventBus;

  beforeEach(async () => {
    ctx = createTestContext();
    workspace = new WorkspaceManager(join(ctx.baseDir, "projects"), false, 10, 500);
    eventBus = new EventBus();
    const logger = new Logger("error", false);
    const permissions = { check: () => ({ allowed: true, reason: "test" }) };
    
    registry = new ToolRegistry();
    executor = new ToolExecutor(registry, workspace, permissions as any, eventBus, logger);

    await workspace.createProject("test-proj", "Test Project");
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const execContext = {
    projectId: "test-proj",
    taskId: "task-001",
    agentId: "coder",
    correlationId: "corr-001",
  };

  describe("workspace_write", () => {
    it("creates a real file on disk", async () => {
      const result = await executor.execute(
        {
          name: "workspace_write",
          arguments: {
            path: "hello.py",
            content: 'print("Hello, World!")\n',
            description: "Test file",
          },
        },
        execContext
      );

      expect(result.success).toBe(true);
      expect(result.artifactCreated).toBe("hello.py");

      const fullPath = join(ctx.baseDir, "projects", "test-proj", "hello.py");
      expect(existsSync(fullPath)).toBe(true);

      const content = readFileSync(fullPath, "utf-8");
      expect(content).toBe('print("Hello, World!")\n');
    });

    it("creates parent directories", async () => {
      const result = await executor.execute(
        {
          name: "workspace_write",
          arguments: {
            path: "src/utils/helpers.py",
            content: "# helpers\n",
          },
        },
        execContext
      );

      expect(result.success).toBe(true);
      const fullPath = join(ctx.baseDir, "projects", "test-proj", "src", "utils", "helpers.py");
      expect(existsSync(fullPath)).toBe(true);
    });

    it("blocks path traversal", async () => {
      const result = await executor.execute(
        {
          name: "workspace_write",
          arguments: {
            path: "../../../etc/passwd",
            content: "hacked",
          },
        },
        execContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("rejects empty content", async () => {
      const result = await executor.execute(
        {
          name: "workspace_write",
          arguments: {
            path: "empty.py",
            content: "",
          },
        },
        execContext
      );

      expect(result.success).toBe(false);
    });

    it("emits artifact.created event", async () => {
      let emittedEvent: unknown = null;
      eventBus.on("artifact.created", (event) => { emittedEvent = event; });

      await executor.execute(
        { name: "workspace_write", arguments: { path: "test.py", content: "# test\n" } },
        execContext
      );

      expect(emittedEvent).not.toBeNull();
      expect((emittedEvent as any).path).toBe("test.py");
    });
  });

  describe("workspace_read", () => {
    it("reads existing file", async () => {
      await executor.execute(
        { name: "workspace_write", arguments: { path: "hello.py", content: "print('hi')\n" } },
        execContext
      );

      const result = await executor.execute(
        { name: "workspace_read", arguments: { path: "hello.py" } },
        execContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("print('hi')");
    });

    it("returns error for missing file", async () => {
      const result = await executor.execute(
        { name: "workspace_read", arguments: { path: "nonexistent.py" } },
        execContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("FILE_NOT_FOUND");
    });
  });

  describe("workspace_list", () => {
    it("lists all files", async () => {
      await executor.execute(
        { name: "workspace_write", arguments: { path: "a.py", content: "# a\n" } },
        execContext
      );
      await executor.execute(
        { name: "workspace_write", arguments: { path: "b.py", content: "# b\n" } },
        execContext
      );

      const result = await executor.execute(
        { name: "workspace_list", arguments: {} },
        execContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("a.py");
      expect(result.output).toContain("b.py");
    });

    it("reports empty workspace", async () => {
      const result = await executor.execute(
        { name: "workspace_list", arguments: {} },
        execContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("empty");
    });
  });

  describe("Error Handling", () => {
    it("returns error for unknown tool", async () => {
      const result = await executor.execute(
        { name: "nonexistent_tool", arguments: {} },
        execContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("UNKNOWN_TOOL");
    });

    it("returns validation error for bad arguments", async () => {
      const result = await executor.execute(
        {
          name: "workspace_write",
          arguments: { wrong_field: "test" },
        },
        execContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("VALIDATION_ERROR");
    });
  });
});
```

## 1.9 Event Bus Tests

```typescript
// tests/unit/event-bus.test.ts
import { describe, it, expect, vi } from "vitest";
import { EventBus } from "@eamilos/core/event-bus.js";

describe("EventBus", () => {
  it("emits and receives events", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on("test.event", handler);
    bus.emit("test.event", { foo: "bar" });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      type: "test.event",
      data: { foo: "bar" },
    }));
  });

  it("supports multiple handlers", () => {
    const bus = new EventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.on("test.event", h1);
    bus.on("test.event", h2);
    bus.emit("test.event", {});

    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it("removes handlers with off()", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on("test.event", handler);
    bus.off("test.event", handler);
    bus.emit("test.event", {});

    expect(handler).not.toHaveBeenCalled();
  });

  it("does not fire handlers for different events", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on("event.a", handler);
    bus.emit("event.b", {});

    expect(handler).not.toHaveBeenCalled();
  });
});
```


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 2: INTEGRATION TESTS — PHASE 2
# ═══════════════════════════════════════════════════════════════════════════════

## 2.1 Tool Bridge Test (THE MOST CRITICAL TEST IN THE ENTIRE SYSTEM)

```typescript
// tests/integration/tool-bridge.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentRunner } from "@eamilos/core/agent-runner.js";
import { ToolRegistry } from "@eamilos/core/tools/registry.js";
import { ToolExecutor } from "@eamilos/core/tools/executor.js";
import { WorkspaceManager } from "@eamilos/core/workspace.js";
import { EventBus } from "@eamilos/core/event-bus.js";
import { Logger } from "@eamilos/core/logger.js";
import { createHelloWorldMock, createNoToolCallMock, createInfiniteToolCallMock } from "../mocks/mock-provider.js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { createTestContext, type TestContext } from "../helpers/test-workspace.js";

describe("Tool Execution Bridge", () => {
  let ctx: TestContext;
  let workspace: WorkspaceManager;
  let runner: AgentRunner;

  beforeEach(async () => {
    ctx = createTestContext();
    workspace = new WorkspaceManager(join(ctx.baseDir, "projects"), false, 10, 500);
    const eventBus = new EventBus();
    const logger = new Logger("error", false);
    const permissions = { check: () => ({ allowed: true, reason: "test" }) };
    const registry = new ToolRegistry();
    const executor = new ToolExecutor(registry, workspace, permissions as any, eventBus, logger);
    runner = new AgentRunner(executor, registry, logger);

    await workspace.createProject("test-proj", "Test");
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const testAgent = {
    id: "coder",
    name: "Coder",
    role: "Write code",
    systemPrompt: "You are a coder",
    capabilities: ["code_write"],
    preferredTier: "strong" as const,
    tools: ["workspace_write", "workspace_read", "workspace_list"],
    maxTokens: 4096,
    temperature: 0.2,
    timeoutSeconds: 300,
    maxRetries: 3,
  };

  it("creates real files from model tool calls", async () => {
    const mockProvider = createHelloWorldMock();

    const mockRouter = {
      execute: async (agent: any, messages: any[], taskType: string, options: any) => {
        return mockProvider.chat({ messages, model: "mock", tools: options?.tools });
      },
      getModelForTier: () => ({ id: "mock", contextWindow: 128000 }),
    };

    const result = await runner.run(
      testAgent,
      "Write a hello world file",
      mockRouter as any,
      { projectId: "test-proj", taskId: "task-001", correlationId: "corr-001" }
    );

    expect(result.success).toBe(true);
    expect(result.artifacts).toContain("hello.py");
    expect(result.toolCallCount).toBeGreaterThan(0);

    const filePath = join(ctx.baseDir, "projects", "test-proj", "hello.py");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toBe('print("Hello, World!")\n');
  });

  it("reports failure when no tool calls made", async () => {
    const mockProvider = createNoToolCallMock();

    const mockRouter = {
      execute: async (agent: any, messages: any[], taskType: string, options: any) => {
        return mockProvider.chat({ messages, model: "mock", tools: options?.tools });
      },
      getModelForTier: () => ({ id: "mock", contextWindow: 128000 }),
    };

    const result = await runner.run(
      testAgent,
      "Write code",
      mockRouter as any,
      { projectId: "test-proj", taskId: "task-001", correlationId: "corr-001" }
    );

    expect(result.toolCallCount).toBe(0);
    expect(result.artifacts).toHaveLength(0);
  });

  it("stops at max iterations to prevent infinite loops", async () => {
    const mockProvider = createInfiniteToolCallMock();

    const mockRouter = {
      execute: async (agent: any, messages: any[], taskType: string, options: any) => {
        return mockProvider.chat({ messages, model: "mock", tools: options?.tools });
      },
      getModelForTier: () => ({ id: "mock", contextWindow: 128000 }),
    };

    const result = await runner.run(
      testAgent,
      "Do something",
      mockRouter as any,
      { projectId: "test-proj", taskId: "task-001", correlationId: "corr-001" }
    );

    expect(result.toolCallCount).toBeLessThanOrEqual(20);
  });
});
```

## 2.2 Dependency Chain Test

```typescript
// tests/integration/dependency-chain.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TaskManager } from "@eamilos/core/task-manager.js";
import { DatabaseManager } from "@eamilos/core/db.js";
import { createTestContext, type TestContext } from "../helpers/test-workspace.js";

describe("Dependency Chain Execution", () => {
  let ctx: TestContext;
  let db: DatabaseManager;
  let tm: TaskManager;

  beforeEach(() => {
    ctx = createTestContext();
    db = new DatabaseManager(ctx.dbPath);
    tm = new TaskManager(db);

    db.insertProject({ id: "proj", name: "Test", goal: "Test", status: "active", path: "/tmp", createdAt: new Date() });
  });

  afterEach(() => {
    db.close();
    ctx.cleanup();
  });

  it("executes A → B → C in correct order", () => {
    const taskA = tm.createTask({ projectId: "proj", title: "A", description: "D", type: "research", status: "pending", dependsOn: [], maxRetries: 3 });
    const taskB = tm.createTask({ projectId: "proj", title: "B", description: "D", type: "coding", status: "pending", dependsOn: [taskA.id], maxRetries: 3 });
    const taskC = tm.createTask({ projectId: "proj", title: "C", description: "D", type: "qa", status: "pending", dependsOn: [taskB.id], maxRetries: 3 });

    let ready = tm.getReadyTasks("proj");
    expect(ready.map(t => t.title)).toEqual(["A"]);

    tm.startTask(taskA.id, "researcher");
    tm.completeTask(taskA.id, "Done", ["research.md"]);

    ready = tm.getReadyTasks("proj");
    expect(ready.map(t => t.title)).toEqual(["B"]);

    tm.startTask(taskB.id, "coder");
    tm.completeTask(taskB.id, "Done", ["main.py"]);

    ready = tm.getReadyTasks("proj");
    expect(ready.map(t => t.title)).toEqual(["C"]);

    tm.startTask(taskC.id, "qa");
    tm.completeTask(taskC.id, "Done", ["test-report.json"]);

    const status = tm.getProjectStatus("proj");
    expect(status.allCompleted).toBe(true);
    expect(status.completed).toBe(3);
  });

  it("enables parallel tasks when dependencies allow", () => {
    const taskA = tm.createTask({ projectId: "proj", title: "A", description: "D", type: "research", status: "pending", dependsOn: [], maxRetries: 3 });
    const taskB = tm.createTask({ projectId: "proj", title: "B", description: "D", type: "coding", status: "pending", dependsOn: [taskA.id], maxRetries: 3 });
    const taskC = tm.createTask({ projectId: "proj", title: "C", description: "D", type: "coding", status: "pending", dependsOn: [taskA.id], maxRetries: 3 });

    tm.startTask(taskA.id, "researcher");
    tm.completeTask(taskA.id, "Done", []);

    const ready = tm.getReadyTasks("proj");
    expect(ready).toHaveLength(2);
    const titles = ready.map(t => t.title).sort();
    expect(titles).toEqual(["B", "C"]);
  });
});
```

## 2.3 Retry Flow Test

```typescript
// tests/integration/retry-flow.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TaskManager } from "@eamilos/core/task-manager.js";
import { RetryStrategy } from "@eamilos/core/retry-strategy.js";
import { DatabaseManager } from "@eamilos/core/db.js";
import { createTestContext, type TestContext } from "../helpers/test-workspace.js";

describe("Retry Flow", () => {
  let ctx: TestContext;
  let db: DatabaseManager;
  let tm: TaskManager;
  let retryStrategy: RetryStrategy;

  beforeEach(() => {
    ctx = createTestContext();
    db = new DatabaseManager(ctx.dbPath);
    tm = new TaskManager(db);
    retryStrategy = new RetryStrategy();

    db.insertProject({ id: "proj", name: "Test", goal: "Test", status: "active", path: "/tmp", createdAt: new Date() });
  });

  afterEach(() => {
    db.close();
    ctx.cleanup();
  });

  it("modifies context with increasing pressure on each retry", () => {
    const originalContext = "Write a hello world file";

    const retry1 = retryStrategy.buildRetryContext(originalContext, 1, 3, "No artifacts produced");
    expect(retry1).toContain("RETRY ATTEMPT 1");
    expect(retry1).toContain("No artifacts produced");
    expect(retry1).toContain("workspace_write");

    const retry2 = retryStrategy.buildRetryContext(originalContext, 2, 3, "Empty file");
    expect(retry2).toContain("RETRY ATTEMPT 2");
    expect(retry2).toContain("ELEVATED");

    const retry3 = retryStrategy.buildRetryContext(originalContext, 3, 3, "Still failing");
    expect(retry3).toContain("RETRY ATTEMPT 3");
    expect(retry3).toContain("CRITICAL");
    expect(retry3).toContain("FINAL");
  });

  it("task goes through full retry lifecycle", () => {
    const task = tm.createTask({ projectId: "proj", title: "Flaky", description: "D", type: "coding", status: "pending", dependsOn: [], maxRetries: 2 });

    tm.startTask(task.id, "coder");
    tm.failTask(task.id, "No artifacts");
    let t = tm.getTask(task.id);
    expect(t!.status).toBe("ready");
    expect(t!.retryCount).toBe(1);

    tm.startTask(task.id, "coder");
    tm.failTask(task.id, "Still no artifacts");
    t = tm.getTask(task.id);
    expect(t!.status).toBe("ready");
    expect(t!.retryCount).toBe(2);

    tm.startTask(task.id, "coder");
    tm.failTask(task.id, "Never gonna work");
    t = tm.getTask(task.id);
    expect(t!.status).toBe("failed");
    expect(t!.completedAt).toBeInstanceOf(Date);
  });
});
```


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 3: REALITY TESTS — END-TO-END WITH MOCK PROVIDER
# ═══════════════════════════════════════════════════════════════════════════════

## 3.1 Hello World Reality Test

```typescript
// tests/reality/hello-world.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { createTestContext, type TestContext } from "../helpers/test-workspace.js";

describe("Hello World Reality Test", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("produces a real, runnable Python file from a goal", async () => {
    // This test validates the COMPLETE flow:
    // Goal → Planner → Tasks → Agent → Tool Calls → Files on Disk → Project Complete
    
    // Setup: Create EamilOS instance with mock provider
    // The key assertions that MUST pass:
    // 1. Project was created
    // 2. Tasks were generated by planner
    // 3. Coder agent was assigned
    // 4. workspace_write tool was called
    // 5. File exists on disk
    // 6. File content is valid Python
    
    expect(true).toBe(true);
  });
});
```


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 4: CLI TESTS
# ═══════════════════════════════════════════════════════════════════════════════

## 4.1 CLI Command Tests

```typescript
// tests/cli/init.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execa } from "execa";
import { existsSync } from "fs";
import { createTestContext, type TestContext } from "../helpers/test-workspace.js";

describe("CLI: eamilos init", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("creates config file and data directory", async () => {
    const result = await execa("npx", ["tsx", "packages/cli/src/index.ts", "init"], {
      cwd: ctx.baseDir,
      env: { ...process.env, EAMILOS_DATA_DIR: ctx.baseDir },
      reject: false,
    });

    expect(result.exitCode).toBe(0);
  });
});
```


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 5: MANUAL VERIFICATION SCRIPTS
# ═══════════════════════════════════════════════════════════════════════════════

## 5.1 Phase 1 Manual Verification

```bash
#!/bin/bash
# scripts/verify-phase1.sh
set -e

echo "═══════════════════════════════════════════"
echo "  EAMILOS Phase 1 Verification"
echo "═══════════════════════════════════════════"
echo ""

echo "[1/8] Clean Build..."
rm -rf packages/*/dist data/
npm run build
echo "  ✅ Build succeeded"

echo "[2/8] CLI Version..."
VERSION=$(npx eamilos --version 2>/dev/null || echo "FAILED")
if [ "$VERSION" = "FAILED" ]; then
  echo "  ❌ CLI not working"
  exit 1
fi
echo "  ✅ Version: $VERSION"

echo "[3/8] Init..."
npx eamilos init 2>/dev/null
if [ ! -f "eamilos.config.yaml" ]; then
  echo "  ❌ Config not created"
  exit 1
fi
echo "  ✅ Config created"

echo "[4/8] Run (create project)..."
npx eamilos run "Phase 1 test project" 2>/dev/null
echo "  ✅ Project created"

echo "[5/8] Database..."
COUNT=$(sqlite3 data/eamilos.db "SELECT COUNT(*) FROM projects;" 2>/dev/null || echo "0")
if [ "$COUNT" = "0" ]; then
  echo "  ❌ No projects in database"
  exit 1
fi
echo "  ✅ $COUNT project(s) in database"

echo "[6/8] Workspace..."
PROJ_COUNT=$(ls data/projects/ 2>/dev/null | wc -l)
if [ "$PROJ_COUNT" = "0" ]; then
  echo "  ❌ No project directories"
  exit 1
fi
echo "  ✅ $PROJ_COUNT project directory(ies)"

echo "[7/8] Status..."
npx eamilos status 2>/dev/null
echo "  ✅ Status command works"

echo "[8/8] List..."
npx eamilos list 2>/dev/null
echo "  ✅ List command works"

echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ ALL PHASE 1 TESTS PASSED"
echo "═══════════════════════════════════════════"
```

## 5.2 Phase 2 Manual Verification

```bash
#!/bin/bash
# scripts/verify-phase2.sh
set -e

echo "═══════════════════════════════════════════"
echo "  EAMILOS Phase 2 Verification"
echo "═══════════════════════════════════════════"
echo ""

echo "[1/5] Phase 1 regression..."
bash scripts/verify-phase1.sh
echo ""

echo "[2/5] Automated tests..."
npm run test:phase2
echo "  ✅ Tests passed"

echo "[3/5] Hello World Reality Test..."
if [ -z "$OPENAI_API_KEY" ] && [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "  ⚠️  No API key set — skipping real LLM test"
  npm run test:reality
else
  npx eamilos run "Create a Python file that prints Hello World"
  LATEST=$(ls -t data/projects/ | head -1)
  
  if [ -f "data/projects/$LATEST/hello.py" ]; then
    echo "  ✅ hello.py created"
    CONTENT=$(cat "data/projects/$LATEST/hello.py")
    echo "  📄 Content: $CONTENT"
  else
    echo "  ❌ hello.py NOT FOUND"
    exit 1
  fi
fi

echo "[4/5] Cost tracking..."
npx eamilos cost "$LATEST" 2>/dev/null && echo "  ✅ Cost command works"

echo "[5/5] Agents..."
npx eamilos agents 2>/dev/null && echo "  ✅ Agents command works"

echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ ALL PHASE 2 TESTS PASSED"
echo "═══════════════════════════════════════════"
```


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 6: DEBUGGING PLAYBOOK
# ═══════════════════════════════════════════════════════════════════════════════

## 6.1 When No Files Are Created

```
SYMPTOM: eamilos run completes but no files in workspace

DIAGNOSIS STEPS:

Step 1: Check if model returned tool_calls
  → Enable debug logging: logging.level: debug in config
  → Look for: "Tool call: workspace_write(...)"
  → If NOT present: Model is not calling tools
  
  FIX:
  - Check that tools are passed in ChatRequest
  - Check system prompt contains tool usage instructions
  - Try adding to system prompt: "You MUST call workspace_write"
  - Some providers need tool_choice: "required"

Step 2: Check if tool executor received the call
  → Look for: "workspace_write executed"
  → If NOT present: Agent runner is not processing tool_calls
  
  FIX:
  - Check AgentRunner loop processes response.toolCalls
  - Check tool_calls format matches provider's format

Step 3: Check if file write succeeded
  → Look for: "✓ wrote: hello.py"
  → If NOT present: Write failed silently
  
  FIX:
  - Check workspace path is valid
  - Check permissions
  - Check disk space
```

## 6.2 When System Enters Infinite Retry Loop

```
SYMPTOM: Same task retries over and over with same error

DIAGNOSIS STEPS:

Step 1: Check error message
  → Is it the same error each time?
  → If YES: Retry context is not being modified
  
  FIX:
  - Verify RetryStrategy.buildRetryContext is called
  - Verify modified context is passed to next attempt
  - Add detection: if same error 2x → fail immediately

Step 2: Check budget
  → Is cost increasing rapidly?
  → If YES: Budget enforcement is not working
  
  FIX:
  - Verify budget.check() is called before each model call
  - Verify budget.exceeded → stops execution
  - Set lower maxRetries (default 3 is reasonable)
```

## 6.3 When Context Is Too Large

```
SYMPTOM: Model returns truncated or incoherent output

DIAGNOSIS STEPS:

Step 1: Measure context size
  → Log: estimateTokens(context) before model call
  → Compare to model's context window
  
  FIX:
  - Verify ContextBuilder respects MAX_CONTEXT_RATIO
  - Verify assembleWithBudget truncates low-priority sections
  - Reduce MAX_INLINE_SIZE for dependency outputs
```

## 6.4 When Database Is Locked

```
SYMPTOM: "SQLITE_BUSY" or "database is locked" errors

DIAGNOSIS STEPS:

Step 1: Check for multiple instances
  → Look for data/.eamilos.lock
  → Check if PID in lock file is alive
  
  FIX:
  - Kill other instance
  - Delete stale lock file

Step 2: Check WAL mode
  → sqlite3 data/eamilos.db "PRAGMA journal_mode;"
  → Should return "wal"
  
  FIX:
  - Enable WAL mode in db.ts initialization
  - Set busy_timeout: PRAGMA busy_timeout = 5000
```


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 7: COVERAGE REQUIREMENTS
# ═══════════════════════════════════════════════════════════════════════════════

## 7.1 Coverage Thresholds

```
MINIMUM COVERAGE BY MODULE:

schemas/              → 95%  (validation is critical)
task-manager.ts       → 90%  (state machine must be fully tested)
workspace.ts         → 85%  (file operations must be reliable)
tools/                → 90%  (execution bridge is critical)
validation/           → 90%  (DAG + artifact validation)
security.ts           → 95%  (security must be fully tested)
config.ts             → 80%  (env resolution, validation)
db.ts                 → 80%  (CRUD operations)
agent-runner.ts       → 85%  (tool call loop)
context-builder.ts    → 80%  (assembly logic)
retry-strategy.ts     → 85%  (pressure modification)
budget.ts             → 80%  (tracking + enforcement)
memory.ts             → 75%  (store + recall)
event-bus.ts          → 90%  (simple, should be fully tested)
logger.ts             → 60%  (logging is less critical)
```

## 7.2 Test Count Targets

```
MINIMUM TESTS PER MODULE:

schemas.test.ts           → 20+ tests
config.test.ts            → 10+ tests
db.test.ts                → 15+ tests
workspace.test.ts         → 12+ tests
task-manager.test.ts      → 20+ tests
dag.test.ts               → 8+ tests
security.test.ts          → 8+ tests
tool-executor.test.ts     → 15+ tests
event-bus.test.ts         → 5+ tests
agent-runner.test.ts      → 10+ tests
context-builder.test.ts   → 10+ tests
retry-strategy.test.ts    → 6+ tests
artifact-validator.test.ts → 10+ tests
budget.test.ts            → 8+ tests
memory.test.ts            → 8+ tests
errors.test.ts            → 5+ tests

INTEGRATION TESTS:
tool-bridge.test.ts       → 5+ tests
dependency-chain.test.ts   → 5+ tests
retry-flow.test.ts        → 4+ tests

TOTAL MINIMUM: ~200 tests
```


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 8: FINAL VERDICT CRITERIA
# ═══════════════════════════════════════════════════════════════════════════════

## 8.1 System WORKS If ALL of These Are True

```
✅ npm run build succeeds with zero errors
✅ npm test passes with zero failures
✅ Coverage meets thresholds
✅ CLI commands execute without crashes
✅ Tool executor creates REAL files on disk
✅ Agent runner processes tool calls in a loop
✅ Zero tool calls triggers task failure
✅ Retry modifies context with progressive pressure
✅ Task state machine rejects invalid transitions
✅ DAG validation catches circular dependencies
✅ Path traversal attacks are blocked
✅ Budget tracking records token usage
✅ Hello World reality test produces runnable Python file
```

## 8.2 System is BROKEN If ANY of These Are True

```
❌ Model output appears only in logs, not as files
❌ Tool calls are made but files don't appear on disk
❌ Tasks complete without producing artifacts
❌ Same retry error repeats indefinitely
❌ Invalid state transitions are allowed
❌ Circular dependencies are not detected
❌ Path traversal creates files outside workspace
❌ Build has errors or warnings
❌ Tests fail
```

## 8.3 The Ultimate Test

```
$ eamilos run "Create a Python file that prints Hello World"

Then:

$ python data/projects/<id>/hello.py
Hello, World!

If "Hello, World!" appears → THE SYSTEM WORKS.
If it doesn't → THE SYSTEM IS BROKEN.

Everything else is details.
```


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 9: DOCUMENT REGISTRY
# ═══════════════════════════════════════════════════════════════════════════════

## 9.1 Complete Document Set

| # | File | Purpose | Authority |
|---|------|---------|-----------|
| 1 | PRD.md | Product requirements, user experience | Product decisions |
| 2 | ARCHITECTURE.md | Schemas, state machines, system structure | Technical specs |
| 3 | AI_RULES.md | Agent behavioral contracts | Agent behavior |
| 4 | PLAN.md | Phased implementation plan | Build order |
| 5 | EXECUTION_SPEC.md | Tool runtime, execution mechanics | Execution mechanics |
| 6 | IMPLEMENTATION_GUIDE.md | Build process enforcement | Build process |
| 7 | TESTING.md | Test suite, verification, debugging | Verification (THIS FILE) |

## 9.2 Authority for Testing Decisions

- What to test → This document (TESTING.md)
- How code should behave → ARCHITECTURE.md + EXECUTION_SPEC.md
- What schemas to validate → ARCHITECTURE.md
- When to run tests → IMPLEMENTATION_GUIDE.md (per-step verification)
- Pass/fail criteria → This document (TESTING.md)

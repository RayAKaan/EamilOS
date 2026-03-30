# ==============================================================================
# EAMILOS — PHASED IMPLEMENTATION PLAN (COMPLETE)
# VERSION: 1.0.0-FINAL
# AUDIENCE: AI AGENTS IMPLEMENTING EAMILOS
# ==============================================================================

# 1. END STATE VISION

EamilOS becomes a unified operating layer where:
→ Multiple agents collaborate autonomously on complex projects
→ Projects are executed through structured task graphs with dependency resolution
→ Work persists across sessions, crashes, and agent boundaries
→ All execution is observable, auditable, and cost-controlled
→ The system integrates with any IDE, model provider, or toolchain via MCP
→ Humans set goals, the system handles execution

---

# 2. IMPLEMENTATION PHASES

The system is built in FOUR PHASES. Each phase delivers a functional increment.
Each phase MUST be fully complete and verified before proceeding to the next.

---

## 🟢 PHASE 1: EXECUTION CORE & WORKSPACE
### **"The system can create projects, manage tasks, and persist artifacts"**

### Deliverables

| File | Purpose |
|------|---------|
| `package.json` (root) | Monorepo workspace config |
| `tsconfig.json` (root) | Base TypeScript config |
| `.env.example` | Environment template |
| `eamilos.config.yaml` | Default configuration |
| `.gitignore` | Ignore rules |
| `packages/core/package.json` | Core package config |
| `packages/core/tsconfig.json` | Core TS config |
| `packages/core/src/types.ts` | Re-exports from schemas |
| `packages/core/src/schemas/project.ts` | Project schema + transitions |
| `packages/core/src/schemas/task.ts` | Task schema + state machine |
| `packages/core/src/schemas/artifact.ts` | Artifact schema |
| `packages/core/src/schemas/agent.ts` | Agent schema |
| `packages/core/src/schemas/event.ts` | Event schema |
| `packages/core/src/schemas/config.ts` | Config schema |
| `packages/core/src/config.ts` | YAML loader, env resolver, Zod validation |
| `packages/core/src/db.ts` | SQLite manager, all tables, CRUD, migrations |
| `packages/core/src/migrations.ts` | Migration runner |
| `packages/core/src/workspace.ts` | File I/O, Git integration, path validation |
| `packages/core/src/security.ts` | Path traversal prevention, size limits |
| `packages/core/src/task-manager.ts` | Task CRUD, dependency resolution, state machine enforcement |
| `packages/core/src/event-bus.ts` | Simple pub/sub event system |
| `packages/core/src/logger.ts` | Structured logging (console + file, JSON lines) |
| `packages/core/src/index.ts` | AgentOS class, public API |
| `packages/cli/package.json` | CLI package config |
| `packages/cli/tsconfig.json` | CLI TS config |
| `packages/cli/bin/eamilos` | Executable with shebang |
| `packages/cli/src/index.ts` | CLI entry point |
| `packages/cli/src/commands/init.ts` | Init command |
| `packages/cli/src/commands/run.ts` | Run command (creates project, stubs orchestration) |
| `packages/cli/src/commands/status.ts` | Status command |
| `packages/cli/src/commands/list.ts` | List all projects |
| `packages/cli/src/ui.ts` | Terminal output formatting |

### Implementation Requirements

1. **Config Loader:**
   - Parse YAML with `yaml` package
   - Recursively resolve `${ENV_VAR}` patterns from `process.env`
   - Validate with Zod ConfigSchema
   - On missing env vars → list ALL missing (not just first)
   - On validation error → show field-level errors

2. **Database:**
   - SQLite with WAL mode, foreign keys ON, busy_timeout 5000
   - Create all tables from ARCHITECTURE.md Section 4.2
   - Migration system: check version table, apply new migrations
   - All CRUD methods for projects, tasks, artifacts, events
   - JSON serialization for array fields (dependsOn, artifacts, constraints)
   - ISO string serialization for dates

3. **Workspace:**
   - Create project directories
   - Git init with config (if git available, graceful fallback)
   - Write artifacts with path validation (Security Section 8.1)
   - Atomic writes (write to .tmp, rename)
   - Read artifacts with existence check
   - List files recursively (exclude .git directory)
   - Size limit enforcement

4. **Task Manager:**
   - CRUD operations
   - State machine enforcement (ARCHITECTURE.md Section 5)
   - `getReadyTasks`: filter pending/ready where ALL deps are completed
   - Circular dependency detection on task creation
   - Retry logic with count tracking
   - Project status aggregation

5. **Event Bus:**
   - Simple in-process pub/sub
   - `emit(type, data)`, `on(type, handler)`, `off(type, handler)`
   - Events persisted to database events table

6. **Logger:**
   - Console: chalk-colored human-readable
   - File: JSON Lines format
   - Log levels: debug, info, warn, error
   - Correlation ID support
   - Log rotation (rename-based)

7. **CLI:**
   - `eamilos init`: Create config, .env, data directory
   - `eamilos run <goal>`: Create project + workspace, log success, stub orchestration
   - `eamilos status`: Show all projects with task counts
   - `eamilos list`: List projects with status

### Phase 1 Verification Checklist

```bash
# Build must succeed with zero errors
npm install
npm run build

# CLI must be linkable and runnable
cd packages/cli && npm link && cd ../..

# Init must work
eamilos init
# Verify: eamilos.config.yaml exists, .env exists, data/ exists

# Run must create project
eamilos run "Build a hello world app"
# Verify: project created in data/projects/
# Verify: project record in SQLite
# Verify: git repo initialized in project dir

# Status must show project
eamilos status
# Verify: shows project with 0 tasks

# List must work
eamilos list
# Verify: shows project

# Database must have correct schema
sqlite3 data/eamilos.db ".tables"
# Verify: projects, tasks, artifacts, events, schema_version tables exist

# Config validation must work
# Remove a required field from config → should show clear error
# Set invalid env var → should list missing vars
```

### Phase 1 Stub Boundaries

Mark these with `// PHASE 2: <description>`:
- `provider-manager.ts` → stub that logs providers from config
- `agent-registry.ts` → stub that logs prebuilt agent names
- `model-router.ts` → stub
- `context-builder.ts` → stub
- `orchestrator.ts` → stub
- `run.ts` command → creates project but does not orchestrate

---

## 🟡 PHASE 2: INTELLIGENCE & COORDINATION
### **"The system can execute tasks autonomously using AI agents"**

### Deliverables

| File | Purpose |
|------|---------|
| `packages/core/src/provider-manager.ts` | Full provider management |
| `packages/core/src/providers/base.ts` | Abstract provider interface |
| `packages/core/src/providers/openai.ts` | OpenAI provider |
| `packages/core/src/providers/ollama.ts` | Ollama provider |
| `packages/core/src/providers/anthropic.ts` | Anthropic provider |
| `packages/core/src/model-router.ts` | Tier-based model selection + fallback |
| `packages/core/src/agent-registry.ts` | YAML agent loader + capability matching |
| `packages/core/src/agents/prompts.ts` | All system prompts from AI_RULES.md |
| `packages/core/src/agents/researcher.yaml` | Researcher definition |
| `packages/core/src/agents/coder.yaml` | Coder definition |
| `packages/core/src/agents/qa.yaml` | QA definition |
| `packages/core/src/agents/planner.yaml` | Planner definition |
| `packages/core/src/context-builder.ts` | Full implementation from ARCHITECTURE.md Section 6 |
| `packages/core/src/orchestrator.ts` | Full implementation from ARCHITECTURE.md Section 7 |
| `packages/core/src/budget.ts` | Cost tracking and enforcement |
| `packages/cli/src/commands/cost.ts` | Cost breakdown command |
| `packages/cli/src/commands/decisions.ts` | Decision log command |
| `packages/cli/src/commands/history.ts` | Event history command |
| `packages/cli/src/commands/agents.ts` | List agents command |

### Implementation Requirements

1. **Providers:**
   - Abstract base with chat(), isAvailable(), getModels()
   - OpenAI: use `openai` npm package, tool calling support
   - Ollama: HTTP API to local endpoint, tool calling if supported
   - Anthropic: use `@anthropic-ai/sdk`, tool calling support
   - All providers: timeout support, retry on 429, error classification

2. **Model Router:**
   - Select model based on: task type → config routing → agent preference → fallback
   - Implement fallback chain from config
   - Estimate cost before call
   - Log routing decision

3. **Agent Registry:**
   - Load YAML agent definitions from `agents/` directory
   - Load custom agents from user config path
   - Match agents to tasks by: type mapping, capability matching
   - Expose agent list via CLI

4. **Context Builder:**
   - Implement FULL algorithm from ARCHITECTURE.md Section 6
   - Token budget management
   - Dependency output inlining with size limits
   - Workspace snapshot with file count limits
   - Artifact enforcement section

5. **Orchestrator:**
   - Implement FULL algorithm from ARCHITECTURE.md Section 7
   - Process lock (prevent double execution)
   - Parallel execution with configurable limit
   - Artifact validation after each task
   - Retry with pressure prompt on artifact failure
   - Budget checking before each model call
   - Event emission for all state changes
   - Graceful shutdown handling

6. **Budget:**
   - Track tokens and cost per task and project
   - Warn at configured percentage
   - Block at configured limit
   - Report via CLI

### Phase 2 Verification Checklist

```bash
# End-to-end execution must work
eamilos run "Build a Python CLI that says hello"
# Verify: planner creates tasks
# Verify: researcher runs (if research task created)
# Verify: coder writes actual code files
# Verify: files exist in data/projects/<id>/src/
# Verify: task statuses update in database
# Verify: events logged

# Cost tracking must work
eamilos cost <project-id>
# Verify: shows token usage and cost per task

# Decision log must work
eamilos decisions <project-id>
# Verify: shows decisions made by agents

# History must work
eamilos history <project-id>
# Verify: shows chronological event log

# Agent list must work
eamilos agents
# Verify: shows researcher, coder, qa, planner with capabilities

# Retry must work
# Simulate: mock provider returns no tool calls (no artifacts)
# Verify: task retries with pressure prompt
# Verify: after max retries, task fails

# Fallback must work
# Simulate: primary provider unavailable
# Verify: system falls back to next provider in chain
```

### Phase 2 Stub Boundaries

Mark these with `// PHASE 3: <description>`:
- `permissions.ts` → stub that always allows
- `memory.ts` → stub with empty recall
- Budget → tracks but does not enforce hard limits yet

---

## 🟠 PHASE 3: GOVERNANCE & OBSERVABILITY
### **"The system enforces security, permissions, cost limits, and provides full observability"**

### Deliverables

| File | Purpose |
|------|---------|
| `packages/core/src/permissions.ts` | Full permission engine |
| `packages/core/src/budget.ts` | Full budget enforcement |
| `packages/core/src/memory.ts` | Project-scoped memory (key-value + search) |
| `packages/core/src/security.ts` | Enhanced: command sandboxing, secret detection |
| `packages/cli/src/commands/pause.ts` | Pause project |
| `packages/cli/src/commands/resume.ts` | Resume project |
| `packages/cli/src/commands/retry.ts` | Retry failed tasks |
| `packages/cli/src/commands/cancel.ts` | Cancel project |
| `packages/cli/src/commands/export.ts` | Export project as zip |
| `packages/cli/src/commands/archive.ts` | Archive project |

### Implementation Requirements

1. **Permissions:**
   - Per-agent permission matrix (from AgentSchema)
   - Permission check before: file write, file delete, command execute, network access
   - Default policy from config (allow/deny/ask)
   - `ask` policy → prompt user in terminal
   - Log all permission checks to events table

2. **Budget Enforcement:**
   - Hard stop when budget exceeded
   - Project auto-pause on budget exceeded
   - Per-task budget limits
   - Configurable warning thresholds

3. **Memory:**
   - Store: key-value pairs scoped to project or global
   - Recall: search by query string (simple substring match for now)
   - Types: fact, preference, decision, mistake, procedure
   - Importance scoring (manual, agent-assigned)
   - Integrate into ContextBuilder (Priority 5 section)

4. **Security Enhancements:**
   - Command execution sandboxing (timeout, env sanitization)
   - Secret detection in artifacts (scan for patterns like API keys)
   - Workspace size monitoring and enforcement

5. **Project Operations:**
   - Pause: set status to paused, stop orchestrator loop
   - Resume: set status to active, restart orchestrator
   - Retry: reset failed tasks to ready
   - Cancel: mark all non-terminal tasks as cancelled
   - Export: zip workspace + metadata JSON
   - Archive: compress workspace, keep DB records

### Phase 3 Verification Checklist

```bash
# Permission enforcement
# Configure coder agent with fileDelete: false
# Verify: coder cannot delete files, gets PermissionDeniedError

# Budget enforcement
# Set max_cost_per_project_usd: 0.01
# Run a project
# Verify: project pauses when budget exceeded
# Verify: budget.exceeded event logged

# Memory
# Run a project with research task
# Verify: research findings stored in memory
# Run second task
# Verify: memory recall returns relevant findings in context

# Project lifecycle
eamilos pause <project-id>    # Verify: status = paused
eamilos resume <project-id>   # Verify: status = active, execution resumes
eamilos retry <project-id>    # Verify: failed tasks reset to ready
eamilos cancel <project-id>   # Verify: all non-terminal tasks cancelled
eamilos export <project-id>   # Verify: zip file created
eamilos archive <project-id>  # Verify: workspace compressed, status = archived
```

---

## 🔴 PHASE 4: SCALING & INTEGRATION
### **"The system integrates with IDEs, supports advanced workflows, and scales"**

### Deliverables

| File | Purpose |
|------|---------|
| `packages/core/src/mcp-server.ts` | MCP server mode |
| `packages/core/src/memory.ts` | Enhanced: embedding-based search, global memory |
| `packages/cli/src/commands/mcp.ts` | Start MCP server command |
| `tests/unit/*.test.ts` | All unit tests |
| `tests/integration/*.test.ts` | All integration tests |
| `tests/mocks/*.ts` | Mock providers and agents |

### Implementation Requirements

1. **MCP Server:**
   - Implement as MCP server using `@modelcontextprotocol/sdk`
   - Transport: stdio (for IDE integration) + SSE (for web)
   - Expose tools: project CRUD, task management, workspace operations, memory
   - Expose resources: project status, workspace files, agent list
   - Test with: Claude Desktop, Cursor, Cline

2. **Enhanced Memory:**
   - Embedding-based semantic search (optional, if embedding provider available)
   - Global memory across projects
   - Memory decay (reduce importance over time)
   - Memory compression (summarize old memories)

3. **Advanced Workflows:**
   - Dynamic task generation (agent can create subtasks during execution)
   - Human-in-the-loop checkpoints (approval gates)
   - Validation hooks (run tests after coding tasks)
   - Automatic retry with modified strategy

4. **Testing:**
   - Unit tests for all core modules
   - Integration tests for full project lifecycle
   - Mock provider for deterministic testing
   - Coverage target: 80%

5. **Documentation:**
   - README.md with quickstart
   - API documentation
   - Agent development guide
   - Configuration reference

### Phase 4 Verification Checklist

```bash
# MCP server mode
eamilos mcp
# Verify: MCP server starts on stdio
# Verify: Claude Desktop can connect and list tools
# Verify: Can create project via MCP tool call
# Verify: Can read workspace via MCP resource

# Testing
npm test
# Verify: all unit tests pass
# Verify: all integration tests pass
# Verify: coverage >= 80%

# Full end-to-end
eamilos run "Build a REST API with Express"
# Verify: planner creates 5+ tasks
# Verify: researcher finds Express docs
# Verify: coder writes server.js, routes, package.json
# Verify: qa writes tests, produces test report
# Verify: all artifacts in workspace
# Verify: cost tracked and reported
# Verify: decisions logged
# Verify: events timeline complete
```

---

# 3. TECH STACK

| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime | Node.js | 20+ |
| Language | TypeScript | 5.7+ |
| Module System | ESM (NodeNext) | — |
| Database | better-sqlite3 | 11+ |
| Config | yaml | 2.7+ |
| Validation | zod | 3.24+ |
| CLI Framework | commander | 13+ |
| Terminal UI | chalk, ora | 5+, 8+ |
| Git | simple-git | 3.27+ |
| IDs | nanoid | 5+ |
| MCP SDK | @modelcontextprotocol/sdk | 1.12+ |
| OpenAI | openai | 4.80+ |
| Anthropic | @anthropic-ai/sdk | 0.39+ |
| Testing | vitest | 3+ |
| Process | execa (cross-platform) | 9+ |

---

# 4. BUILD & DISTRIBUTION

## 4.1 Development

```bash
npm install           # Install all workspace dependencies
npm run build         # Build all packages
npm run dev           # Development mode with watch
npm test              # Run all tests
npm run lint          # Lint all packages
npm run clean         # Remove all build artifacts
```

## 4.2 Distribution

```bash
# npm
npm publish --workspace=packages/core
npm publish --workspace=packages/cli

# Global install
npm install -g eamilos

# npx (no install)
npx eamilos init
npx eamilos run "Build something"

# Docker (Phase 4)
docker run -v $(pwd):/workspace eamilos run "Build something"
```

---

# 5. SCALING ROADMAP

## Phase 1: Local (Current)
- CLI-based, single machine
- SQLite database
- Local file workspace

## Phase 2: Hybrid
- Remote model execution
- Shared workspaces (git-based)
- Webhook notifications

## Phase 3: Cloud
- Multi-user support
- Persistent infrastructure
- Agent marketplace
- Web dashboard
- Team workspaces

---

# 6. FINAL PRINCIPLES

1. **The system is artifact-driven, not conversation-driven.**
2. **Models change every 6 months. The OS layer is the product.**
3. **Context is the moat. The ContextBuilder is the most valuable component.**
4. **Ship Phase 1 fast. Iterate on Phases 2-4 with user feedback.**
5. **Every operation is auditable. Every decision is logged.**
6. **Security is not optional. Path validation and sandboxing from day one.**
7. **Graceful degradation over hard failure. Git missing? Continue without it.**

---

# 7. AUTHORITY HIERARCHY

If documents conflict, follow this precedence:

1. **ARCHITECTURE.md** — authoritative for technical specifications, schemas, algorithms
2. **AI_RULES.md** — authoritative for agent behavior and execution laws
3. **PRD.md** — authoritative for product requirements, user experience, lifecycle
4. **PLAN.md** — authoritative for implementation order, phase boundaries, verification

No document may contradict a higher-authority document.
If ambiguity exists, follow the higher-authority document.

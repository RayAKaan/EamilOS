# ==============================================================================
# EAMILOS — PRODUCT REQUIREMENTS DOCUMENT (AGENT VERSION)
# VERSION: 1.0.0-FINAL
# AUDIENCE: AI AGENTS BUILDING AND OPERATING WITHIN EAMILOS
# ==============================================================================

# 1. IDENTITY

You are operating inside:

**EamilOS (AOG — Agentic Operating Ground)**

This is NOT a chatbot system.
This is NOT a code generation tool.
This is a **coordinated execution environment** that transforms human goals
into real, working systems through structured agent collaboration.

EamilOS is to AI agents what Linux is to processes:
- It manages lifecycle
- It controls resources
- It enforces permissions
- It coordinates execution
- It persists state

---

# 2. CORE OBJECTIVE

Transform a high-level human goal into:

→ Structured tasks with dependency graphs
→ Coordinated multi-agent execution
→ Real, tangible artifacts (files, systems, deployable outputs)

The system receives a goal. The system produces a working result.
Humans set direction. The system handles execution.

---

# 3. SYSTEM PHILOSOPHY

These principles are NON-NEGOTIABLE. Every design decision must align.

1. **Work is persistent, not conversational.**
   State survives crashes, restarts, and session boundaries.

2. **Outputs are artifacts, not messages.**
   Every task produces files. Chat-only output is failure.

3. **Agents are specialized workers, not generalists.**
   Each agent has a role, capabilities, and constraints.

4. **Execution is stateful, not stateless.**
   Every task knows what came before and what comes after.

5. **Coordination is implicit, not explicit.**
   Agents do not talk to each other. They communicate through artifacts and task outputs.

6. **The system is artifact-driven, not conversation-driven.**
   If it is not in the workspace, it does not exist.

---

# 4. SUCCESS DEFINITION

A task is ONLY successful if ALL of the following are true:

- Tangible artifacts are created in the workspace
- Artifacts are complete and functional (no placeholders, no pseudo-code)
- Outputs are usable without further human prompting
- Downstream agents can continue without ambiguity
- All required files are present and valid
- Context was consumed and applied correctly

A project is ONLY successful if ALL of the following are true:

- All tasks reached terminal state (completed or intentionally skipped)
- All artifacts are present in workspace
- The original goal is met by the combined artifacts
- Cost stayed within budget
- No security violations occurred

---

# 5. FAILURE DEFINITION

A task is considered FAILED if ANY of the following are true:

- No artifacts are produced
- Output is incomplete, abstract, or speculative
- Context was ignored or misapplied
- Work must be redone manually by human
- Files contain placeholders (`// TODO`, `// ...`, `// implementation`)
- Downstream agents cannot continue from this output
- Budget was exceeded without producing value

A project is considered FAILED if:

- Critical tasks failed after all retries
- System entered unrecoverable state
- Budget exceeded with no useful output
- Security violation detected

---

# 6. SYSTEM RESPONSIBILITIES

## What the System Guarantees:

- Context availability for every agent execution
- Correct task ordering via dependency resolution
- Workspace persistence across sessions and crashes
- Agent coordination through artifact flow
- Resource management (tokens, cost, time)
- Security enforcement (path validation, sandboxing)
- Crash recovery and state resumption
- Audit trail of all operations

## What Agents Must Guarantee:

- Execution quality matching the task requirements
- Artifact creation for every task
- Full context consumption before acting
- Downstream-safe outputs
- Adherence to role boundaries
- Decision-making without unnecessary human consultation

---

# 7. AGENT ROLE IN SYSTEM

Each agent is:

- **Stateless individually** — no memory between executions
- **Stateful through workspace + context** — sees all prior work
- **Responsible for exactly one task at a time**
- **Replaceable** — any agent of the same role produces equivalent output
- **Accountable** — all actions are logged and auditable

Agents DO NOT:
- Own the project or redefine goals
- Communicate directly with other agents
- Ignore dependency outputs or workspace state
- Make decisions outside their role scope
- Access resources outside their permission set
- Exceed their token or cost budget

---

# 8. COORDINATION MODEL

Agents operate through a strict pipeline:

```
Task → Context Injection → Agent Execution → Artifact Production → Next Task
```

There is NO direct agent-to-agent communication.
ALL coordination happens through:
→ **Workspace** (shared file system)
→ **Task outputs** (structured summaries)
→ **Dependency graph** (execution ordering)

This means:
- Agent A writes artifacts
- System builds context from Agent A's artifacts
- Agent B receives that context
- Agent B produces new artifacts
- Cycle continues until project completes

---

# 9. OUTPUT CONTRACT

Every agent execution MUST:

1. **Consume** all available context (project goal, task description, dependency outputs, workspace state)
2. **Produce** tangible artifacts (files written to workspace via tools)
3. **Enable** the next task in the dependency chain
4. **Summarize** what was done, what was created, and what decisions were made
5. **Stay within** token and cost budgets

---

# 10. PROJECT LIFECYCLE

## 10.1 Project States

```
active → completed     (all tasks done successfully)
active → failed        (unrecoverable task failures)
active → paused        (human intervention or budget pause)
paused → active        (human resumes)
completed → archived   (workspace compressed, metadata kept)
failed → active        (human retries from failure point)
```

## 10.2 Project Operations

| Command | Action |
|---------|--------|
| `eamilos run <goal>` | Create project, plan tasks, execute |
| `eamilos status` | Show all projects with status |
| `eamilos status <project>` | Show detailed task breakdown |
| `eamilos pause <project>` | Stop orchestration gracefully |
| `eamilos resume <project>` | Resume from current state |
| `eamilos retry <project>` | Reset failed tasks to ready |
| `eamilos cancel <project>` | Mark all pending tasks cancelled |
| `eamilos archive <project>` | Compress workspace, keep metadata |
| `eamilos delete <project>` | Remove everything (requires --force) |
| `eamilos export <project>` | Create portable zip |
| `eamilos history <project>` | Show full event timeline |
| `eamilos cost <project>` | Show token/cost breakdown |
| `eamilos decisions <project>` | Show all decisions made |
| `eamilos list` | List all projects |

## 10.3 Crash Recovery

On system startup:
1. Check for lock file (`data/.eamilos.lock`)
2. If lock exists and PID is dead → remove stale lock
3. If lock exists and PID is alive → abort with error
4. Scan for projects with status `active`
5. For each active project:
   a. Find tasks with status `in_progress`
   b. Reset stuck tasks to `ready` (increment retry count)
   c. Log recovery action
6. Resume orchestration if `--resume` flag or interactive prompt

## 10.4 Graceful Shutdown

On SIGINT/SIGTERM:
1. Stop accepting new task assignments
2. Wait for in-progress tasks to complete (timeout: 30s)
3. If tasks still running after timeout → mark as `interrupted`
4. Flush all logs
5. Close database connections
6. Remove lock file
7. Exit with appropriate code

On double SIGINT:
1. Immediately mark all in-progress tasks as `interrupted`
2. Force close database
3. Remove lock file
4. Exit immediately

---

# 11. USER INTERACTION MODEL

## 11.1 Approval Flow

When a task has `requiresHumanApproval: true`:
1. Pause execution for that specific task
2. Display: task title, agent output summary, artifacts produced
3. Prompt user: `[A]pprove / [R]eject with feedback / [S]kip`
4. On approve → mark completed, unblock downstream
5. On reject → mark as ready with feedback in error field, retry
6. On skip → mark as cancelled, propagate block to dependents

## 11.2 Preview Mode

Before execution begins:
1. Display proposed task graph
2. Show estimated cost and time
3. Prompt: `[P]roceed / [E]dit plan / [C]ancel`
4. On edit → allow adding/removing/modifying tasks
5. On proceed → begin execution
6. Configurable: `settings.preview_mode: true|false`

## 11.3 Progress Display

During execution, terminal shows:
```
[00:05] [RESEARCHER] → analyzing API documentation...
[00:07] [RESEARCHER] ✓ wrote: artifacts/api-research.md (2.1KB)
[00:07] ✅ Task 1/4 completed (1 artifact)
[00:08] [CODER] → reading artifacts/api-research.md
[00:12] [CODER] ✓ wrote: src/main.py (3.4KB)
[00:12] [CODER] ✓ wrote: requirements.txt (0.1KB)
[00:12] ✅ Task 2/4 completed (2 artifacts)

Progress: ████████░░ 50% | Tokens: 8,200 | Cost: $0.04
```

---

# 12. CONFIGURATION

## 12.1 Config File: `eamilos.config.yaml`

```yaml
version: 1

providers:
  - id: openai
    type: openai
    api_key: ${OPENAI_API_KEY}
    models:
      - id: gpt-4o-mini
        tier: cheap
        context_window: 128000
      - id: gpt-4o
        tier: strong
        context_window: 128000
  - id: ollama
    type: ollama
    endpoint: http://localhost:11434
    models:
      - id: llama3.1
        tier: cheap
        context_window: 8192

routing:
  default_tier: cheap
  task_routing:
    research: cheap
    coding: strong
    planning: strong
    qa: cheap
  fallback_order: [openai, ollama]

workspace:
  base_dir: ./data/projects
  git_enabled: true
  max_file_size_mb: 10
  max_workspace_size_mb: 500

budget:
  max_tokens_per_task: 50000
  max_cost_per_project_usd: 5.00
  warn_at_percentage: 80

settings:
  max_parallel_tasks: 3
  task_timeout_seconds: 300
  model_call_timeout_seconds: 120
  preview_mode: true
  auto_retry: true

logging:
  level: info
  console: true
  file: ./data/logs/eamilos.log
  max_file_size_mb: 50
  max_files: 5
```

## 12.2 Config Validation Protocol

On startup:
1. Check config file exists → if not, generate default with comments
2. Parse YAML → if syntax error, show line number and column
3. Check config `version` field → if incompatible, show migration instructions
4. Resolve ALL env vars → if any missing, list ALL missing (not just first)
5. Validate with Zod → if invalid, show human-readable field-level errors
6. Check provider connectivity → warn for unavailable providers (don't crash)
7. Verify disk space → warn if < 1GB, block if < 100MB

---

# 13. EXTENSION MODEL

## 13.1 Custom Agents

Users create YAML files in `~/.eamilos/agents/` or project-level `agents/`:

```yaml
id: ml-engineer
name: ML Engineer Agent
role: Train and evaluate machine learning models
capabilities: [train_model, evaluate, data_analysis]
preferredTier: strong
temperature: 0.2
maxTokens: 8192
systemPrompt: |
  You are an ML Engineer agent...
tools: [workspace_read, workspace_write, command_execute]
```

System loads custom agents alongside prebuilt. Custom agents with same ID override prebuilt.

## 13.2 Custom Tools (MCP)

Users register MCP-compatible tool servers:

```yaml
tools:
  - name: database_query
    mcp_server: "npx @my/db-tool"
  - name: deploy
    mcp_server: "./tools/deploy-server"
```

## 13.3 Hooks

```yaml
hooks:
  before_task_execute: "./hooks/validate-context.js"
  after_task_complete: "./hooks/run-tests.js"
  on_project_complete: "./hooks/notify-slack.js"
```

## 13.4 Workspace Templates

```bash
eamilos run --template web-app "Build a dashboard"
eamilos run --template cli-tool "Build weather CLI"
eamilos run --template api-service "Build REST API"
```

Templates predefine: task structure, agent assignments, file layout patterns.

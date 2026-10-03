# EamilOS

> **One mission. Many agents. One control plane.**

EamilOS is a **mission-oriented AI software-engineering orchestration platform**.

Instead of running every coding agent as an isolated session, EamilOS gives your work a durable mission, task graph, execution state, agent fleet, approvals, recovery, validation, and Git delivery layer.

**Agents do the work. EamilOS coordinates the work.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node.js-20%2B-green?logo=node.js)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-black)](LICENSE)

---

## What EamilOS is

EamilOS sits **above AI coding agents and execution environments**.

You define the outcome. EamilOS turns that outcome into coordinated work.

```text
Developer
   │
   ▼
Mission
   │
   ├── Intent
   ├── Task Graph
   ├── Decisions
   ├── Approvals
   │
   ▼
Execution Fabric
   │
   ├── Claude Code
   ├── Codex CLI
   ├── OpenCode
   ├── Gemini CLI
   ├── Aider
   ├── Goose
   ├── DeepSeek Harness
   └── Universal Agent Catalog
   │
   ▼
Validation + Evidence
   │
   ▼
Git Workspaces → Commits → Integration
   │
   ▼
Mission Outcome
```

The abstraction is the **mission**, not the model, agent, terminal session, or machine.

---

## Why it exists

AI coding tools are becoming extremely capable. The next problem is coordination.

A real software project can require:

- different agents for different tasks
- different models and providers
- multiple concurrent executions
- local and remote workers
- human approval for sensitive operations
- recovery after worker or agent failure
- persistent state across sessions
- deterministic task ownership
- isolated Git workspaces
- validation before declaring work complete
- an auditable history of what happened

EamilOS is built around that problem.

> **Stop switching between AI coding sessions. Start running software missions.**

---

# Core capabilities

### Mission Control

Persistent mission lifecycle with:

- mission creation and inspection
- task decomposition
- task state
- execution state
- mission history
- mission recovery
- deterministic coordination
- durable state

### Cognitive Execution Graph

A graph connecting:

```text
Mission
  └── Task
       ├── Decision
       ├── Execution
       │    ├── Agent
       │    └── Worker
       ├── Artifact
       ├── Validation
       └── Git Change
```

The graph is used to understand dependencies, ownership, execution, and why a mission reached its current state.

### Multi-agent execution

EamilOS can coordinate heterogeneous coding agents instead of forcing every task through one provider.

Agents are selected and scheduled around capabilities, availability, execution state, and mission requirements.

### Distributed execution

The runtime includes a distributed mission layer with:

- durable mission authority
- SQLite-backed state
- event history
- sequence numbers
- integrity verification
- assignment versions
- fencing tokens
- leases
- worker/node state
- stale-worker protection
- task requeueing
- checkpoint/recovery primitives
- event replication
- ACKs
- replay requests
- gap detection
- snapshot recovery

### Git-aware execution

Every distributed task can have a deterministic workspace identity:

```text
eamilos/mission/<mission>/task/<task>/attempt-<n>
```

EamilOS can:

- allocate isolated task workspaces
- track task attempts
- inspect commit evidence
- detect overlapping file changes
- build deterministic integration plans
- integrate compatible changes
- record Git integration events
- retain conflict evidence
- clean up completed workspaces safely

### Approvals and human control

EamilOS treats human control as part of the runtime.

The approval system supports scoped approvals with exact binding across execution context, including mission/task/execution identity and relevant command/runtime information.

The runtime also supports lifecycle control such as pause, resume, stop, retry, and reassignment.

### Validation and evidence

A successful agent response is not automatically a successful mission.

EamilOS keeps execution, validation, artifacts, and Git state separate so completion can be backed by evidence.

### Mission TUI

A full-screen terminal interface for operating the mission runtime.

The TUI is designed around the mission rather than around a single chat session.

It provides surfaces for:

- mission state
- tasks
- live execution
- agents
- fleet/workers
- graph
- loop state
- decisions
- approvals
- artifacts
- sessions
- logs
- Git/GitHub
- chat and commands

The TUI is a client of the runtime; it does not own mission state.

---

# Agents

EamilOS has a **universal agent catalog** containing **35 agent/harness definitions**.

The catalog records capabilities, protocols, platforms, installation information, authentication methods, execution mode, and integration status.

## First-class agent adapters

These have dedicated EamilOS agent implementations:

| Agent | Provider | Role |
|---|---|---|
| **OpenCode** | OpenCode | Coding agent |
| **Claude Code** | Anthropic | Coding agent |
| **Codex CLI** | OpenAI | Coding agent |
| **Gemini CLI** | Google | Coding agent |
| **Aider** | Aider | Coding agent |
| **Goose** | Block | Agentic coding/runtime |
| **DeepSeek Harness** | DeepSeek | Harness / execution runtime |

## Universal agent catalog

EamilOS currently knows about:

| Agent | Status |
|---|---|
| OpenCode | Production |
| Claude Code | Production |
| Codex CLI | Production |
| Gemini CLI | Production |
| Aider | Supported |
| Goose | Supported |
| DeepSeek Harness | Supported |
| Qwen Code | Supported |
| Kimi Code | Supported |
| Mistral Vibe | Supported |
| Cline CLI | Supported |
| Kilo Code | Supported |
| OpenHands | Experimental |
| Pi | Supported |
| Hermes Agent | Supported |
| Deep Agents Code | Supported |
| Crush | Supported |
| Grok Build | Experimental |
| Open Interpreter | Supported |
| Trae Agent | Supported |
| ForgeCode | Experimental |
| Letta Code | Supported |
| Continue CLI | Supported |
| SWE-agent | Supported |
| Plandex | Supported |
| OpenSquilla | Experimental |
| gptme | Supported |
| Kode CLI | Experimental |
| Codebuff | Supported |
| Amazon Q Developer CLI | Supported |
| GitHub Copilot CLI | Experimental |
| Cursor CLI | Experimental |
| Kiro CLI | Experimental |
| Auggie | Experimental |
| Amp | Supported |

**Important:** catalog support does not mean the external tool is installed or authenticated on your machine. EamilOS discovers, validates, and works with the execution resources actually available in the environment.

---

# Intelligence layer

Agents execute tasks. Intelligence providers can help reason about what should happen next.

EamilOS separates these concerns.

The architecture includes bounded decision-provider concepts such as:

- **Jev** — strategic/high-level decision reasoning
- **Laya** — major-task planning and task breakdown

The mission runtime remains authoritative. Model output proposes or informs actions; durable mission state records what actually happened.

---

# The execution loop

EamilOS is built around a continuous mission loop:

```text
Observe
   ↓
Interpret
   ↓
Plan
   ↓
Execute
   ↓
Measure
   ↓
Validate
   ↓
Adapt
   ↺
```

This lets execution respond to actual mission state instead of treating the original prompt as a fixed script.

---

# Distributed mission architecture

The distributed runtime is built around a durable control plane.

```text
                 Mission Authority
                        │
        ┌───────────────┼────────────────┐
        ▼               ▼                ▼
   Task Scheduler   Mission Ledger   Event Log
        │               │                │
        └───────────────┼────────────────┘
                        ▼
                  Worker / Fleet
                        │
             ┌──────────┼──────────┐
             ▼          ▼          ▼
           Agent      Agent      Agent
             │          │          │
             └──────────┼──────────┘
                        ▼
                  Git Workspace
                        │
                        ▼
                 Validation/Evidence
                        │
                        ▼
                    Integration
```

### Ownership and fencing

Distributed tasks use:

- assignment versions
- fencing tokens
- attempts
- leases
- ownership validation
- stale-result rejection

This prevents an old worker from completing a task after ownership has moved to a newer execution.

### Event replication

Mission events can be replicated through the authenticated fabric with:

- contiguous sequence tracking
- event-ID deduplication
- out-of-order buffering
- ACKs
- bounded replay
- gap detection
- reconnect replay
- snapshot fallback

The goal is durable, recoverable mission state rather than best-effort message passing.

---

# Git delivery

EamilOS connects execution to repository state.

```text
Mission
  ↓
Task
  ↓
Assignment
  ↓
Isolated Workspace
  ↓
Agent Execution
  ↓
Commit Evidence
  ↓
Integration Plan
  ↓
Conflict Detection
  ↓
Git Integration
  ↓
Validated Repository State
```

Integration is deterministic: candidate workspaces are ordered consistently, changed files are normalized, and overlapping changes are surfaced before integration.

---

# TUI

The EamilOS TUI is designed as a **mission control surface**.

Core concepts include:

- Mission HUD
- mission timeline
- task/graph state
- live execution
- agent cards
- worker/fleet visibility
- command palette
- slash commands
- prompt composer
- steering/control
- approvals
- evidence
- logs
- Git/GitHub state
- contextual notifications

Terminal behavior includes:

- centralized keymap
- shortcut conflict detection
- mouse input parsing
- responsive layouts
- terminal resize handling
- TTY-safe rendering
- ASCII fallback
- reduced-motion support

---

# Persistence and recovery

Mission state is not just an in-memory object.

The distributed mission authority uses a SQLite-backed state store with:

- durable events
- materialized snapshots
- atomic persistence
- event hash chaining
- integrity verification
- replay-based recovery
- migration support
- corruption-tolerant snapshot recovery

The event history remains the recovery boundary.

---

# Safety and control

EamilOS is designed for autonomous execution without removing operator control.

The runtime provides explicit boundaries for:

- approvals
- scoped authorization
- command execution
- lifecycle control
- cancellation
- retries
- leases
- worker fencing
- validation
- evidence

The principle is simple:

> **Autonomy should be observable, recoverable, and controllable.**

---

# Architecture at a glance

```text
┌────────────────────────────────────────────────────────────┐
│                     EamilOS Interfaces                     │
│              CLI · TUI · Commands · APIs                  │
└─────────────────────────────┬──────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────┐
│                     Mission Control                        │
│   Missions · Tasks · Graph · Decisions · Approvals        │
└─────────────────────────────┬──────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────┐
│                    Execution Fabric                        │
│   Agents · Harnesses · Workers · Fleet · Leases           │
└─────────────────────────────┬──────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────┐
│                  Durable Mission State                     │
│   Ledger · Events · Snapshots · Replication · Recovery    │
└─────────────────────────────┬──────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────┐
│                    Delivery Layer                           │
│       Git · Workspaces · Validation · Evidence             │
└────────────────────────────────────────────────────────────┘
```

---

# CLI

Install the published CLI:

```bash
npm install -g @eamilos/cli
```

Launch EamilOS:

```bash
eamilos
```

Run a goal:

```bash
eamilos run "Build a production-ready REST API"
```

Inspect the environment:

```bash
eamilos doctor
eamilos agents
eamilos status
```

Persistent missions:

```bash
eamilos mission create "Build a production-ready authentication system"
eamilos mission run "Build a production-ready authentication system"
eamilos mission list
eamilos mission show <mission-id>
```

Development:

```bash
git clone https://github.com/RayAKaan/EamilOS.git
cd EamilOS
npm install
npm run build
npm test
npm run typecheck
```

Requires **Node.js 20+**.

---

# Repository structure

```text
packages/cli/src/
├── core/
│   ├── mission/              # Mission + task graph
│   ├── distributed-mission/  # Authority, scheduling, replication, Git
│   ├── agents/               # Universal agent platform
│   ├── cognitive-graph/      # Cognitive execution graph
│   ├── approvals/            # Approval and authorization
│   ├── decisions/            # Decision layer
│   ├── loop/                 # Execution loop
│   ├── fleet/                # Workers / execution resources
│   └── ...
├── multi-agent/              # Agent adapters and orchestration
├── commands/                 # CLI commands
├── tui/                      # Full-screen terminal UI
├── terminal/                 # Terminal primitives
└── detection/                # Environment/provider detection
```

---

# Technology

EamilOS is currently built with:

- **TypeScript**
- **Node.js 20+**
- **SQLite / better-sqlite3**
- **Commander**
- **Zod**
- **WebSockets**
- **simple-git**
- **node-pty**
- **esbuild**
- **Vitest**
- terminal-native rendering

---

# Design principles

### Mission first
The unit of work is a mission, not a chat session.

### Agents are capabilities
Agents and harnesses are interchangeable execution resources.

### Durable state
Important mission state survives process boundaries and can be reconstructed.

### Deterministic coordination
Scheduling, ownership, assignment, and Git integration should have predictable behavior.

### Recovery by design
Failure, disconnects, lease expiry, and stale workers are normal runtime conditions.

### Evidence over assertion
A task is not complete merely because an agent says it is complete.

### Human authority
Autonomy and operator control coexist.

### Runtime/UI separation
The TUI observes and controls the runtime; it is not the source of truth.

### Extensible execution
New agents, harnesses, models, workers, and providers should plug into the same mission abstraction.

---

# What EamilOS is not

EamilOS is not:

- another single-model coding assistant
- a wrapper around one LLM
- a replacement for Claude Code, Codex, OpenCode, Gemini CLI, or other coding agents
- a terminal UI that exists independently of an execution runtime
- a requirement that every task use the same agent

EamilOS is the **coordination layer around the work**.

---

# The idea

The first generation of AI coding tools made individual agents powerful.

EamilOS focuses on the next layer:

> **How do many capable AI systems, workers, models, and tools behave like one coherent software-engineering environment?**

That means:

**one mission → many tasks → many agents → coordinated execution → durable state → validated software.**

---

## EamilOS

**One mission. Many agents. One control plane.**

MIT License.

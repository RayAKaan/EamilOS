<div align="center">

# EamilOS

### The execution kernel for autonomous AI work.

**Give it an objective. EamilOS plans, coordinates, executes, validates, recovers, adapts, and explains the mission.**

[![npm](https://img.shields.io/npm/v/@eamilos/cli?style=for-the-badge)](https://www.npmjs.com/package/@eamilos/cli)
[![CI](https://img.shields.io/github/actions/workflow/status/RayAKaan/EamilOS/ci.yml?style=for-the-badge&label=CI)](https://github.com/RayAKaan/EamilOS/actions)
[![License](https://img.shields.io/badge/license-MIT-black?style=for-the-badge)](LICENSE)
[![Node](https://img.shields.io/badge/node-20%2B-black?style=for-the-badge)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-black?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org)

**[Install](https://www.npmjs.com/package/@eamilos/cli) · [GitHub](https://github.com/RayAKaan/EamilOS) · [Issues](https://github.com/RayAKaan/EamilOS/issues)**

</div>

---

# EamilOS is not another AI wrapper.

Most AI tools look like:

```
You → Prompt → Model → Output
```

EamilOS is built around:

```
You
 ↓
MISSION
 ↓
COGNITIVE EXECUTION GRAPH
 ↓
JEV — strategy
 ↓
LAYA — planning
 ↓
DISTRIBUTED EXECUTION
 ↓
VALIDATION + EVIDENCE
 ↓
RECOVERY / ADAPTATION
 ↓
MISSION RESULT
```

**The model is not the system. The runtime is the system.**

EamilOS is an open-source AI execution kernel that turns heterogeneous AI models, coding agents, local machines, and workers into one governed execution fabric.

> **Give EamilOS an objective instead of micromanaging an agent.**

---

# Why this exists

An LLM can generate code. That does not mean it can reliably **complete work**.

Real engineering has tasks, dependencies, multiple models, multiple machines, quotas, failures, tests, checkpoints, Git branches, approvals, and changing conditions.

A prompt does not solve those problems.

**A runtime does.**

EamilOS treats AI execution as an engineering systems problem.

---

# The architecture

| Layer | Responsibility |
|---|---|
| **Jev** | Strategic decisions — *what should happen next?* |
| **Laya** | Local planning — *how should a major task happen?* |
| **EamilOS** | Authority — state, graph, scheduling, validation, policy, recovery |
| **Workers** | Execution — files, commands, tests, research, artifacts |

Jev does not own mission state. Laya does not own the global graph. Workers do not self-certify their output.

**EamilOS remains the authority.**

---

# What makes EamilOS different

### Mission-first

The user gives an **objective**, not a pile of prompts.

### Cognitive Execution Graph

EamilOS connects:

```
Mission · Tasks · Dependencies · Executions
Devices · Capabilities · Resources
Models · Harnesses · Artifacts · Evidence
Validation · Failures · Decisions · Checkpoints
Git branches · Commits
```

### Autonomous loop

```
OBSERVE → INTERPRET → PLAN → EXECUTE → MEASURE → VALIDATE → ADAPT
   ↑                                                               │
   └───────────────────────────────────────────────────────────────┘
```

### Distributed execution

Multiple machines can participate in one logical mission. There is no permanent master laptop in the architecture.

### Bounded self-modification

When reality contradicts the current execution path, EamilOS can make policy-bounded graph adaptations instead of blindly repeating the same action.

### Human control

Humans can inspect, pause, resume, approve, deny, replan, verify, and cancel without micromanaging every task.

---

# A mission in EamilOS

Run:

```bash
eamilos mission run "Build a REST API with authentication and tests"
```

Conceptually:

```
OBJECTIVE
   ↓
MISSION
   ↓
COGNITIVE GRAPH
   ↓
JEV ──────────────→ strategy
   │
   ↓
LAYA ─────────────→ plan
   │
   ↓
TASK COORDINATION
   ↓
HARNESS / DEVICE SELECTION
   ↓
EXECUTION
   ↓
ARTIFACTS + CHECKPOINTS
   ↓
VALIDATION
   ├── PASS ────────────────→ CONTINUE
   │
   └── FAIL → RECOVER / ADAPT → CONTINUE
                                      ↓
                              MISSION COMPLETE
```

You do not manually orchestrate every arrow.

---

# Mission control

Create:

```bash
eamilos mission create "Build authentication for this application"
```

Run:

```bash
eamilos mission run "Build authentication for this application"
```

Inspect:

```bash
eamilos mission status <missionId>
eamilos mission report <missionId>
eamilos mission history <missionId>
```

Control:

```bash
eamilos mission pause <missionId>
eamilos mission resume <missionId>
eamilos mission replan <missionId>
eamilos mission cancel <missionId>
```

Example:

```
Mission: mission_7f2a
Goal: Build a production-ready authentication system
Status: ACTIVE | Autonomy: AUTONOMOUS

Progress: 8/12 tasks (67%)
  Running: 2 | Ready: 1 | Blocked: 1 | Failed: 0

Graph: v47
  nodes: 126
  edges: 241
  consistent: true

Loop: RUNNING | phase EXECUTE | iteration 9
Approvals pending: 0
```

---

# Human control without micromanagement

Mission policies define where autonomy stops.

```bash
eamilos mission create \
  "Prepare and validate the release" \
  --autonomy AUTONOMOUS \
  --approve PUSH DEPLOY
```

A sensitive action can become an approval boundary:

```
MISSION PAUSED

Approval required:
  DEPLOY

Approve:
  eamilos mission approve <missionId> <approvalId>

Deny:
  eamilos mission deny <missionId> <approvalId>
```

Supported autonomy modes:

```
ASSISTED
PLANNED
AUTONOMOUS
```

---

# Understand why something happened

Autonomous systems need to be inspectable.

```bash
eamilos mission why <missionId> <taskId>
```

A task can be traced through:

```
Task
 ↓
Dependency
 ↓
Execution
 ↓
Artifact
 ↓
Validation
 ↓
Failure
 ↓
Decision
 ↓
Recovery
```

Bounded natural-language mission control is also available:

```bash
eamilos mission ask <missionId> "why is the mission blocked?"
```

Supported intents become deterministic runtime operations; arbitrary text does not directly mutate state.

---

# The Cognitive Execution Graph

The graph is the semantic foundation of EamilOS:

```
Cognitive Execution Graph
│
├── Mission
├── Tasks ───────── Dependencies
├── Executions ──── Checkpoints
├── Devices ─────── Capabilities
├── Resources
├── Models
├── Harnesses
├── Artifacts
├── Evidence
├── Validation
├── Failures
├── Decisions
└── Git ──────────── Branches / Commits
```

Example:

```
Task
 ├─ REQUIRES → CUDA → AVAILABLE_ON → Device B
 ├─ EXECUTED_BY → Codex
 └─ PRODUCES → Artifact → VALIDATED_BY → Test suite
                                      │
                                      └─ FAILED → Failure
                                                     │
                                                     └─ Decision → Recovery
```

Inspect it:

```bash
eamilos graph show <missionId>
eamilos graph verify <missionId>
eamilos graph why <missionId> <taskId>
```

The graph makes autonomous execution **traceable rather than opaque**.

---

# The autonomous loop

EamilOS treats autonomous execution as a first-class runtime:

```
┌──────────┐
│ OBSERVE  │
└────┬─────┘
     ↓
┌──────────┐
│INTERPRET │
└────┬─────┘
     ↓
┌──────────┐
│   PLAN   │
└────┬─────┘
     ↓
┌──────────┐
│ EXECUTE  │
└────┬─────┘
     ↓
┌──────────┐
│ MEASURE  │
└────┬─────┘
     ↓
┌──────────┐
│ VALIDATE │
└────┬─────┘
     ↓
┌──────────┐
│  ADAPT   │
└────┬─────┘
     │
     └──────────────→ OBSERVE
```

Inspect it:

```bash
eamilos loop status <missionId>
eamilos loop events <missionId>
eamilos loop verify <missionId>
```

The loop has explicit budgets for iterations, decisions, executions, validations, recoveries, replans, stagnation, and wall time. It is not an unconstrained infinite agent loop.

---

# Bounded self-modification

Instead of:

```
FAIL → RETRY → FAIL → RETRY → FAIL
```

a bounded adaptation can create:

```
A → B → C

B fails

A → Recovery → B → C
```

Adaptation is constrained by graph consistency, mission policy, mutation budgets, graph-version checks, idempotency, and validation.

The trust boundary is:

```
Jev / Laya
      ↓
proposal
      ↓
EamilOS validation
      ↓
graph mutation
      ↓
new execution state
```

**AI proposes. EamilOS authorizes.**

---

# Distributed EamilOS

A device can contribute CPU, GPU, RAM, local models, harnesses, tools, providers, and execution capacity.

The fabric provides:

```
Identity
Authentication
Membership
Capabilities
Heartbeats
Peer communication
Task distribution
Checkpoint exchange
Mission event replication
```

Start a worker:

```bash
eamilos worker --port 7890
```

Connect:

```bash
eamilos connect <address>
```

Configured Tailscale discovery:

```bash
eamilos connect --tailscale
```

---

# Execution harnesses

EamilOS orchestrates existing execution systems rather than replacing them.

The repository contains definitions/integrations for CLI harnesses including:

- Claude Code
- OpenCode
- Codex CLI
- Gemini CLI
- Aider
- Goose

The harness layer deals with availability, authentication, capabilities, execution, timeouts, quota failures, retries, fallback, and checkpoints.

> **Use the best available executor for the task without making the executor the operating system.**

---

# Jev + Laya

## Jev — strategy

Jev answers:

> **What should happen next?**

Bounded actions include:

```
DECOMPOSE · EXECUTE · REASSIGN · RETRY
PARALLELIZE · SEQUENCE · REPLAN · VERIFY
CONTINUE · COMPLETE · ESCALATE · ABORT
```

EamilOS validates the decision before execution.

Jev is **BYOK**. EamilOS does not provide or proxy Jev credentials.

Typical configuration:

```text
EAMILOS_JEV_URL
EAMILOS_JEV_API_KEY
EAMILOS_JEV_HEALTH_URL       # optional
```

## Laya — local planning

Laya answers:

> **How should this major task happen?**

```
Major objective
      ↓
Laya
      ↓
Plan / task decomposition
      ↓
EamilOS reconciliation
      ↓
Execution
```

Typical configuration:

```text
EAMILOS_LAYA_COMMAND
EAMILOS_LAYA_ARGS             # optional JSON array
```

For deterministic development/testing:

```text
EAMILOS_INTELLIGENCE_MOCK=1
```

---

# Git-aware execution

Distributed work can be isolated into Git workspaces and branches:

```
Mission
  ↓
Task
  ↓
Git branch
  ↓
Execution
  ↓
Commit
  ↓
Validation
  ↓
Evidence
```

This gives concurrent work a clear boundary instead of forcing every worker into one mutable workspace.

---

# Validation is part of execution

"The model said it is finished" is not a sufficient completion condition.

EamilOS tracks:

```
Task state
Execution result
Artifacts
Checkpoints
Evidence
Validation
Completion criteria
```

> **An execution result is evidence. It is not automatically truth.**

---

# Security and policy

EamilOS includes security and policy layers around execution, including:

- workspace boundaries
- path validation
- secret handling
- secure logging
- plugin permissions
- agent environment construction
- execution policy
- mission-level approvals

AI-generated decisions are validated before becoming runtime actions.

---

# Explainability and integrity

Autonomous execution should answer:

```
What happened?
Why did it happen?
What changed?
What failed?
What happened next?
What evidence supports the result?
```

Use:

```bash
eamilos mission history <missionId>
eamilos mission report <missionId>
eamilos mission verify <missionId>
```

---

# Quick start

### Install

```bash
npm install -g @eamilos/cli
```

### Diagnose

```bash
eamilos doctor
```

### Configure

```bash
eamilos setup
```

### Run

```bash
eamilos mission run "Build a Python CLI that manages a todo list"
```

### Inspect

```bash
eamilos mission status <missionId>
```

Run `eamilos help` for the complete CLI surface.

---

# Command map

| Area | Examples |
|---|---|
| **Mission** | `create`, `run`, `start`, `status`, `pause`, `resume`, `cancel`, `replan` |
| **Human control** | `policy`, `approvals`, `approve`, `deny`, `ask` |
| **Explainability** | `report`, `history`, `why`, `verify` |
| **Graph** | `graph show`, `graph verify`, `graph why` |
| **Loop** | `loop run`, `status`, `pause`, `events`, `verify` |
| **Intelligence** | `context`, `decide`, `run`, `history` |
| **Fleet** | `worker`, `connect` |
| **Plugins** | `list`, `install`, `remove`, `health` |
| **Diagnostics** | `doctor`, `validate`, `status`, `history` |

---

# Architecture at a glance

```
┌─────────────────────────────────────────────────────┐
│                 MISSION INTERFACE                   │
│ create · run · status · control · approvals · ask  │
└─────────────────────────┬───────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────┐
│              COGNITIVE EXECUTION GRAPH              │
│ mission · tasks · devices · capabilities ·          │
│ executions · artifacts · evidence · validation ·     │
│ failures · decisions · checkpoints · git            │
└─────────────────────────┬───────────────────────────┘
                          │
             ┌────────────┴────────────┐
             ▼                         ▼
       ┌────────────┐            ┌────────────┐
       │    JEV     │            │    LAYA    │
       │  Strategy  │            │  Planning  │
       └─────┬──────┘            └─────┬──────┘
             └────────────┬────────────┘
                          ▼
┌─────────────────────────────────────────────────────┐
│                    RUNTIME + LOOP                   │
│ observe → interpret → plan → execute → measure →    │
│ validate → adapt                                    │
└─────────────────────────┬───────────────────────────┘
                          │
                ┌─────────┴─────────┐
                ▼                   ▼
        DISTRIBUTED FABRIC     LOCAL EXECUTION
        devices / resources    harnesses / models
                │                   │
                └─────────┬─────────┘
                          ▼
                  CHECKPOINT / EVIDENCE
                          │
                          ▼
                     VALIDATION
                          │
                          ▼
                    GRAPH UPDATE
                          │
                          └──────────↺
```

---

# Architecture principles

**EamilOS owns state.** Workers do not.

**EamilOS owns validation.** Models do not self-certify.

**AI proposes.** The runtime authorizes.

**Execution is observable.** Important state changes become structured events/evidence.

**Missions are persistent.** A mission is more than a model call.

**Failure is a state.** It belongs to the execution model.

**Distribution is capability-aware.** A device contributes what it can execute.

**Autonomy is bounded.** Budgets, policies, approvals, and termination conditions remain deterministic.

---

# Evolution

```
Phase 1   Mission + Task Graph
   ↓
1.5       Agent-local Planning + Reconciliation
   ↓
Phase 2   Harness Fabric + Execution Scheduling
   ↓
Phase 3   Jev + Laya Intelligence
   ↓
Phase 4   Communication Ground + A2A
   ↓
Phase 5   Autonomous Runtime + Hardening
   ↓
Phase 6   Device Fabric
   ↓
Phase 7   Distributed Mission Fabric
   ↓
Phase 8   Distributed Intelligence + GitHub
   ↓
Phase 9   Cognitive Execution Graph
   ↓
Phase 10  Autonomous Loop Engineering
   ↓
Phase 11  Self-Modifying Cognitive Graph
   ↓
Phase 12  Mission Interface + Human Control Plane
```

Each phase builds on the same execution model.

---

# Project structure

```
EamilOS/
├── packages/cli/
│   └── src/
│       ├── commands/
│       ├── core/
│       │   ├── mission/
│       │   ├── coordination/
│       │   ├── execution/
│       │   ├── intelligence/
│       │   ├── runtime/
│       │   ├── fabric/
│       │   ├── distributed-mission/
│       │   ├── cognitive-graph/
│       │   ├── loop/
│       │   ├── mission-interface/
│       │   ├── git/
│       │   ├── security/
│       │   └── policy/
│       ├── multi-agent/
│       ├── terminal/
│       └── tui/
├── .github/workflows/
└── README.md
```

---

# For developers

```bash
git clone https://github.com/RayAKaan/EamilOS.git
cd EamilOS
npm install

npm run typecheck
npm test
npm run build

npm run cli -- mission run "your objective"
```

The repository is a TypeScript monorepo; the publishable package is `@eamilos/cli`.

CI exercises Linux, macOS, and Windows with Node 20 and Node 22.

---

# Extending EamilOS

The plugin architecture supports:

```
feature
agent
tool
hook
provider
```

Install and inspect:

```bash
eamilos plugins install <source>
eamilos plugins list
eamilos plugins health
```

Plugins operate within declared permission boundaries.

---

# Who should use EamilOS?

EamilOS is especially interesting if you are:

- building AI coding infrastructure
- running multiple coding agents
- experimenting with local models
- operating a fleet of development machines
- building autonomous engineering workflows
- researching agent orchestration
- building AI-native developer tooling
- interested in reliable execution around unreliable models

If you only need a chatbot to write a snippet, EamilOS is probably more machinery than you need.

If you want **AI systems to execute persistent, multi-step objectives**, this is the problem EamilOS is designed around.

---

# The bigger idea

The shift is:

```
Traditional

Prompt
  ↓
Agent
  ↓
Answer


EamilOS

Objective
  ↓
Mission
  ↓
Graph
  ↓
Strategy
  ↓
Planning
  ↓
Distributed execution
  ↓
Evidence
  ↓
Validation
  ↓
Adaptation
  ↓
Result
```

The model is interchangeable.

# **The runtime is the product.**

---

# Current architecture status

The repository currently contains the core layers for:

- persistent missions and task graphs
- deterministic coordination and reconciliation
- harness scheduling and fallback
- Jev and Laya intelligence adapters
- autonomous runtime state
- authenticated device fabric
- distributed mission scheduling
- Git workspace coordination
- fleet-aware intelligence
- Cognitive Execution Graph
- autonomous execution loops
- bounded graph adaptation
- mission policies and human approvals
- mission inspection and reporting
- graph and loop verification
- bounded natural-language mission control

The system is actively evolving toward a more complete autonomous execution platform.

---

<div align="center">

# Give AI an objective.

## Let EamilOS run the mission.

```
Objective → Graph → Intelligence → Execution → Validation → Adaptation → Result
```

**Open source · MIT · TypeScript · Node.js**

[Install EamilOS](https://www.npmjs.com/package/@eamilos/cli) ·
[Explore the source](https://github.com/RayAKaan/EamilOS) ·
[Report an issue](https://github.com/RayAKaan/EamilOS/issues)

</div>

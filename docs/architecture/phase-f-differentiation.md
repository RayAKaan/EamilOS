# Phase F — EamilOS Differentiation

Phase F adds the capabilities that make EamilOS an orchestration system rather than another single coding harness.

## Components

- **Harness competition**: ranks available harnesses against explicit task capabilities and execution constraints.
- **Cross-harness delegation**: produces bounded handoff/fallback plans between harnesses.
- **Mission optimization**: converts task dependencies into execution waves and exposes the critical path.
- **Fleet scheduling**: maps tasks to capable, available devices using capability and load constraints.
- **Cognitive graph**: connects missions, tasks, decisions, executions, harnesses, artifacts, and evidence.
- **Decision engine**: records explicit option selection with cost/risk/confidence rationale.
- **Autonomous recovery**: chooses checkpoint resume, reassignment, retry, replan, or escalation from declared failure facts.
- **Evidence graph**: links requirements to validation and execution evidence.

Phase F deliberately keeps policy decisions explicit. It provides deterministic orchestration primitives; it does not silently override mission approvals or human policy.

## Runtime shape

```
Mission
  |
  +-- Optimizer --> Task Waves --> Fleet Scheduler
  |
  +-- Harness Competition --> Cross-Harness Delegation
  |
  +-- Decision Engine
  |
  +-- Autonomous Recovery
  |
  +-- Cognitive Graph
  |
  +-- Evidence Graph
```

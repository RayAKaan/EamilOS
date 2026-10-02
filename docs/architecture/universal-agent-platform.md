# Phase 1 — Universal Agent Platform

EamilOS Phase 1 establishes the universal worker boundary used by later intelligence, distributed execution, multi-terminal, and human-in-the-loop phases.

## Runtime contract

Mission → Task → AgentScheduler → CapabilityMatcher → UniversalAgentRegistry → AgentRuntime → TerminalSession → AgentResponse

The universal registry is the authoritative catalog for the 35 supported worker definitions. Existing specialized adapters remain intact for the original seven agents; every additional catalog worker is routed through the same universal runtime boundary.

## Lifecycle

1. Catalog — immutable agent definition, capabilities, protocols, platforms, installation and authentication metadata.
2. Detection — executable/version probing with bounded timeouts.
3. Health — platform, installation, protocol and credential readiness checks.
4. Scheduling — deterministic capability matching, preferred-agent routing and readiness gating.
5. Execution — terminal-backed runtime sessions with output streaming and lifecycle events.
6. Recovery — bounded fallback across fresh candidate agents.
7. Management — install, remove, plan, doctor, auth and run CLI workflows.
8. Compatibility — the legacy registry is populated from the universal catalog so existing routing code sees the same fleet.

## Safety boundaries

- EamilOS never prints credentials.
- Remote installer scripts are never executed automatically.
- Provider/manual/binary installations are explicit rather than pretending to be automated.
- Installation commands are deterministic and inspectable with eamilos agents plan.
- Runtime execution is only allowed after readiness checks.
- Deep doctor probes are bounded by timeouts.
- Recovery attempts are bounded and do not repeatedly select an already-tried worker.

## CLI

- eamilos agents list
- eamilos agents info <agent>
- eamilos agents plan <agent>
- eamilos agents install <agent>
- eamilos agents remove <agent>
- eamilos agents doctor [agent]
- eamilos agents auth <agent>
- eamilos agents run <agent> <prompt>
- eamilos agents install-all

The platform is deliberately provider-agnostic: Jev, Laya, OpenDots and A2A are later phases and are not required for Phase 1 execution.
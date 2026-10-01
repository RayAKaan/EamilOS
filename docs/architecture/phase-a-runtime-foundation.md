# Phase A — Runtime Foundation

Phase A moves EamilOS toward a capability-oriented runtime without replacing its mission/orchestration identity.

## Delivered primitives

- **Capability registry** — typed capability keys with explicit registration and disposal.
- **Typed event vocabulary** — stable runtime event names and payload contracts.
- **Agent-scoped capabilities** — agents can grant, revoke, assert, and inspect capabilities.
- **Plugin lifecycle hardening** — plugins can provide typed capabilities and expose dependency metadata.
- **Runtime dependency graph** — installed plugins can be inspected as a plugin/capability graph and exported as Mermaid.

## Compatibility

The existing string-key service API remains available. New code should prefer typed capability keys.

The existing session, mission, and orchestration layers remain authoritative. Phase A does not move mission execution into the plugin runtime.

## Architectural direction

```
Mission Runtime
      |
      v
Plugin Runtime
  |       |
  v       v
Capabilities  Typed Events
  |       |
  +--- Agent Scopes
          |
          v
   Harness / Tool / Model adapters
```

This is deliberately an additive foundation for later phases: universal tool runtime, canonical event log/replay, profiles/bundles, and external plugins.

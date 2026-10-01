# Phase C — Persistence, Replay & Recovery

Phase C makes mission state reconstructable from a durable append-only event history.

## Event store

Each mission owns an isolated JSONL event stream:

```
.eamilos/missions/<mission-id>/events.jsonl
                         |
                         +-- checkpoint.json
```

Events carry a monotonic sequence, actor, payload, and SHA-256 hash chained to the previous event. Appends are serialized per mission to prevent in-process sequence races.

## Replay

`MissionReplay` rebuilds projections from the event stream. Projections are independent of the persistence layer and can be registered as runtime capabilities.

Checkpoints allow a projection to start from a previously materialized state and replay only the tail.

## Recovery

`MissionRecovery` verifies the event chain before reconstructing runtime state. A corrupted history is rejected instead of silently producing an inconsistent mission state.

## Forking

`MissionEventStore.fork()` creates a new mission from a selected source sequence while recording provenance in the forked events.

This enables experiments, retries, alternate plans, and human-directed branching without mutating the original mission history.

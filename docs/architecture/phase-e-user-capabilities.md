# Phase E — User Capabilities

Phase E exposes the runtime as user-facing capabilities without moving authority into the UI.

## Capabilities

- **Skills** — versioned, discoverable, enable/disable executable capabilities.
- **Scheduler** — one-shot and recurring asynchronous jobs with cancellation and inspection.
- **Web** — bounded HTTPS requests with host, response-size, timeout, and abort controls.
- **Webhooks** — registered inbound routes with optional HMAC-SHA256 verification.
- **SDK** — programmatic access to missions, skills, scheduling, runtime, and inspection.
- **ACP** — transport-independent agent request/response envelopes with correlation IDs.

All capabilities remain behind explicit runtime APIs. Mission orchestration, permissions, and policy remain outside these adapters and can compose them through Phase D profiles/bundles.

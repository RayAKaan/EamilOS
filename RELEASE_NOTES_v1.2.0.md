# EamilOS v1.2.0 Release Notes

**Date:** 2026-05-01  
**Tag:** `v1.2.0`

---

## Premium Terminal UI Redesign

Complete visual overhaul inspired by Linear, Notion, and Raycast:

- **Zero borders** — all decorative borders removed, replaced with spacing-based separation
- **Centered welcome screen** — clean, inviting first impression instead of technical jargon
- **Floating input bar** — modern `❯` prompt without being trapped in a box
- **Clean message hierarchy** — `Agent:` / `You:` labels with bold colors, no more confusing `> ` prefixes
- **Subtle color system** — professional palette (cyan/green/gray) replaces harsh terminal colors
- **Real-time metrics** — task count and cost visible in the header at all times
- **Minimal status bar** — essential shortcuts only, no clutter

Launch with `eamilos-ui` to experience the new interface.

---

## Complete Agent Discovery System

Agents are now discovered, validated, and registered automatically at startup:

### YAML Agent Loader
- Define custom agents in `~/.eamilos/agents/*.yml` without code changes
- Full nested config support (permissions, tools, capabilities, system prompts)
- Template generation: `yamLoader.createTemplate('My Agent')` creates a starter file
- Graceful handling of invalid or incomplete YAML files

### Health Validator
- Real API calls validate cloud provider keys at startup (not just env var presence)
- Validates: OpenAI, Anthropic, Google, DeepSeek, XAI
- Ollama model existence check (not just server reachability)
- CLI tool execution validation (`--help` test)
- Clear reporting: `4 valid, 1 invalid` — expired/revoked keys caught immediately

### Auto-Discovery Integration
- Scans PATH for CLI tools, Ollama models, cloud provider keys, YAML agents
- Filters out invalid agents before registration
- Returns structured `DiscoveryResult` with valid/invalid counts

---

## Session Persistence

- Save and restore conversation sessions with encryption
- Auto-save on configurable interval (default: 30s)
- Profile-specific session directories: `~/.eamilos/sessions/<profileId>/`
- List, create, delete, and manage sessions via `/session` commands
- Health reports show session storage usage and corruption status

---

## Team Management

- Multi-user team support with role-based access control (RBAC)
- Roles: `admin`, `member`, `viewer` with granular permissions
- Workspace sharing between team members
- Audit logging for all team actions
- Compliance manager for organizational policy enforcement

---

## Template Engine

- 5 built-in project templates:
  - `react-auth` — React + TypeScript + JWT auth
  - `microservices` — Docker-based API architecture
  - `cli-tool` — Node.js CLI application
  - `data-pipeline` — ETL pipeline scaffolding
  - `api-server` — Express.js REST API
- Access via `/template` command in the TUI
- Template registry for custom templates

---

## Test Coverage

- **938/938 tests passing** across 45 test files
- New test suites: HealthMonitor, YAMLLoader, HealthValidator, SessionManager, TeamManager, Audit, Auth

---

## Breaking Changes

None. All changes are additive.

---

## Migration

No migration needed. Existing configurations and data are fully compatible.

---

## What's Next

- Distributed agent orchestration across multiple machines
- Enhanced model performance tracking and automatic routing
- Plugin marketplace

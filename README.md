<div align="center">

# EamilOS

### Stop debugging AI output. Start shipping.

Every AI tool gives you text and hopes it works.<br/>
EamilOS gives you **verified, validated, working files** — every time.

[![npm](https://img.shields.io/npm/v/eamilos.svg?style=flat-square)](https://www.npmjs.com/package/eamilos)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg?style=flat-square)](https://nodejs.org/)

<br/>

[Quick Start](#-quick-start) · [How It Works](#-how-it-works) · [See It In Action](#-see-it-in-action) · [Commands](#-commands) · [Security](#%EF%B8%8F-security) · [Architecture](#-architecture)

</div>

---

## ⚡ TL;DR

- AI outputs are unreliable  
- EamilOS validates, fixes, and guarantees them  
- You get working files, not broken responses  

Run:
```
npm install -g eamilos
eamilos run "Build something"
```

---

## 👥 Who This Is For

- Developers tired of fixing AI output  
- Builders using local models (Ollama)  
- Teams experimenting with AI workflows  
- Anyone who wants AI to produce real, working code  

---

## The Problem

You ask an AI tool to build something. It returns:

- JSON with a trailing comma that crashes your parser
- A filename called `data.json` instead of `calculator.py`
- A description of what the code *would* do instead of actual code
- Markdown-wrapped output that isn't machine-readable
- An API key you pasted in context, now hardcoded in the output

You spend more time **fixing AI output** than you would have spent **writing it yourself**.

That's not execution. That's a coin flip with extra steps.

---

## The Fix

**EamilOS is an AI execution kernel.**

Not a wrapper. Not a chatbot. A runtime that sits between you and the model and **guarantees the output is real, valid, and safe** before it ever touches your filesystem.

```
You say:  "Build a REST API with auth"

You get:  4 validated files on disk
          ├── src/server.js        (47 lines)
          ├── src/routes/auth.js   (62 lines)
          ├── package.json         (23 lines)
          └── tests/auth.test.js   (38 lines)

What happened in between:
  → Task classified as multi_file
  → Model selected: qwen2.5-coder:7b (score: 0.91)
  → Attempt 1: JSON had trailing comma → auto-repaired
  → Attempt 2: all files validated → security scanned → written
```

The model was unreliable. **The system was not.**

---

## ⚡ Quick Start

```bash
npm install -g eamilos
eamilos setup
eamilos run "Create a Python calculator with add, subtract, multiply, divide"
```

Three commands. Working files. Done.

---

## 🔬 See It In Action

```bash
$ eamilos run "Create a CLI todo app in Python with add, remove, and list commands"
```

```
  🎯 Task: code (complexity: moderate)
  🤖 Model: qwen2.5-coder:7b (score: 0.91)

  ⚡ Attempt 1/5
     ⚠️  Model returned markdown-wrapped JSON
     🔧 Auto-fix: REMOVED_MARKDOWN_WRAPPER
     ✅ JSON valid after repair

  ✅ Validation
     📄 todo.py — 68 lines — real code (not description) ✓
     🔒 No secrets detected ✓
     📁 Path safe ✓

  ────────────────────────────────────────

  ✅ Task Complete

  Files created:
    📄 todo.py    (68 lines, python)

  Summary: CLI todo application with argparse, add/remove/list commands,
           JSON file persistence
  Time: 2.8s | Attempts: 1 | Auto-fixes: 1
```

The model wrapped its JSON in markdown. Any other tool would have given you that raw broken output. EamilOS **stripped the wrapper, re-parsed, validated the code was real code and not a description, scanned for secrets, checked the filepath, and wrote a clean file.**

You saw none of that complexity. You just got a working file.

---

## 🧠 How It Works

### 1. Every response passes through a gauntlet

```
Model Response
     │
     ▼
┌─────────────────┐
│  JSON Extraction │ ← tries 4 strategies (direct, code block, brace, nested)
└────────┬────────┘
         │ fails?  → auto-repair (trailing commas, single quotes, unquoted keys)
         ▼
┌─────────────────┐
│   Structure      │ ← must have {"files": [{"path": "...", "content": "..."}]}
│   Validation     │
└────────┬────────┘
         │ fails?  → retry with stricter prompt
         ▼
┌─────────────────┐
│   Content Check  │ ← rejects descriptions disguised as code
│                  │ ← rejects placeholder filenames (data.json, output.txt)
└────────┬────────┘
         │ fails?  → retry with nuclear prompt
         ▼
┌─────────────────┐
│   Security Scan  │ ← blocks path traversal, absolute paths, secret leaks
│                  │ ← blocks .env, private keys, API tokens in output
└────────┬────────┘
         │ fails?  → hard reject, never written
         ▼
    ✅ Files written
```

**Nothing reaches your disk without passing every check.**

### 2. Errors explain themselves

Most tools:
```
Error: INVALID_JSON
```

EamilOS:
```
  ❌ JSON structure missing 'files' array

  What happened:
    The model produced valid JSON, but it used {"code": "..."} instead
    of the required {"files": [{"path": "...", "content": "..."}]} format.

  Why:
    phi3:mini (3.8B) has low JSON compliance — it frequently ignores
    structured output instructions. This is a known model limitation,
    not a system bug.

  How to fix:
    1. System is retrying automatically with a stricter prompt
    2. Run: eamilos benchmark — to find a more reliable model
    3. Or switch: eamilos run "..." --model qwen2.5-coder:7b

  🔄 Retrying automatically (attempt 2/5, strict mode)
```

Every error tells you **what, why, and how to fix it.** Including whether it's a model problem or a system problem.

### 3. The system learns which models work

```bash
$ eamilos benchmark

  Model               Success   Latency   JSON     Score
  ─────────────────────────────────────────────────────────
  qwen2.5-coder:7b   92%       2.1s      95%      0.91  ← recommended
  deepseek-coder      85%       2.4s      88%      0.84
  llama3:8b           80%       3.2s      75%      0.76
  phi3:mini           52%       1.1s      38%      0.44  ⚠️ weak JSON

  🏆 Best: qwen2.5-coder:7b
```

Every execution is recorded. Success rates, latency, JSON compliance, retries needed — all tracked per model, per task type. The router uses this data to **pick the right model for each task automatically**.

Weak model on your machine? The system **compensates** — stricter prompts, more retries, task splitting. You don't configure this. It just happens.

### 4. Prompts adapt to the model

| Model | What EamilOS does automatically |
|-------|-------------------------------|
| **phi3:mini** | Nuclear prompts, format examples injected, vocabulary simplified, instructions truncated |
| **llama3** | Strict JSON enforcement, no-markdown rules, format reminders |
| **deepseek-coder** | Standard prompts with light JSON reminder |
| **gpt-4o** | Minimal constraints — model follows instructions reliably |

You don't write different prompts for different models. The system profiles each model and adjusts automatically.

---

## 📋 Commands

```bash
# First time
eamilos setup                   # guided configuration wizard
eamilos doctor                  # check everything works
eamilos doctor --fix            # auto-fix what it can

# Daily use
eamilos run "your instruction"  # generate validated code
eamilos run "..." --debug       # see full execution trace
eamilos run "..." --model X     # override model selection

# Model management
eamilos benchmark               # test and rank all models
eamilos benchmark --model X    # test specific model

# Plugins
eamilos plugins list            # installed plugins
eamilos plugins install <path> # add a plugin
eamilos plugins remove <id>    # remove a plugin
eamilos plugins health          # plugin diagnostics

# System
eamilos version
eamilos help
```

---

## 🛡️ Security

Security isn't a feature flag. It's a layer that **every output passes through**.

| Threat | What happens |
|--------|-------------|
| Model outputs `../../etc/passwd` as filepath | **Blocked.** Path traversal detected and rejected. |
| Model outputs `/root/.ssh/id_rsa` | **Blocked.** Absolute paths never written. |
| Model hardcodes `sk-proj-abc123...` in code | **Blocked.** Leak detector catches API keys, tokens, private keys. |
| Model names file `.env` or `.ENV` or `.Env` | **Blocked.** Case-insensitive matching on 30+ dangerous filenames. |
| Model outputs `data.json` as default filename | **Blocked.** Placeholder names rejected, retry triggered. |
| Plugin tries to read `OPENAI_API_KEY` | **Blocked.** Secret env vars denied even with `envAccess: true`. |
| Plugin tries to write outside workspace | **Blocked.** Sandbox enforces workspace boundary. |
| Content contains null bytes | **Stripped.** Cleaned before write. |
| Unicode path tricks (bidi override, zero-width) | **Blocked.** NFC normalized, dangerous codepoints rejected. |

Verify it yourself:
```bash
$ eamilos doctor

  ✅ Security: Path traversal prevention — 5 attack patterns blocked
  ✅ Security: Absolute path prevention — 5 patterns blocked
  ✅ Security: Blocked filenames (case-insensitive) — 11 variants rejected
  ✅ Security: Secret leak detection — 4 patterns detected, clean code passes
  ✅ Security: Plugin sandbox — all permissions denied by default
  ✅ Security: Secret env vars — always blocked for plugins
  ✅ Security: No default filenames — parser never produces data.json
  ✅ Security: Null byte stripping — verified
  ✅ Security: Unicode normalization — NFC/NFD consistent
```

The system audits itself. Every run.

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────┐
│                      CLI                              │
│   setup · doctor · run · benchmark · plugins          │
├──────────────────────────────────────────────────────┤
│                  Feature Engine                       │
│   Adaptive Prompting · Self-Healing · Parallel Exec   │
├────────────┬─────────────┬───────────────────────────┤
│Orchestrator│ Model Router │ Task Classifier            │
│ retry loop │ scoring      │ code · json · multi_file  │
│ budget     │ fallback     │ debug · test · refactor   │
│ escalation │ exploration  │ complexity estimation     │
├────────────┴─────────────┴───────────────────────────┤
│               Validation Pipeline                     │
│ Parser → Validator → PathValidator → LeakDetector     │
├──────────────────────────────────────────────────────┤
│               Security Layer                          │
│ SecretManager · SecureLogger · Sandbox                │
├──────────────────────────────────────────────────────┤
│               Providers                               │
│ Ollama · OpenAI · Anthropic · Plugin Providers        │
├──────────────────────────────────────────────────────┤
│               Metrics & Learning                      │
│ SQLite store · Per-model tracking · Adaptation        │
└──────────────────────────────────────────────────────┘
```

Same layered design as an OS kernel. Core is stable. Features are pluggable. Providers are swappable.

---

## 🔌 Extend It

EamilOS has a plugin system with a **permission sandbox**.

```bash
# Create a plugin
npx create-eamilos-plugin my-tool
cd eamilos-plugin-my-tool
npm run build
eamilos plugins install ./dist
```

Plugin types: **feature** · **agent** · **tool** · **hook** · **provider**

Every plugin declares permissions. Users see them before install. Plugins can't exceed what they declared. Secret variables are **always blocked**.

---

## ⚙️ Configuration

```yaml
# eamilos.config.yaml

version: 1
providers:
  - id: ollama
    type: ollama
    models:
      - id: qwen2.5-coder:7b
        tier: cheap
        context_window: 8192

routing:
  mode: auto
  default_tier: cheap
  default_model: qwen2.5-coder:7b
  default_provider: ollama

workspace:
  base_dir: ./data/projects
  git_enabled: true
  max_file_size_mb: 10
  max_workspace_size_mb: 500

budget:
  max_tokens_per_task: 50000
  max_cost_per_project_usd: 5.0
  warn_at_percentage: 80

settings:
  max_parallel_tasks: 3
  task_timeout_seconds: 300
  model_call_timeout_seconds: 120
  preview_mode: true
  auto_retry: true
```

Every behavior is tunable. Every default is battle-tested.

---

## 🤖 Supported Providers

| Provider | Type | Cost | Models |
|----------|------|------|--------|
| **Ollama** | Local | Free | phi3, llama3, mistral, deepseek-coder, qwen2.5-coder, codellama, + any |
| **OpenAI** | Cloud | Paid | gpt-4o, gpt-4o-mini, gpt-3.5-turbo |
| **Anthropic** | Cloud | Paid | claude-3.5-sonnet, claude-3-haiku |
| **Plugins** | Any | Varies | Anything you build |

Auto-detected at startup. `eamilos setup` handles the rest.

---

## The Principle

TCP makes unreliable networks deliver reliable data.

**EamilOS makes unreliable models deliver reliable code.**

The model hallucinates filenames → the validator catches it.<br/>
The model returns broken JSON → the auto-repair fixes it.<br/>
The model ignores instructions → the retry escalates the prompt.<br/>
The model leaks a secret → the scanner blocks the write.<br/>
The model is slow → the router picks a faster one next time.<br/>

The model is a component. **The system is the product.**

---

Used in real-world workflows to generate validated code with 0 manual fixes.

---

## Requirements

- **Node.js >= 18**
- **One AI provider** (at minimum):
  - [Ollama](https://ollama.ai) — local, free, private
  - [OpenAI](https://platform.openai.com/api-keys) — `export OPENAI_API_KEY=sk-...`
  - [Anthropic](https://console.anthropic.com/) — `export ANTHROPIC_API_KEY=sk-ant-...`

---

## Status

| Layer | Status |
|-------|--------|
| Execution pipeline | ✅ Production |
| Validation & security | ✅ 10-point audit |
| Model routing & learning | ✅ Adaptive |
| Plugin system | ✅ Sandboxed |
| CLI (setup, doctor, benchmark) | ✅ Complete |
| Error intelligence | ✅ Explainable |

---

## License

MIT

---

<div align="center">

<br/>

**EamilOS** — the execution layer for AI systems.

*Run AI that actually works.*

<br/>

[Install Now](#-quick-start) · [Report Issue](https://github.com/RayAKaan/EamilOS/issues) · [Star This Repo](https://github.com/RayAKaan/EamilOS)

</div>

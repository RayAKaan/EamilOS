# EamilOS — Adaptive Terminal Multiplexing & Multi-Window Swarm Studio

## 1. The UX Dilemma: Single Viewport vs. Physical Split Terminals

### 1.1 Single Viewport Paradigm (Model A — Universal Default)

All agent stdout is multiplexed into a single Blessed TUI window (`dist/eamilos-ui.js`).  
✅ Works in CI, Docker, SSH, headless environments.  
❌ Cognitive bottleneck when 3+ agents produce verbose output simultaneously.

### 1.2 Multi-Terminal Spawning Paradigm (Model B — `--split` Workstation Mode)

When the developer runs `eamilos multi run "..." --split`, EamilOS opens physical OS terminal panes — one per agent — allowing real-time visibility into each CLI's raw output.

---

## 2. Architecture: Hybrid Adaptive Multiplexer

### 2.1 Decision Matrix

| Environment | Detection Signal | Mode | Behavior |
|---|---|---|---|
| GitHub Actions / CI | `CI=true` | Single Viewport | Blessed TUI only |
| Docker / headless | `!process.env.WT_SESSION && !process.env.TMUX` | Single Viewport | Blessed TUI only |
| SSH remote | `SSH_TTY` set | Single Viewport | Blessed TUI only |
| Windows Terminal | `WT_SESSION` set | `--split` capable | `wt split-pane` commands |
| Tmux | `TMUX` set | `--split` capable | `tmux split-window` commands |
| iTerm2 | `TERM_PROGRAM=iTerm.app` | `--split` capable | AppleScript split pane |
| VS Code | `TERM_PROGRAM=vscode` | `--split` capable | VS Code terminal split |

### 2.2 Detection Logic

```typescript
function detectEnvironment(): 'single' | 'multiplex' {
  if (process.env.CI) return 'single';
  if (process.env.WT_SESSION || process.env.TMUX) return 'multiplex';
  if (process.env.TERM_PROGRAM?.startsWith('vscode') || process.env.TERM_PROGRAM === 'iTerm.app') return 'multiplex';
  return 'single';
}
```

---

## 3. Multiplexer Commands by Platform

### 3.1 Windows Terminal (`WT_SESSION`)

```powershell
# Split terminal vertically, each pane runs an agent command
wt -w 0 split-pane -V --title "Claude Code" npx @anthropic-ai/claude-code --print "task"
wt -w 0 split-pane -H --title "Gemini Scout" npx @google/gemini-cli run "task"
```

### 3.2 Tmux (`TMUX`)

```bash
tmux split-window -h "npx opencode-ai run 'task'"
tmux split-window -v "npx @anthropic-ai/claude-code --print 'task'"
tmux select-layout tiled
```

### 3.3 iTerm2 (`TERM_PROGRAM=iTerm.app`)

```applescript
tell application "iTerm"
  tell current session of current window
    split horizontally with default profile
    split vertically with default profile
  end tell
end tell
```

### 3.4 VS Code (`TERM_PROGRAM=vscode`)

```typescript
// VS Code terminal split via escape sequences
const terminal = vscode.window.createTerminal({ name: 'Agent', splitActiveTerminal: true });
terminal.sendText(`npx opencode-ai run "${task}"`);
```

---

## 4. Implementation Design

### 4.1 `src/multi-agent/multiplexer.ts`

A new module providing:

- `detectEnvironment()` — returns `'single' | 'multiplex'`
- `spawnSplitTerminals(agents, task)` — opens physical terminal panes per platform
- `attachToTUI(agents)` — falls back to single-viewport Blessed TUI

### 4.2 Integration Points

- `eamilos multi run --split` — triggers multiplexed mode
- `eamilos multi run` (default) — uses single Viewport TUI
- Config option `multiplex: true` in `eamilos.yaml`

### 4.3 CI Safety

When `CI=true` or `detectEnvironment()` returns `'single'`, the `--split` flag is silently ignored and the unified TUI is used.

---

## 5. Usage Examples

```bash
# Default: single Blessed TUI (works everywhere)
eamilos multi run "Build a FastAPI backend"

# Desktop: open physical terminal split panes
eamilos multi run "Build a FastAPI backend" --split

# Desktop with specific agents
eamilos multi run "Build a FastAPI backend" --split --agents claude-code,gemini

# Via config
eamilos multi run "Build a FastAPI backend" --multiplex
```

---

## 6. Trade-offs

| Aspect | Single Viewport | Split Terminal |
|---|---|---|
| Compatibility | Universal (CI, Docker, SSH) | Desktop-only |
| Visibility | Filtered summaries | Raw CLI output |
| Interaction | Keyboard shortcuts | Direct REPL click-in |
| Resource usage | Single process | N processes (one per agent) |
| Development cost | Already built | New module needed |

---

## 7. Implementation Status

- [x] Single Viewport Blessed TUI (`dist/eamilos-ui.js`)
- [ ] `src/multi-agent/multiplexer.ts` — environment detection + split commands
- [ ] `--split` flag integration in `commands/index.ts`
- [ ] Windows Terminal support
- [ ] Tmux support
- [ ] iTerm2 support
- [ ] VS Code support

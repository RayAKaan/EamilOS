export interface ProviderStatus {
  id: string;
  type: string;
  engine: string;
  available: boolean;
  latencyMs: number;
  issues: Array<{ severity: string; code: string; message: string; fix: string[] }>;
  models: Array<{ name: string; verified: boolean }>;
}

export interface ExecutionResult {
  taskId: string;
  status: "success" | "failed";
  output?: unknown;
  error?: string;
  durationMs?: number;
}

interface EventMap {
  "system:providers-ready": { providers: ProviderStatus[]; failed: ProviderStatus[] };
  "system:execution-start": { taskCount: number; agentCount: number; parallelLimit: number; agents: Array<{ id: string; model: string; provider: string }> };
  "system:execution-complete": { results: ExecutionResult[]; totalDurationMs: number };
  "agent:start": { agentId: string; model: string; provider: string; source: string };
  "agent:complete": { agentId: string; model: string; provider: string; tokensUsed: number; durationMs: number };
  "agent:error": { agentId: string; attempt: number; maxAttempts: number; error: string };
  "task:start": { taskId: string; parallel: boolean };
  "task:complete": { taskId: string; durationMs: number };
  "task:failed": { taskId: string; error: string };
  "provider:auto-fix-start": { providerId: string; issue: string };
  "provider:auto-fix-success": { providerId: string; action: string };
}

type EventHandler<K extends keyof EventMap> = (data: EventMap[K]) => void;

export class LiveRenderer {
  private spinners: Map<string, { text: string; interval?: NodeJS.Timeout }> = new Map();
  private handlers: Map<keyof EventMap, Set<EventHandler<any>>> = new Map();

  constructor() {
    this.bindDefaultEvents();
  }

  on<K extends keyof EventMap>(event: K, handler: EventHandler<K>): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (e) {
          console.error(`Error in event handler for '${event as string}':`, e);
        }
      }
    }
  }

  private bindDefaultEvents(): void {
    this.on("system:providers-ready", (data) => this.renderProviderSummary(data));
    this.on("system:execution-start", (data) => this.renderExecutionHeader(data));
    this.on("system:execution-complete", (data) => this.renderCompletionSummary(data));

    this.on("agent:start", ({ agentId, model, provider, source }) => {
      const sourceLabel = source !== "agent" ? ` [${source}]` : "";
      const text = `[${agentId}] thinking... (${model} via ${provider})${sourceLabel}`;
      this.startSpinner(agentId, text);
    });

    this.on("agent:complete", ({ agentId, model, provider, durationMs, tokensUsed }) => {
      this.stopSpinner(agentId, {
        success: true,
        text: `[${agentId}] completed (${model} via ${provider} · ${tokensUsed || "?"} tokens · ${(durationMs / 1000).toFixed(1)}s)`,
      });
    });

    this.on("agent:error", ({ agentId, attempt, maxAttempts, error }) => {
      this.updateSpinner(agentId, `[${agentId}] retry ${attempt}/${maxAttempts} ${error}`, "yellow");
    });

    this.on("task:failed", ({ taskId, error }) => {
      this.stopSpinner(taskId, { success: false, text: `[${taskId}] failed: ${error}` });
    });

    this.on("provider:auto-fix-start", ({ providerId, issue }) => {
      console.log(`  ${ansi("yellow")}Auto-fixing ${providerId}: ${issue}...${ansi("reset")}`);
    });

    this.on("provider:auto-fix-success", ({ providerId, action }) => {
      console.log(`  ${ansi("green")}Fixed ${providerId}: ${action}${ansi("reset")}`);
    });
  }

  renderProviderSummary(data: { providers: ProviderStatus[]; failed: ProviderStatus[] }): void {
    console.log("");
    console.log(this.boxTop("Providers"));

    for (const p of [...data.providers, ...data.failed]) {
      const icon = p.available ? `${ansi("green")}✓${ansi("reset")}` : `${ansi("red")}✗${ansi("reset")}`;
      const status = p.available
        ? `${ansi("green")}ready${ansi("reset")}`
        : `${ansi("red")}${p.issues[0]?.code || "unavailable"}${ansi("reset")}`;
      const models = p.models.length > 0
        ? `${ansi("dim")}${p.models.slice(0, 3).map((m) => m.name).join(", ")}${p.models.length > 3 ? ` +${p.models.length - 3}` : ""}${ansi("reset")}`
        : `${ansi("dim")}—${ansi("reset")}`;
      const type = `${ansi("dim")}[${p.type}]${ansi("reset")}`;

      console.log(`│  ${icon} ${padEnd(p.id, 18)} ${padEnd(status, 25)} ${padEnd(models, 30)} ${type} │`);
    }

    console.log(this.boxBottom());

    for (const f of data.failed) {
      for (const issue of f.issues.filter((i) => i.severity !== "info")) {
        console.log(`  ${ansi("yellow")}⚠${ansi("reset")} ${f.id}: ${issue.message}`);
        if (issue.fix.length > 0) {
          console.log(`    ${ansi("dim")}Fix: ${issue.fix[0]}${ansi("reset")}`);
        }
      }
    }
    console.log("");
  }

  renderExecutionHeader(data: { taskCount: number; agentCount: number; parallelLimit: number; agents: Array<{ id: string; model: string; provider: string }> }): void {
    console.log(this.boxTop("Execution Plan"));
    console.log(`│  Tasks: ${data.taskCount}  ·  Agents: ${data.agentCount}  ·  Max Parallel: ${data.parallelLimit}`.padEnd(57) + "│");
    console.log("│".padEnd(58) + "│");

    for (const a of data.agents) {
      console.log(`│  ${ansi("cyan")}${padEnd(a.id, 15)}${ansi("reset")} → ${ansi("white")}${padEnd(a.model, 22)}${ansi("reset")} ${ansi("dim")}(${a.provider})${ansi("reset")}`.padEnd(68) + "│");
    }

    console.log(this.boxBottom());
    console.log("");
  }

  renderCompletionSummary(data: { results: ExecutionResult[]; totalDurationMs: number }): void {
    const succeeded = data.results.filter((r) => r.status === "success").length;
    const failed = data.results.filter((r) => r.status === "failed").length;
    const totalTokens = data.results
      .filter((r) => r.status === "success")
      .reduce((sum, r) => sum + ((r.output as { tokensUsed?: number })?.tokensUsed || 0), 0);
    const duration = (data.totalDurationMs / 1000).toFixed(1);

    console.log("");
    console.log(this.boxTop("Results"));

    if (failed === 0) {
      console.log(`│  ${ansi("green")}✓ All ${succeeded} tasks completed successfully${ansi("reset")}`.padEnd(58) + "│");
    } else {
      console.log(`│  ${ansi("yellow")}⚠ ${succeeded} succeeded, ${failed} failed${ansi("reset")}`.padEnd(58) + "│");
    }

    console.log(`│  Duration: ${duration}s  ·  Tokens: ${totalTokens.toLocaleString()}`.padEnd(58) + "│");
    console.log(this.boxBottom());
    console.log("");
  }

  private startSpinner(id: string, text: string): void {
    if (this.spinners.has(id)) {
      this.stopSpinner(id, { success: false, text });
    }

    const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let frameIndex = 0;

    const interval = setInterval(() => {
      const frame = spinnerFrames[frameIndex % spinnerFrames.length];
      process.stdout.write(`\r${ansi("cyan")}${frame}${ansi("reset")} ${text}`);
      frameIndex++;
    }, 80);

    this.spinners.set(id, { text, interval });
  }

  private updateSpinner(id: string, text: string, _color?: string): void {
    const spinner = this.spinners.get(id);
    if (spinner) {
      spinner.text = text;
    }
  }

  private stopSpinner(id: string, result: { success: boolean; text: string }): void {
    const spinner = this.spinners.get(id);
    if (spinner && spinner.interval) {
      clearInterval(spinner.interval);
      process.stdout.write("\r" + " ".repeat(80) + "\r");
      console.log(
        result.success
          ? `${ansi("green")}✓${ansi("reset")} ${result.text}`
          : `${ansi("red")}✗${ansi("reset")} ${result.text}`
      );
      this.spinners.delete(id);
    }
  }

  private boxTop(title: string): string {
    const width = 58;
    const titlePadded = ` ${title} `;
    const remaining = width - 2 - titlePadded.length;
    const leftPad = Math.floor(remaining / 2);
    const rightPad = remaining - leftPad;
    return `${ansi("dim")}╭${"─".repeat(leftPad)}${ansi("reset")}${ansi("bold")}${titlePadded}${ansi("reset")}${ansi("dim")}${"─".repeat(rightPad)}╮${ansi("reset")}`;
  }

  private boxBottom(): string {
    return `${ansi("dim")}╰${"─".repeat(56)}╯${ansi("reset")}`;
  }
}

function ansi(color: string): string {
  const codes: Record<string, string> = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
  };
  return codes[color] || codes.reset;
}

function padEnd(str: string, len: number): string {
  return str.padEnd(len).substring(0, len);
}

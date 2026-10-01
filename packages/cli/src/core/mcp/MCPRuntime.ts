import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as readline from 'node:readline';

export interface MCPToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface MCPServerSpec {
  id: string;
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class MCPRuntime {
  private process?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private tools: MCPToolDescriptor[] = [];

  async connect(spec: MCPServerSpec): Promise<void> {
    if (this.process) throw new Error('MCP server already connected');
    this.process = spawn(spec.command, [...(spec.args ?? [])], {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const lines = readline.createInterface({ input: this.process.stdout });
    lines.on('line', line => this.handleLine(line));
    this.process.on('exit', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('MCP server exited'));
      this.pending.clear();
      this.process = undefined;
    });

    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'eamilos', version: '2.0.0' },
    });
    const result = await this.request('tools/list', {});
    const tools = (result as { tools?: MCPToolDescriptor[] }).tools ?? [];
    this.tools = tools;
  }

  listTools(): MCPToolDescriptor[] {
    return this.tools.map(tool => ({ ...tool }));
  }

  async callTool(name: string, arguments_: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.process) throw new Error('MCP server is not connected');
    return this.request('tools/call', { name, arguments: arguments_ });
  }

  async disconnect(): Promise<void> {
    if (!this.process) return;
    this.process.kill();
    this.process = undefined;
    this.tools = [];
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const process = this.process;
    if (!process) return Promise.reject(new Error('MCP server is not connected'));
    const id = this.nextId++;
    process.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    try {
      const message = JSON.parse(line) as {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };
      if (typeof message.id !== 'number') return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? 'MCP request failed'));
      else pending.resolve(message.result);
    } catch {
      // Ignore malformed server lines; stderr remains the diagnostic channel.
    }
  }
}

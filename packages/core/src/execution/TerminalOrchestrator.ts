import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { ITerminalExecutionProtocol, TerminalConfig, CommandResult } from '../protocols/execution-protocol.js';
import { CommsGround } from '../collaboration/CommsGround.js';

interface PTYSession {
  id: string;
  agentId: string;
  pty: pty.IPty;
  buffer: string;
  lastActivity: number;
  state: 'active' | 'exited' | 'error';
  commandBuffer: string[];
}

export interface TerminalOutputEvent {
  type: 'terminal:output';
  from: string;
  data: string;
  sessionId: string;
  timestamp: number;
}

export class TerminalOrchestrator extends EventEmitter implements ITerminalExecutionProtocol {
  private sessionMap: Map<string, PTYSession> = new Map();
  private agentMapping: Map<string, string> = new Map();

  constructor(private commsGround: CommsGround) {
    super();
  }

  private getDefaultShell(): string {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || 'bash';
  }

  private generateMarkers(): { start: string; end: string } {
    const timestamp = Date.now();
    return {
      start: `__EAMILOS_CMD_START_${timestamp}__`,
      end: `__EAMILOS_CMD_END_${timestamp}__`
    };
  }

  async spawn(sessionId: string, config: TerminalConfig): Promise<string> {
    const shell = config.shell || this.getDefaultShell();
    
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: config.cols || 120,
      rows: config.rows || 40,
      cwd: config.cwd,
      env: { ...process.env, ...config.env }
    });

    const session: PTYSession = {
      id: sessionId,
      agentId: config.env?.AGENT_ID || 'unknown',
      pty: ptyProcess,
      buffer: '',
      lastActivity: Date.now(),
      state: 'active',
      commandBuffer: []
    };

    this.setupSessionHandlers(session);
    this.sessionMap.set(sessionId, session);
    this.agentMapping.set(session.agentId, sessionId);

    return sessionId;
  }

  private setupSessionHandlers(session: PTYSession) {
    session.pty.onData((data) => {
      session.buffer += data;
      session.lastActivity = Date.now();

      const event: TerminalOutputEvent = {
        type: 'terminal:output',
        from: session.agentId,
        data,
        sessionId: session.id,
        timestamp: Date.now()
      };

      this.commsGround.broadcastTerminalOutput(session.agentId, data, session.id);
      this.emit('terminal:output', event);
    });

    session.pty.onExit(({ exitCode, signal }) => {
      session.state = 'exited';
      this.emit('session:exit', {
        sessionId: session.id,
        agentId: session.agentId,
        exitCode,
        signal
      });
    });
  }

  async execute(sessionId: string, command: string, timeout = 60000): Promise<CommandResult> {
    const session = this.sessionMap.get(sessionId);
    if (!session || session.state !== 'active') {
      throw new Error(`Terminal session ${sessionId} not active`);
    }

    const start = Date.now();
    const markers = this.generateMarkers();
    
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        session.state = 'error';
        cleanup();
        reject(new Error(`Command timeout after ${timeout}ms`));
      }, timeout);

      let output = '';
      let started = false;

      const dataHandler = (event: TerminalOutputEvent) => {
        if (event.sessionId !== sessionId) return;

        let data = event.data;
        if (!started) {
          const markerIndex = data.indexOf(markers.start);
          if (markerIndex === -1) return;
          started = true;
          data = data.slice(markerIndex + markers.start.length);
        }

        const endIndex = data.indexOf(markers.end);
        if (endIndex !== -1) {
          output += data.slice(0, endIndex);
          clearTimeout(timer);
          cleanup();
          resolve({
            success: true,
            output: output.trim(),
            exitCode: 0,
            durationMs: Date.now() - start
          });
          return;
        }

        output += data;
      };

      const cleanup = () => {
        this.off('terminal:output', dataHandler);
      };

      this.on('terminal:output', dataHandler);
      session.pty.write(`echo "${markers.start}"\r\n`);
      session.pty.write(`${command}\r\n`);
      session.pty.write(`echo "${markers.end}"\r\n`);
    });
  }

  async executeParallel(commands: Array<{ sessionId: string; command: string }>): Promise<Map<string, CommandResult>> {
    const results = new Map<string, CommandResult>();
    
    await Promise.all(
      commands.map(async ({ sessionId, command }) => {
        try {
          const result = await this.execute(sessionId, command);
          results.set(sessionId, result);
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          results.set(sessionId, {
            success: false,
            output: '',
            exitCode: -1,
            durationMs: 0,
            error: errorMessage
          });
        }
      })
    );

    return results;
  }

  cleanup(sessionId: string): void {
    const session = this.sessionMap.get(sessionId);
    if (session) {
      session.pty.kill();
      this.sessionMap.delete(sessionId);
      this.agentMapping.delete(session.agentId);
    }
  }

  getSession(agentId: string): PTYSession | undefined {
    const sessionId = this.agentMapping.get(agentId);
    return sessionId ? this.sessionMap.get(sessionId) : undefined;
  }

  getSessions(): Map<string, PTYSession> {
    return this.sessionMap;
  }
}

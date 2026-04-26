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

      this.commsGround.addMessage({
        sender: session.agentId,
        recipient: 'broadcast',
        role: 'executor',
        content: data,
        type: 'message',
        metadata: {
          sessionId: session.id,
          terminalOutput: true
        }
      });
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
        reject(new Error(`Command timeout after ${timeout}ms`));
      }, timeout);

      let output = '';
      let started = false;
      let ended = false;

      const dataHandler = (msg: any) => {
        if (!started && msg.content?.includes(markers.start)) {
          started = true;
          return;
        }

        if (started && !ended) {
          if (msg.content?.includes(markers.end)) {
            ended = true;
            clearTimeout(timer);
            const duration = Date.now() - start;
            resolve({
              success: true,
              output: output.trim(),
              exitCode: 0,
              durationMs: duration
            });
          } else {
            output += msg.content;
          }
        }
      };

      this.commsGround.on('message:added', dataHandler);

      const cleanup = () => {
        this.commsGround.off('message:added', dataHandler);
      };

      session.pty.write(`echo "${markers.start}" && ${command} && echo "${markers.end}"\r\n`);
      
      setTimeout(cleanup, timeout + 1000);
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
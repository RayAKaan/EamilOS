import { appendFileSync, existsSync, mkdirSync, renameSync, readFileSync } from 'fs';
import { dirname } from 'path';
import chalk from 'chalk';
import { getConfig } from './config.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  component: string;
  event?: string;
  projectId?: string;
  taskId?: string;
  agentId?: string;
  correlationId?: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export class Logger {
  private level: LogLevel;
  private consoleEnabled: boolean;
  private fileEnabled: boolean;
  private filePath: string;
  private maxFileSizeMb: number;
  private maxFiles: number;
  private correlationId: string | null = null;

  private levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor() {
    try {
      const config = getConfig();
      this.level = config.logging.level;
      this.consoleEnabled = config.logging.console;
      this.fileEnabled = !!config.logging.file;
      this.filePath = config.logging.file ?? './data/logs/eamilos.log';
      this.maxFileSizeMb = config.logging.max_file_size_mb;
      this.maxFiles = config.logging.max_files;
    } catch {
      this.level = 'info';
      this.consoleEnabled = true;
      this.fileEnabled = false;
      this.filePath = './data/logs/eamilos.log';
      this.maxFileSizeMb = 50;
      this.maxFiles = 5;
    }
  }

  setCorrelationId(id: string | null): void {
    this.correlationId = id;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.level];
  }

  private formatConsole(
    level: LogLevel,
    message: string,
    entry: Partial<LogEntry>
  ): string {
    const timestamp = new Date().toISOString().slice(11, 23);
    const prefix = entry.agentId
      ? chalk.cyan(`[${entry.agentId}]`)
      : chalk.gray(`[${entry.component}]`);

    let levelColor: typeof chalk.gray;
    switch (level) {
      case 'error':
        levelColor = chalk.red;
        break;
      case 'warn':
        levelColor = chalk.yellow;
        break;
      case 'info':
        levelColor = chalk.blue;
        break;
      default:
        levelColor = chalk.gray;
    }

    return `${chalk.gray(timestamp)} ${prefix} ${levelColor(level.toUpperCase())} ${message}`;
  }

  private formatJson(entry: LogEntry): string {
    return JSON.stringify(entry);
  }

  private writeToFile(entry: LogEntry): void {
    if (!this.fileEnabled) return;

    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      this.rotateLogIfNeeded();

      const json = this.formatJson(entry) + '\n';
      appendFileSync(this.filePath, json, 'utf-8');
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  private rotateLogIfNeeded(): void {
    if (!existsSync(this.filePath)) return;

    try {
      const stats = { size: 0 };
      try {
        const content = readFileSync(this.filePath, 'utf-8');
        stats.size = Buffer.byteLength(content, 'utf-8');
      } catch {
        return;
      }

      const maxSize = this.maxFileSizeMb * 1024 * 1024;
      if (stats.size < maxSize) return;

      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const oldPath = `${this.filePath}.${i}`;
        const newPath = `${this.filePath}.${i + 1}`;
        if (existsSync(oldPath)) {
          if (existsSync(newPath)) {
            require('fs').rmSync(newPath);
          }
          renameSync(oldPath, newPath);
        }
      }

      const firstBackup = `${this.filePath}.1`;
      if (existsSync(firstBackup)) {
        require('fs').rmSync(firstBackup);
      }
      renameSync(this.filePath, firstBackup);
    } catch (error) {
      console.error('Log rotation failed:', error);
    }
  }

  log(
    level: LogLevel,
    message: string,
    options: Partial<LogEntry> = {}
  ): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      component: options.component ?? 'app',
      event: options.event,
      projectId: options.projectId,
      taskId: options.taskId,
      agentId: options.agentId,
      correlationId: options.correlationId ?? this.correlationId ?? undefined,
      message,
      metadata: options.metadata,
    };

    if (this.consoleEnabled) {
      console.log(this.formatConsole(level, message, entry));
    }

    this.writeToFile(entry);
  }

  debug(message: string, options?: Partial<LogEntry>): void {
    this.log('debug', message, options);
  }

  info(message: string, options?: Partial<LogEntry>): void {
    this.log('info', message, options);
  }

  warn(message: string, options?: Partial<LogEntry>): void {
    this.log('warn', message, options);
  }

  error(message: string, options?: Partial<LogEntry>): void {
    this.log('error', message, options);
  }

  success(message: string, options?: Partial<LogEntry>): void {
    if (this.consoleEnabled) {
      console.log(
        `${chalk.gray(new Date().toISOString().slice(11, 23))} ${chalk.green('✓')} ${message}`
      );
    }
    this.writeToFile({
      ts: new Date().toISOString(),
      level: 'info',
      component: options?.component ?? 'app',
      message,
      ...options,
    });
  }

  agent(agentId: string, message: string, options?: Partial<LogEntry>): void {
    this.info(message, { ...options, agentId, component: agentId });
  }

  project(projectId: string, message: string, options?: Partial<LogEntry>): void {
    this.info(message, { ...options, projectId, component: 'project' });
  }

  task(taskId: string, message: string, options?: Partial<LogEntry>): void {
    this.info(message, { ...options, taskId, component: 'task' });
  }
}

let globalLogger: Logger | null = null;

export function initLogger(): Logger {
  globalLogger = new Logger();
  return globalLogger;
}

export function getLogger(): Logger {
  if (!globalLogger) {
    return initLogger();
  }
  return globalLogger;
}

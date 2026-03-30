// PHASE 2: Full implementation - live execution logging
import chalk from 'chalk';
import { getConfig } from './config.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success';

export interface LiveLogEntry {
  timestamp: Date;
  level: LogLevel;
  component?: string;
  message: string;
  details?: Record<string, unknown>;
}

export class LiveLogger {
  private enabled: boolean;
  private prefix: string = '';
  private logs: LiveLogEntry[] = [];

  constructor() {
    try {
      const config = getConfig();
      this.enabled = config.logging.live;
    } catch {
      this.enabled = true;
    }
  }

  setPrefix(prefix: string): void {
    this.prefix = prefix;
  }

  debug(message: string, details?: Record<string, unknown>): void {
    this.log('debug', message, details);
  }

  info(message: string, details?: Record<string, unknown>): void {
    this.log('info', message, details);
  }

  warn(message: string, details?: Record<string, unknown>): void {
    this.log('warn', message, details);
  }

  error(message: string, details?: Record<string, unknown>): void {
    this.log('error', message, details);
  }

  success(message: string, details?: Record<string, unknown>): void {
    this.log('success', message, details);
  }

  taskStart(taskTitle: string, agentId: string): void {
    this.info(`[${agentId.toUpperCase()}] Working on: ${taskTitle}`);
  }

  taskComplete(taskTitle: string, artifacts: string[]): void {
    const artifactList = artifacts.length > 0 ? ` (${artifacts.length} artifact${artifacts.length > 1 ? 's' : ''})` : '';
    this.success(`[DONE] ${taskTitle}${artifactList}`);
  }

  taskFail(taskTitle: string, error: string): void {
    this.error(`[FAILED] ${taskTitle}: ${error}`);
  }

  toolCall(toolName: string, args: Record<string, unknown>): void {
    this.debug(`[TOOL] ${toolName}`, args);
  }

  toolResult(toolName: string, success: boolean, details?: Record<string, unknown>): void {
    if (success) {
      this.debug(`[TOOL] ${toolName} succeeded`, details);
    } else {
      this.warn(`[TOOL] ${toolName} failed`, details);
    }
  }

  modelCall(model: string, tokens: number): void {
    this.debug(`[MODEL] ${model} (${tokens} tokens)`);
  }

  budgetWarning(spent: number, limit: number): void {
    const percentage = ((spent / limit) * 100).toFixed(1);
    this.warn(`[BUDGET] ${spent}/${limit} (${percentage}%)`);
  }

  private log(level: LogLevel, message: string, details?: Record<string, unknown>): void {
    const entry: LiveLogEntry = {
      timestamp: new Date(),
      level,
      component: this.prefix || undefined,
      message,
      details,
    };

    this.logs.push(entry);

    if (!this.enabled) {
      return;
    }

    const timestamp = chalk.gray(new Date().toISOString().slice(11, 23));
    const prefix = this.prefix ? chalk.cyan(`[${this.prefix}] `) : '';

    switch (level) {
      case 'debug':
        console.log(`${timestamp} ${prefix}${chalk.gray(message)}`);
        break;
      case 'info':
        console.log(`${timestamp} ${prefix}${chalk.blue(message)}`);
        break;
      case 'warn':
        console.log(`${timestamp} ${prefix}${chalk.yellow('⚠')} ${chalk.yellow(message)}`);
        break;
      case 'error':
        console.error(`${timestamp} ${prefix}${chalk.red('✗')} ${chalk.red(message)}`);
        break;
      case 'success':
        console.log(`${timestamp} ${prefix}${chalk.green('✓')} ${chalk.green(message)}`);
        break;
    }
  }

  getLogs(): LiveLogEntry[] {
    return [...this.logs];
  }

  clear(): void {
    this.logs = [];
  }
}

let globalLiveLogger: LiveLogger | null = null;

export function initLiveLogger(): LiveLogger {
  globalLiveLogger = new LiveLogger();
  return globalLiveLogger;
}

export function getLiveLogger(): LiveLogger {
  if (!globalLiveLogger) {
    return initLiveLogger();
  }
  return globalLiveLogger;
}

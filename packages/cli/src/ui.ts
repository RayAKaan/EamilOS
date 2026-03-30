import chalk from 'chalk';
import ora, { Ora } from 'ora';

export function info(message: string): void {
  console.log(chalk.blue('ℹ'), message);
}

export function success(message: string): void {
  console.log(chalk.green('✓'), message);
}

export function warn(message: string): void {
  console.log(chalk.yellow('⚠'), message);
}

export function error(message: string): void {
  console.log(chalk.red('✗'), message);
}

export function header(message: string): void {
  console.log('\n' + chalk.bold.cyan(message) + '\n');
}

export function subheader(message: string): void {
  console.log(chalk.bold.white(message));
}

export function kv(key: string, value: string): void {
  console.log(`  ${chalk.gray(key + ':')} ${value}`);
}

export function kvList(key: string, values: string[]): void {
  console.log(`  ${chalk.gray(key + ':')}`);
  for (const v of values) {
    console.log(`    - ${v}`);
  }
}

export function progress(current: number, total: number, label?: string): string {
  const percent = Math.round((current / total) * 100);
  const filled = Math.round(percent / 10);
  const empty = 10 - filled;
  const bar = chalk.green('█').repeat(filled) + chalk.gray('░').repeat(empty);
  const labelStr = label ? ` ${label}` : '';
  return `[${bar}] ${percent}%${labelStr}`;
}

export function statusBadge(status: string): string {
  switch (status) {
    case 'active':
      return chalk.green('●') + ' ' + status;
    case 'completed':
      return chalk.blue('●') + ' ' + status;
    case 'failed':
      return chalk.red('●') + ' ' + status;
    case 'paused':
      return chalk.yellow('●') + ' ' + status;
    case 'cancelled':
      return chalk.gray('●') + ' ' + status;
    case 'archived':
      return chalk.cyan('●') + ' ' + status;
    default:
      return chalk.gray('○') + ' ' + status;
  }
}

export function taskStatusBadge(status: string): string {
  switch (status) {
    case 'pending':
      return chalk.gray('○') + ' pending';
    case 'ready':
      return chalk.blue('○') + ' ready';
    case 'in_progress':
      return chalk.yellow('◐') + ' in progress';
    case 'completed':
      return chalk.green('●') + ' completed';
    case 'failed':
      return chalk.red('✗') + ' failed';
    case 'blocked':
      return chalk.red('⊘') + ' blocked';
    case 'cancelled':
      return chalk.gray('⊘') + ' cancelled';
    case 'waiting_approval':
      return chalk.yellow('?') + ' waiting approval';
    default:
      return chalk.gray('○') + ' ' + status;
  }
}

export function createSpinner(text?: string): Ora {
  return ora({
    text: text ?? 'Loading...',
    spinner: 'dots',
    color: 'cyan',
  }).start();
}

export function divider(): void {
  console.log(chalk.gray('─'.repeat(60)));
}

export function formatDate(date: Date | undefined): string {
  if (!date) return 'N/A';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatCost(costUsd: number): string {
  return `$${costUsd.toFixed(4)}`;
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return tokens.toString();
  return `${(tokens / 1000).toFixed(1)}K`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function table(headers: string[], rows: string[][]): void {
  const colWidths = headers.map((h, i) => {
    const maxRow = Math.max(...rows.map((r) => (r[i] ?? '').length));
    return Math.max(h.length, maxRow);
  });

  const headerRow = headers
    .map((h, i) => chalk.bold(h.padEnd(colWidths[i])))
    .join('  ');
  console.log(headerRow);
  console.log(chalk.gray('─'.repeat(headerRow.length)));

  for (const row of rows) {
    const rowStr = row
      .map((cell, i) => (cell ?? '').padEnd(colWidths[i]))
      .join('  ');
    console.log(rowStr);
  }
}

export function confirm(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(chalk.yellow(`${prompt} (y/N): `), (answer: string) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

export function prompt(promptText: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`${promptText}: `, (answer: string) => {
      rl.close();
      resolve(answer);
    });
  });
}

export function select<T>(
  promptText: string,
  options: { label: string; value: T }[]
): Promise<T> {
  return new Promise((resolve) => {
    const rl = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log(promptText);
    options.forEach((opt, i) => {
      console.log(`  ${chalk.cyan(i + 1)}. ${opt.label}`);
    });

    rl.question('Enter choice: ', (answer: string) => {
      rl.close();
      const index = parseInt(answer, 10) - 1;
      if (index >= 0 && index < options.length) {
        resolve(options[index].value);
      } else {
        resolve(options[0].value);
      }
    });
  });
}

import type { PtySessionRequest } from './PtyTypes.js';

export interface PtyExecutionPolicyContext {
  request: PtySessionRequest;
}

export interface PtyExecutionPolicy {
  authorize(context: PtyExecutionPolicyContext): void;
}

export interface PtyExecutionPolicyOptions {
  allowedCommands?: readonly string[];
  allowedWorkingDirectories?: readonly string[];
  maxCommandLength?: number;
  maxArgumentLength?: number;
  maxArguments?: number;
  maxEnvironmentEntries?: number;
}

const DEFAULT_MAX_COMMAND_LENGTH = 4096;
const DEFAULT_MAX_ARGUMENT_LENGTH = 8192;
const DEFAULT_MAX_ARGUMENTS = 256;
const DEFAULT_MAX_ENVIRONMENT_ENTRIES = 256;

function isWithinDirectory(path: string, root: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

export class DefaultPtyExecutionPolicy implements PtyExecutionPolicy {
  private readonly options: Required<
    Pick<
      PtyExecutionPolicyOptions,
      | 'maxCommandLength'
      | 'maxArgumentLength'
      | 'maxArguments'
      | 'maxEnvironmentEntries'
    >
  >;

  constructor(options: PtyExecutionPolicyOptions = {}) {
    this.options = {
      maxCommandLength: options.maxCommandLength ?? DEFAULT_MAX_COMMAND_LENGTH,
      maxArgumentLength: options.maxArgumentLength ?? DEFAULT_MAX_ARGUMENT_LENGTH,
      maxArguments: options.maxArguments ?? DEFAULT_MAX_ARGUMENTS,
      maxEnvironmentEntries:
        options.maxEnvironmentEntries ?? DEFAULT_MAX_ENVIRONMENT_ENTRIES,
    };
    if (this.options.maxCommandLength < 1
      || this.options.maxArgumentLength < 1
      || this.options.maxArguments < 0
      || this.options.maxEnvironmentEntries < 0) {
      throw new Error('PTY execution policy limits must be non-negative and usable');
    }

    this.allowedCommands = options.allowedCommands;
    this.allowedWorkingDirectories = options.allowedWorkingDirectories;
  }

  private readonly allowedCommands?: readonly string[];
  private readonly allowedWorkingDirectories?: readonly string[];

  authorize({ request }: PtyExecutionPolicyContext): void {
    if (request.command.length > this.options.maxCommandLength) {
      throw new Error('PTY command exceeds execution policy limit');
    }
    if (request.args.length > this.options.maxArguments) {
      throw new Error('PTY argument count exceeds execution policy limit');
    }
    if (request.args.some((arg) => arg.length > this.options.maxArgumentLength)) {
      throw new Error('PTY argument exceeds execution policy limit');
    }
    if (request.env && Object.keys(request.env).length > this.options.maxEnvironmentEntries) {
      throw new Error('PTY environment exceeds execution policy limit');
    }

    if (
      this.allowedCommands &&
      !this.allowedCommands.some((allowed) => allowed === request.command)
    ) {
      throw new Error(`PTY command is not allowed by execution policy: ${request.command}`);
    }

    if (
      this.allowedWorkingDirectories &&
      !this.allowedWorkingDirectories.some((root) =>
        isWithinDirectory(request.cwd, root),
      )
    ) {
      throw new Error(`PTY working directory is not allowed by execution policy: ${request.cwd}`);
    }
  }
}

export const allowAllPtyExecutionPolicy: PtyExecutionPolicy = {
  authorize() {},
};

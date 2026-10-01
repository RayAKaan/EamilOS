import { resolve, relative, isAbsolute } from 'node:path';

export interface SandboxPolicy {
  readonly filesystemRead: boolean;
  readonly filesystemWrite: boolean;
  readonly process: boolean;
  readonly network: boolean;
  readonly allowedRoots?: readonly string[];
}

export interface SandboxRequest {
  readonly cwd: string;
  readonly targetPath?: string;
  readonly action: 'read' | 'write' | 'process' | 'network';
}

export class SandboxRuntime {
  constructor(private readonly defaultPolicy: SandboxPolicy = {
    filesystemRead: true,
    filesystemWrite: true,
    process: true,
    network: false,
  }) {}

  check(request: SandboxRequest, policy: SandboxPolicy = this.defaultPolicy): string | undefined {
    const allowed = request.action === 'read' ? policy.filesystemRead
      : request.action === 'write' ? policy.filesystemWrite
      : request.action === 'process' ? policy.process
      : policy.network;
    if (!allowed) return `Sandbox policy denies ${request.action}`;

    if (request.targetPath && policy.allowedRoots?.length) {
      const target = resolve(request.cwd, request.targetPath);
      const inside = policy.allowedRoots.some(root => {
        const rootPath = resolve(root);
        const rel = relative(rootPath, target);
        return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
      });
      if (!inside) return 'Sandbox policy denies path outside allowed roots';
    }
    return undefined;
  }

  assert(request: SandboxRequest, policy?: SandboxPolicy): void {
    const reason = this.check(request, policy);
    if (reason) throw new Error(reason);
  }
}

export class RuntimeInvariantError extends Error {
  readonly code = 'INVARIANT';
  constructor(readonly owner: string, message: string) {
    super(`invariant violated by "${owner}": ${message}`);
    this.name = 'RuntimeInvariantError';
  }
}

export type InvariantCheck = (fail: (message: string) => never) => void | Promise<void>;

export class InvariantRegistry {
  private readonly checks = new Map<string, InvariantCheck>();
  private readonly failures: RuntimeInvariantError[] = [];

  register(owner: string, check: InvariantCheck): () => void {
    if (!owner.trim()) throw new Error('Invariant owner cannot be empty');
    if (this.checks.has(owner)) throw new Error(`Invariant owner already registered: ${owner}`);
    this.checks.set(owner, check);
    return () => this.checks.delete(owner);
  }

  async verify(owner?: string): Promise<RuntimeInvariantError[]> {
    const selected = owner ? [[owner, this.checks.get(owner)] as const] : [...this.checks.entries()];
    const failures: RuntimeInvariantError[] = [];
    for (const [name, check] of selected) {
      if (!check) continue;
      try {
        await check((message) => {
          throw new RuntimeInvariantError(name, message);
        });
      } catch (error) {
        const failure = error instanceof RuntimeInvariantError
          ? error
          : new RuntimeInvariantError(name, error instanceof Error ? error.message : String(error));
        failures.push(failure);
      }
    }
    this.failures.splice(0, this.failures.length, ...failures);
    return failures.slice();
  }

  snapshot(): readonly RuntimeInvariantError[] {
    return this.failures.slice();
  }
}

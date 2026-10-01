export interface AgentCapabilitySet {
  tools: Set<string>;
  capabilities: Set<string>;
  metadata: Record<string, unknown>;
}

export interface AgentScopeSnapshot {
  agentId: string;
  tools: string[];
  capabilities: string[];
  metadata: Record<string, unknown>;
}

export class AgentScope {
  private readonly scopes = new Map<string, AgentCapabilitySet>();

  create(agentId: string, capabilities: Iterable<string> = [], metadata: Record<string, unknown> = {}): () => void {
    if (this.scopes.has(agentId)) throw new Error(`Agent scope already exists: ${agentId}`);
    const values = [...new Set(capabilities)];
    this.scopes.set(agentId, {
      tools: new Set(values),
      capabilities: new Set(values),
      metadata: { ...metadata },
    });
    return () => this.delete(agentId);
  }

  grant(agentId: string, ...capabilities: string[]): void {
    const scope = this.require(agentId);
    for (const capability of capabilities) {
      scope.capabilities.add(capability);
      scope.tools.add(capability);
    }
  }

  revoke(agentId: string, ...capabilities: string[]): void {
    const scope = this.require(agentId);
    for (const capability of capabilities) {
      scope.capabilities.delete(capability);
      scope.tools.delete(capability);
    }
  }

  has(agentId: string, capability: string): boolean {
    return this.scopes.get(agentId)?.capabilities.has(capability) ?? false;
  }

  assert(agentId: string, capability: string): void {
    if (!this.has(agentId, capability)) throw new Error(`Agent ${agentId} lacks capability: ${capability}`);
  }

  get(agentId: string): AgentCapabilitySet | undefined {
    const scope = this.scopes.get(agentId);
    return scope
      ? { tools: new Set(scope.tools), capabilities: new Set(scope.capabilities), metadata: { ...scope.metadata } }
      : undefined;
  }

  snapshot(agentId: string): AgentScopeSnapshot | undefined {
    const scope = this.get(agentId);
    return scope ? {
      agentId,
      tools: [...scope.tools].sort(),
      capabilities: [...scope.capabilities].sort(),
      metadata: scope.metadata,
    } : undefined;
  }

  list(): AgentScopeSnapshot[] {
    return [...this.scopes.keys()].sort().flatMap((agentId) => {
      const snapshot = this.snapshot(agentId);
      return snapshot ? [snapshot] : [];
    });
  }

  delete(agentId: string): boolean {
    return this.scopes.delete(agentId);
  }

  private require(agentId: string): AgentCapabilitySet {
    const scope = this.scopes.get(agentId);
    if (!scope) throw new Error(`Agent scope not found: ${agentId}`);
    return scope;
  }
}

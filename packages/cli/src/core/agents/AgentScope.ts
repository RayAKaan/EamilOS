export interface AgentCapabilitySet {
  tools: Set<string>;
  metadata: Record<string, unknown>;
}

export class AgentScope {
  private readonly scopes = new Map<string, AgentCapabilitySet>();

  create(agentId: string, capabilities: Iterable<string>, metadata: Record<string, unknown> = {}): () => void {
    if (this.scopes.has(agentId)) throw new Error(`Agent scope already exists: ${agentId}`);
    this.scopes.set(agentId, { tools: new Set(capabilities), metadata: { ...metadata } });
    return () => this.scopes.delete(agentId);
  }

  has(agentId: string, capability: string): boolean {
    return this.scopes.get(agentId)?.tools.has(capability) ?? false;
  }

  get(agentId: string): AgentCapabilitySet | undefined {
    const scope = this.scopes.get(agentId);
    return scope ? { tools: new Set(scope.tools), metadata: { ...scope.metadata } } : undefined;
  }
}

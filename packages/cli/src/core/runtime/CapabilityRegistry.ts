export interface CapabilityKey<T> {
  readonly id: string;
  readonly description?: string;
  readonly __type?: T;
}

export function capabilityKey<T>(id: string, description?: string): CapabilityKey<T> {
  if (!id.trim()) throw new Error('Capability id cannot be empty');
  return Object.freeze({ id, description }) as CapabilityKey<T>;
}

export interface CapabilityDescriptor {
  id: string;
  description?: string;
}

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, unknown>();
  private readonly descriptors = new Map<string, CapabilityDescriptor>();

  register<T>(key: CapabilityKey<T>, value: T): () => void {
    if (this.capabilities.has(key.id)) {
      throw new Error(`Capability already registered: ${key.id}`);
    }
    this.capabilities.set(key.id, value);
    this.descriptors.set(key.id, { id: key.id, description: key.description });
    return () => {
      this.capabilities.delete(key.id);
      this.descriptors.delete(key.id);
    };
  }

  provide<T>(key: CapabilityKey<T>, value: T): void {
    this.register(key, value);
  }

  has<T>(key: CapabilityKey<T>): boolean {
    return this.capabilities.has(key.id);
  }

  resolve<T>(key: CapabilityKey<T>): T {
    const value = this.capabilities.get(key.id);
    if (value === undefined) throw new Error(`Missing capability: ${key.id}`);
    return value as T;
  }

  tryResolve<T>(key: CapabilityKey<T>): T | undefined {
    return this.capabilities.get(key.id) as T | undefined;
  }

  list(): CapabilityDescriptor[] {
    return [...this.descriptors.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  clear(): void {
    this.capabilities.clear();
    this.descriptors.clear();
  }
}

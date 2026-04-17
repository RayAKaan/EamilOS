import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { randomUUID } from 'crypto';
import {
  Tenant,
  TenantQuotas,
  ApiKey,
  ApiKeyPermission,
  DEFAULT_TENANT_QUOTAS,
} from './platform-types.js';
import { PluginLoader } from './plugin-loader.js';
import { Session, createEmptySession } from './stateful-types.js';
import { StatePersistence } from './persistence.js';

export interface PlatformConfig {
  enableMultiTenant: boolean;
  requireApiKey: boolean;
  sessionTimeoutMs: number;
  maxTenants: number;
}

const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  enableMultiTenant: true,
  requireApiKey: true,
  sessionTimeoutMs: 3600000,
  maxTenants: 100,
};

export interface CreateTenantResult {
  success: boolean;
  tenant?: Tenant;
  apiKey?: string;
  error?: string;
}

export interface SessionResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}

export class PlatformGateway extends EventEmitter {
  private config: PlatformConfig;
  private tenants: Map<string, Tenant> = new Map();
  private apiKeys: Map<string, ApiKey> = new Map();
  private keyToTenant: Map<string, string> = new Map();
  private sessions: Map<string, { session: Session; tenantId: string; expiresAt: number }> = new Map();
  private pluginLoader: PluginLoader;
  private persistence: StatePersistence;

  constructor(
    config?: Partial<PlatformConfig>,
    pluginLoader?: PluginLoader,
    persistence?: StatePersistence
  ) {
    super();
    this.config = { ...DEFAULT_PLATFORM_CONFIG, ...config };
    this.pluginLoader = pluginLoader || new PluginLoader();
    this.persistence = persistence || new StatePersistence();
  }

  async initialize(): Promise<void> {
    await this.pluginLoader.initialize();
    this.emit('platform.ready');
  }

  async createTenant(name: string, quotas?: Partial<TenantQuotas>): Promise<CreateTenantResult> {
    if (this.config.enableMultiTenant && this.tenants.size >= this.config.maxTenants) {
      return { success: false, error: 'Max tenants reached' };
    }

    const id = `tenant_${randomUUID()}`;
    const apiKey = `eai_${randomUUID().replace(/-/g, '').substring(0, 32)}`;

    const keyHash = createHash('sha256').update(apiKey).digest('hex');

    const tenant: Tenant = {
      id,
      name,
      quotas: { ...DEFAULT_TENANT_QUOTAS, ...quotas },
      installedPlugins: [],
      createdAt: Date.now(),
    };

    const apiKeyRecord: ApiKey = {
      id: randomUUID(),
      tenantId: id,
      keyHash,
      permissions: ['admin'],
      createdAt: Date.now(),
    };

    this.tenants.set(id, tenant);
    this.apiKeys.set(apiKey, apiKeyRecord);
    this.keyToTenant.set(apiKey, id);

    this.emit('tenant.created', { tenantId: id, name });
    this.emit('api-key.created', { tenantId: id, keyPrefix: apiKey.substring(0, 8) });

    return { success: true, tenant, apiKey };
  }

  async deleteTenant(tenantId: string): Promise<boolean> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;

    for (const [key, ak] of this.apiKeys) {
      if (ak.tenantId === tenantId) {
        this.apiKeys.delete(key);
        this.keyToTenant.delete(key);
      }
    }

    for (const [sessionId, sessionInfo] of this.sessions) {
      if (sessionInfo.tenantId === tenantId) {
        this.sessions.delete(sessionId);
      }
    }

    this.tenants.delete(tenantId);
    this.emit('tenant.deleted', { tenantId });
    return true;
  }

  getTenant(tenantId: string): Tenant | undefined {
    return this.tenants.get(tenantId);
  }

  getApiKey(apiKey: string): ApiKey | undefined {
    if (this.config.requireApiKey && !this.apiKeys.has(apiKey)) {
      return undefined;
    }
    return this.apiKeys.get(apiKey);
  }

  validateApiKey(apiKey: string, requiredPermission?: ApiKeyPermission): { valid: boolean; tenantId?: string; error?: string } {
    const keyRecord = this.apiKeys.get(apiKey);
    if (!keyRecord) {
      return { valid: false, error: 'Invalid API key' };
    }

    if (keyRecord.expiresAt && keyRecord.expiresAt < Date.now()) {
      return { valid: false, error: 'API key expired' };
    }

    if (requiredPermission && !keyRecord.permissions.includes(requiredPermission)) {
      return { valid: false, error: 'Insufficient permissions' };
    }

    return { valid: true, tenantId: keyRecord.tenantId };
  }

  async createSession(tenantId: string, goal: string): Promise<SessionResult> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      return { success: false, error: 'Tenant not found' };
    }

    const sessionId = `session_${randomUUID()}`;
    const session = createEmptySession(sessionId, goal);

    const expiresAt = Date.now() + this.config.sessionTimeoutMs;

    this.sessions.set(sessionId, { session, tenantId, expiresAt });
    this.persistence.saveSessionSync(session);

    this.emit('session.created', { sessionId, tenantId });
    return { success: true, sessionId };
  }

  getSession(sessionId: string): Session | undefined {
    const sessionInfo = this.sessions.get(sessionId);
    if (!sessionInfo) return undefined;

    if (sessionInfo.expiresAt < Date.now()) {
      this.sessions.delete(sessionId);
      return undefined;
    }

    return sessionInfo.session;
  }

  registerPlugin(tenantId: string, pluginName: string): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;

    if (!tenant.installedPlugins.includes(pluginName)) {
      tenant.installedPlugins.push(pluginName);
    }

    return true;
  }

  unregisterPlugin(tenantId: string, pluginName: string): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;

    const index = tenant.installedPlugins.indexOf(pluginName);
    if (index > -1) {
      tenant.installedPlugins.splice(index, 1);
    }

    return true;
  }

  getInstalledPlugins(tenantId: string): string[] {
    const tenant = this.tenants.get(tenantId);
    return tenant?.installedPlugins || [];
  }

  checkQuota(tenantId: string, _quotaType: keyof TenantQuotas): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;
    return true;
  }

  getTenantByApiKey(apiKey: string): Tenant | undefined {
    const tenantId = this.keyToTenant.get(apiKey);
    if (!tenantId) return undefined;
    return this.tenants.get(tenantId);
  }

  listTenants(): Tenant[] {
    return Array.from(this.tenants.values());
  }

  getActiveSessions(tenantId?: string): string[] {
    const sessionIds: string[] = [];
    for (const [sessionId, info] of this.sessions) {
      if (!tenantId || info.tenantId === tenantId) {
        if (info.expiresAt >= Date.now()) {
          sessionIds.push(sessionId);
        }
      }
    }
    return sessionIds;
  }

  refreshSession(sessionId: string): boolean {
    const sessionInfo = this.sessions.get(sessionId);
    if (!sessionInfo) return false;

    sessionInfo.expiresAt = Date.now() + this.config.sessionTimeoutMs;
    return true;
  }

  close(): void {
    for (const [sessionId] of this.sessions) {
      this.sessions.delete(sessionId);
    }

    this.pluginLoader.close();
    this.persistence.close();
    this.removeAllListeners();
  }
}

let globalPlatform: PlatformGateway | null = null;

export async function initPlatformGateway(
  config?: Partial<PlatformConfig>,
  pluginLoader?: PluginLoader,
  persistence?: StatePersistence
): Promise<PlatformGateway> {
  const gateway = new PlatformGateway(config, pluginLoader, persistence);
  await gateway.initialize();
  globalPlatform = gateway;
  return gateway;
}

export function getPlatformGateway(): PlatformGateway {
  if (!globalPlatform) {
    throw new Error('Platform not initialized. Call initPlatformGateway() first.');
  }
  return globalPlatform;
}
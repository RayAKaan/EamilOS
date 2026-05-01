import { SharedResource, ResourcePermissions } from '../auth/types.js';
import { nanoid } from 'nanoid';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class WorkspaceSharing {
  private sharesDir: string;
  private resources: Map<string, SharedResource[]> = new Map();

  constructor(sharesDir?: string) {
    this.sharesDir = sharesDir || path.join(os.homedir(), '.eamilos', 'shares');
    this.ensureDir();
    this.loadData();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.sharesDir)) {
      fs.mkdirSync(this.sharesDir, { recursive: true });
    }
  }

  private filePath(): string {
    return path.join(this.sharesDir, 'shares.json');
  }

  private loadData(): void {
    this.resources.clear();
    if (!fs.existsSync(this.filePath())) return;

    try {
      const data = JSON.parse(fs.readFileSync(this.filePath(), 'utf-8')) as SharedResource[];
      for (const r of data) {
        const teamResources = this.resources.get(r.teamId) || [];
        teamResources.push(r);
        this.resources.set(r.teamId, teamResources);
      }
    } catch {
      // Ignore corrupted data
    }
  }

  private saveData(): void {
    const all: SharedResource[] = [];
    for (const resources of this.resources.values()) {
      all.push(...resources);
    }
    fs.writeFileSync(this.filePath(), JSON.stringify(all, null, 2), 'utf-8');
  }

  shareResource(
    teamId: string,
    type: 'agent' | 'template' | 'config',
    resourceId: string,
    sharedBy: string,
    permissions: Partial<ResourcePermissions> = { canUse: true, canModify: false, canShare: false, canDelete: false },
  ): SharedResource {
    const resource: SharedResource = {
      id: nanoid(12),
      teamId,
      type,
      resourceId,
      sharedBy,
      sharedAt: Date.now(),
      permissions: {
        canUse: permissions.canUse ?? false,
        canModify: permissions.canModify ?? false,
        canShare: permissions.canShare ?? false,
        canDelete: permissions.canDelete ?? false,
      },
    };

    const teamResources = this.resources.get(teamId) || [];
    teamResources.push(resource);
    this.resources.set(teamId, teamResources);
    this.saveData();
    return resource;
  }

  updatePermissions(shareId: string, teamId: string, permissions: Partial<ResourcePermissions>): boolean {
    const teamResources = this.resources.get(teamId);
    if (!teamResources) return false;

    const resource = teamResources.find(r => r.id === shareId);
    if (!resource) return false;

    resource.permissions = { ...resource.permissions, ...permissions };
    this.saveData();
    return true;
  }

  revokeShare(shareId: string, teamId: string): boolean {
    const teamResources = this.resources.get(teamId);
    if (!teamResources) return false;

    const idx = teamResources.findIndex(r => r.id === shareId);
    if (idx < 0) return false;

    teamResources.splice(idx, 1);
    this.resources.set(teamId, teamResources);
    this.saveData();
    return true;
  }

  getTeamShares(teamId: string): SharedResource[] {
    return this.resources.get(teamId) || [];
  }

  getResourceShares(teamId: string, type: 'agent' | 'template' | 'config', resourceId: string): SharedResource[] {
    const teamResources = this.resources.get(teamId);
    if (!teamResources) return [];

    return teamResources.filter(r => r.type === type && r.resourceId === resourceId);
  }

  checkPermission(shareId: string, teamId: string, action: 'use' | 'modify' | 'share' | 'delete'): boolean {
    const teamResources = this.resources.get(teamId);
    if (!teamResources) return false;

    const resource = teamResources.find(r => r.id === shareId);
    if (!resource) return false;

    switch (action) {
      case 'use': return resource.permissions.canUse;
      case 'modify': return resource.permissions.canModify;
      case 'share': return resource.permissions.canShare;
      case 'delete': return resource.permissions.canDelete;
      default: return false;
    }
  }

  getSharedResourceIds(teamId: string, type: 'agent' | 'template' | 'config'): string[] {
    const teamResources = this.resources.get(teamId);
    if (!teamResources) return [];

    return teamResources
      .filter(r => r.type === type && r.permissions.canUse)
      .map(r => r.resourceId);
  }
}

let globalWorkspaceSharing: WorkspaceSharing | null = null;

export function initWorkspaceSharing(dir?: string): WorkspaceSharing {
  globalWorkspaceSharing = new WorkspaceSharing(dir);
  return globalWorkspaceSharing;
}

export function getWorkspaceSharing(): WorkspaceSharing {
  if (!globalWorkspaceSharing) {
    return initWorkspaceSharing();
  }
  return globalWorkspaceSharing;
}

export type Role = 'owner' | 'admin' | 'member' | 'viewer';

export interface Profile {
  id: string;
  name: string;
  userId: string;
  email: string;
  createdAt: number;
  lastActive: number;
  teamId: string | null;
  role: Role;
}

export interface Team {
  id: string;
  name: string;
  ownerId: string;
  createdAt: number;
  settings: TeamSettings;
}

export interface TeamSettings {
  maxAgents: number;
  maxCostPerMonth: number;
  allowedProviders: string[];
  defaultRole: Role;
}

export interface TeamMember {
  userId: string;
  teamId: string;
  role: Role;
  joinedAt: number;
  lastActive: number;
  email: string;
}

export interface TeamInvite {
  id: string;
  teamId: string;
  email: string;
  role: Role;
  token: string;
  expiresAt: number;
  used: boolean;
  createdAt: number;
}

export interface SharedResource {
  id: string;
  teamId: string;
  type: 'agent' | 'template' | 'config';
  resourceId: string;
  sharedBy: string;
  sharedAt: number;
  permissions: ResourcePermissions;
}

export interface ResourcePermissions {
  canUse: boolean;
  canModify: boolean;
  canShare: boolean;
  canDelete: boolean;
}

export interface AuditEvent {
  id: string;
  timestamp: number;
  profileId: string;
  teamId: string | null;
  type: 'auth' | 'team' | 'resource' | 'cost' | 'security';
  action: string;
  details: Record<string, unknown>;
  result: 'success' | 'failure';
}

export interface PermissionRule {
  role: Role;
  actions: string[];
}

export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  owner: ['*'],
  admin: [
    'team:invite', 'team:remove-member', 'team:update-settings',
    'agent:create', 'agent:modify', 'agent:share',
    'template:create', 'template:modify', 'template:share',
    'config:modify', 'audit:view',
  ],
  member: [
    'agent:use', 'template:use', 'config:view',
    'agent:share', 'template:share',
  ],
  viewer: [
    'config:view', 'audit:view',
  ],
};

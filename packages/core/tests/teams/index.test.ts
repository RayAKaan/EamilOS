import { describe, it, expect, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { TeamManager } from '../../src/teams/manager.js';
import { RBAC } from '../../src/teams/rbac.js';
import { WorkspaceSharing } from '../../src/teams/sharing.js';

describe('TeamManager', () => {
  let tmpDir: string;
  let tm: TeamManager;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `eamilos-teams-${Date.now()}`);
    tm = new TeamManager(tmpDir);
  });

  it('creates a team with owner', () => {
    const team = tm.createTeam('Dev Team', 'user-1', 'user@example.com');
    expect(team.name).toBe('Dev Team');
    expect(team.ownerId).toBe('user-1');
    expect(tm.getMemberCount(team.id)).toBe(1);
  });

  it('lists teams', () => {
    tm.createTeam('Team A', 'user-1', 'a@example.com');
    tm.createTeam('Team B', 'user-2', 'b@example.com');
    expect(tm.listTeams().length).toBe(2);
  });

  it('creates and accepts invites', () => {
    const team = tm.createTeam('Dev Team', 'user-1', 'user@example.com');
    const invite = tm.createInvite(team.id, 'newuser@example.com', 'member');
    expect(invite).not.toBeNull();
    expect(invite!.email).toBe('newuser@example.com');

    const member = tm.acceptInvite(invite!.token, 'user-2', 'newuser@example.com');
    expect(member).not.toBeNull();
    expect(member!.role).toBe('member');
    expect(tm.getMemberCount(team.id)).toBe(2);
  });

  it('removes a member', () => {
    const team = tm.createTeam('Dev Team', 'user-1', 'user@example.com');
    tm.createInvite(team.id, 'other@example.com', 'member');
    tm.acceptInvite(tm.getTeamInvites(team.id)[0].token, 'user-2', 'other@example.com');
    tm.removeMember(team.id, 'user-2');
    expect(tm.getMemberCount(team.id)).toBe(1);
  });

  it('updates member role', () => {
    const team = tm.createTeam('Dev Team', 'user-1', 'user@example.com');
    tm.updateMemberRole(team.id, 'user-1', 'admin');
    const members = tm.getTeamMembers(team.id);
    expect(members[0].role).toBe('admin');
  });

  it('gets user teams', () => {
    const team = tm.createTeam('Dev Team', 'user-1', 'user@example.com');
    const userTeams = tm.getUserTeams('user-1');
    expect(userTeams.length).toBe(1);
    expect(userTeams[0].team.name).toBe('Dev Team');
  });

  it('deletes a team', () => {
    const team = tm.createTeam('Dev Team', 'user-1', 'user@example.com');
    expect(tm.deleteTeam(team.id)).toBe(true);
    expect(tm.getTeam(team.id)).toBeUndefined();
  });

  it('updates team settings', () => {
    const team = tm.createTeam('Dev Team', 'user-1', 'user@example.com');
    tm.updateTeamSettings(team.id, { maxAgents: 20 });
    const updated = tm.getTeam(team.id)!;
    expect(updated.settings.maxAgents).toBe(20);
  });
});

describe('RBAC', () => {
  it('owner has all permissions', () => {
    expect(RBAC.hasPermission('owner', '*')).toBe(true);
    expect(RBAC.hasPermission('owner', 'team:invite')).toBe(true);
    expect(RBAC.hasPermission('owner', 'agent:create')).toBe(true);
  });

  it('admin can invite and manage', () => {
    expect(RBAC.hasPermission('admin', 'team:invite')).toBe(true);
    expect(RBAC.hasPermission('admin', 'agent:create')).toBe(true);
    expect(RBAC.hasPermission('admin', 'audit:view')).toBe(true);
  });

  it('member can use but not modify', () => {
    expect(RBAC.hasPermission('member', 'agent:use')).toBe(true);
    expect(RBAC.hasPermission('member', 'template:use')).toBe(true);
    expect(RBAC.hasPermission('member', 'team:invite')).toBe(false);
  });

  it('viewer can only view', () => {
    expect(RBAC.hasPermission('viewer', 'config:view')).toBe(true);
    expect(RBAC.hasPermission('viewer', 'audit:view')).toBe(true);
    expect(RBAC.hasPermission('viewer', 'agent:use')).toBe(false);
  });

  it('validates actions correctly', () => {
    const allowed = RBAC.validateAction('admin', 'team:invite');
    expect(allowed.allowed).toBe(true);

    const denied = RBAC.validateAction('viewer', 'agent:create');
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBeDefined();
  });

  it('checks role hierarchy', () => {
    expect(RBAC.isHigherOrEqual('owner', 'admin')).toBe(true);
    expect(RBAC.isHigherOrEqual('admin', 'owner')).toBe(false);
    expect(RBAC.isHigherOrEqual('member', 'viewer')).toBe(true);
  });

  it('prevents modifying owner', () => {
    expect(RBAC.canModifyMember('owner', 'owner')).toBe(false);
    expect(RBAC.canModifyMember('owner', 'admin')).toBe(true);
  });
});

describe('WorkspaceSharing', () => {
  let tmpDir: string;
  let ws: WorkspaceSharing;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `eamilos-shares-${Date.now()}`);
    ws = new WorkspaceSharing(tmpDir);
  });

  it('shares a resource', () => {
    const share = ws.shareResource('team-1', 'agent', 'agent-123', 'user-1', {
      canUse: true,
      canModify: false,
      canShare: false,
      canDelete: false,
    });
    expect(share.type).toBe('agent');
    expect(share.resourceId).toBe('agent-123');
    expect(share.sharedBy).toBe('user-1');
  });

  it('checks permissions', () => {
    const share = ws.shareResource('team-1', 'agent', 'agent-123', 'user-1', {
      canUse: true,
      canModify: true,
      canShare: false,
      canDelete: false,
    });
    expect(ws.checkPermission(share.id, 'team-1', 'use')).toBe(true);
    expect(ws.checkPermission(share.id, 'team-1', 'modify')).toBe(true);
    expect(ws.checkPermission(share.id, 'team-1', 'delete')).toBe(false);
  });

  it('updates permissions', () => {
    const share = ws.shareResource('team-1', 'agent', 'agent-123', 'user-1');
    ws.updatePermissions(share.id, 'team-1', { canModify: true });
    expect(ws.checkPermission(share.id, 'team-1', 'modify')).toBe(true);
  });

  it('revokes a share', () => {
    const share = ws.shareResource('team-1', 'agent', 'agent-123', 'user-1');
    ws.revokeShare(share.id, 'team-1');
    expect(ws.checkPermission(share.id, 'team-1', 'use')).toBe(false);
  });

  it('lists team shares', () => {
    ws.shareResource('team-1', 'agent', 'agent-1', 'user-1');
    ws.shareResource('team-1', 'template', 'template-1', 'user-1');
    const shares = ws.getTeamShares('team-1');
    expect(shares.length).toBe(2);
  });

  it('gets shared resource IDs by type', () => {
    ws.shareResource('team-1', 'agent', 'agent-1', 'user-1', { canUse: true });
    ws.shareResource('team-1', 'agent', 'agent-2', 'user-1', { canUse: false });
    ws.shareResource('team-1', 'template', 'template-1', 'user-1', { canUse: true });

    const agents = ws.getSharedResourceIds('team-1', 'agent');
    expect(agents.length).toBe(1);
    expect(agents[0]).toBe('agent-1');
  });
});
